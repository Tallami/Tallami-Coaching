// Las conversaciones entre un alumno y Tallami: una por alumno, con sus mensajes. Todo lo que
// decide el chat (qué es un mensaje válido, el tope del alumno, los repetidos, a quién se le
// avisa, qué está sin leer) vive acá; las páginas y las acciones solo llaman a estas funciones.
//
// La hora la pone quien llama (`now`, por defecto la actual), como en `sessions.ts`.
// Los ids que llegan de afuera se revisan con `isUuid`: Postgres rechazaría cualquier otro texto.

import { and, count, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { conversations, customers, messages, portalAccounts } from "@/db/schema";
import { isUuid } from "@/db/uuid";
import { monthsBefore } from "@/lib/months";
import { PUBLIC_RECORD_RETENTION_MONTHS } from "@/payments/policy";
import {
  DUPLICATE_WINDOW_MS,
  INBOX_SNIPPET_LENGTH,
  MESSAGE_MAX_LENGTH,
  STUDENT_MESSAGES_PER_HOUR,
  type MessageSender,
} from "./policy";

const HOUR_MS = 60 * 60 * 1000;

export type ChatMessage = { id: string; sender: MessageSender; body: string; createdAt: string };

/**
 * Cómo termina un envío. `duplicate`: el mismo texto del mismo lado se guardó hace menos de 10
 * segundos, así que no se guarda otro ni se avisa (a la persona se le muestra como enviado).
 * `no-account`: Tallami le escribe a un alumno sin cuenta vinculada, o que no existe.
 */
export type SendResult =
  | { kind: "sent"; message: ChatMessage; notify: boolean }
  | { kind: "duplicate" }
  | { kind: "invalid" }
  | { kind: "rate-limited" }
  | { kind: "no-account" };

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * El texto listo para guardar: sin NUL (Postgres no los acepta), con `\n` en vez de `\r\n` y sin los
 * espacios de las puntas. `null` si queda vacío o pasa de 2.000 caracteres, contados como los cuenta
 * Postgres (`char_length`: un emoji es uno), así este chequeo y el de la base coinciden.
 */
export function cleanMessageBody(raw: string): string | null {
  const body = raw.replaceAll("\u0000", "").replaceAll("\r\n", "\n").trim();
  if (body.length === 0) return null;
  // `length` cuenta unidades UTF-16 y nunca es menor que los puntos de código: solo si pasa de 2.000 hay que contarlos.
  if (body.length > MESSAGE_MAX_LENGTH && [...body].length > MESSAGE_MAX_LENGTH) return null;
  return body;
}

function toChatMessage(row: { id: string; sender: string; body: string; createdAt: Date }): ChatMessage {
  return { id: row.id, sender: row.sender as MessageSender, body: row.body, createdAt: row.createdAt.toISOString() };
}

/** ¿Existe quien tiene que existir para que este lado escriba? El alumno; y para Tallami, además, una cuenta vinculada. */
async function canWrite(tx: Tx, customerId: string, sender: MessageSender): Promise<boolean> {
  if (sender === "coach") {
    const rows = await tx
      .select({ id: portalAccounts.id })
      .from(portalAccounts)
      .where(eq(portalAccounts.customerId, customerId));
    return rows.length > 0;
  }
  const rows = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId));
  return rows.length > 0;
}

/** La conversación del alumno, creada si faltaba y bloqueada hasta que termine la transacción. */
async function lockConversation(tx: Tx, customerId: string, now: Date) {
  await tx.insert(conversations).values({ customerId, lastMessageAt: now }).onConflictDoNothing();
  // `no key update` y no `update`: ver el comentario de `createInvite` en `src/portal/invites.ts`.
  // Alcanza para que dos envíos del mismo alumno se turnen y no choca con quien solo referencia la fila.
  const [conversation] = await tx
    .select()
    .from(conversations)
    .where(eq(conversations.customerId, customerId))
    .for("no key update");
  return conversation;
}

/** Mensajes del lado `sender` que el otro lado todavía no leyó (`otherReadAt` es la marca del otro). */
function unreadFrom(sender: MessageSender, otherReadAt: Date | null) {
  return and(
    eq(messages.sender, sender),
    otherReadAt === null ? undefined : gt(messages.createdAt, otherReadAt),
  );
}

async function countRows(query: Promise<{ total: number }[]>): Promise<number> {
  const [row] = await query;
  return row?.total ?? 0;
}

async function isDuplicate(tx: Tx, conversationId: string, sender: MessageSender, body: string, now: Date) {
  const since = new Date(now.getTime() - DUPLICATE_WINDOW_MS);
  const rows = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.sender, sender),
        eq(messages.body, body),
        gt(messages.createdAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function isStudentOverLimit(tx: Tx, conversationId: string, now: Date) {
  const since = new Date(now.getTime() - HOUR_MS);
  const total = await countRows(
    tx
      .select({ total: count() })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.sender, "student"),
          gt(messages.createdAt, since),
        ),
      ),
  );
  return total >= STUDENT_MESSAGES_PER_HOUR;
}

/**
 * Guarda un mensaje, todo en una transacción: comprueba que se pueda escribir, crea la conversación
 * si falta, la bloquea, decide `duplicate`, el tope del alumno y si hay que avisar, inserta el mensaje
 * y actualiza la hora del último y la marca de lectura de quien escribe. Así dos mensajes a la vez
 * no mandan dos avisos. Lo que no se guarda no deja ninguna fila, tampoco la conversación.
 *
 * `notify`: antes de este mensaje, el otro lado no tenía mensajes de este lado sin leer.
 */
async function sendMessage(
  db: Db,
  customerId: string,
  sender: MessageSender,
  rawBody: string,
  now: Date,
): Promise<SendResult> {
  const body = cleanMessageBody(rawBody);
  if (body === null) return { kind: "invalid" };
  const unwritable: SendResult = sender === "coach" ? { kind: "no-account" } : { kind: "invalid" };
  if (!isUuid(customerId)) return unwritable;

  return db.transaction(async (tx) => {
    if (!(await canWrite(tx, customerId, sender))) return unwritable;
    const conversation = await lockConversation(tx, customerId, now);
    if (await isDuplicate(tx, conversation.id, sender, body, now)) return { kind: "duplicate" };
    if (sender === "student" && (await isStudentOverLimit(tx, conversation.id, now))) return { kind: "rate-limited" };

    const otherReadAt = sender === "student" ? conversation.coachReadAt : conversation.studentReadAt;
    const pending = await countRows(
      tx
        .select({ total: count() })
        .from(messages)
        .where(and(eq(messages.conversationId, conversation.id), unreadFrom(sender, otherReadAt))),
    );
    const [saved] = await tx
      .insert(messages)
      .values({ conversationId: conversation.id, sender, body, createdAt: now })
      .returning();
    await tx
      .update(conversations)
      .set({ lastMessageAt: now, ...(sender === "student" ? { studentReadAt: now } : { coachReadAt: now }) })
      .where(eq(conversations.id, conversation.id));
    return { kind: "sent", message: toChatMessage(saved), notify: pending === 0 };
  });
}

/** Un mensaje del alumno `customerId` a Tallami. Tiene tope: 30 por hora. */
export function sendStudentMessage(
  db: Db,
  customerId: string,
  body: string,
  now: Date = new Date(),
): Promise<SendResult> {
  return sendMessage(db, customerId, "student", body, now);
}

/** Un mensaje de Tallami al alumno `customerId`, que tiene que tener una cuenta vinculada. Sin tope. */
export function sendCoachMessage(
  db: Db,
  customerId: string,
  body: string,
  now: Date = new Date(),
): Promise<SendResult> {
  return sendMessage(db, customerId, "coach", body, now);
}

/** Los mensajes de la conversación del alumno, del más viejo al más nuevo. Vacío si no hay conversación. */
export async function listMessages(db: Db, customerId: string): Promise<ChatMessage[]> {
  if (!isUuid(customerId)) return [];
  const rows = await db
    .select({ id: messages.id, sender: messages.sender, body: messages.body, createdAt: messages.createdAt })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(conversations.customerId, customerId))
    .orderBy(messages.createdAt, messages.id);
  return rows.map(toChatMessage);
}

/** Marca la conversación como leída por `reader`. Si no hay conversación no hace nada y no la crea. */
export async function markRead(
  db: Db,
  customerId: string,
  reader: MessageSender,
  now: Date = new Date(),
): Promise<void> {
  if (!isUuid(customerId)) return;
  await db
    .update(conversations)
    .set(reader === "student" ? { studentReadAt: now } : { coachReadAt: now })
    .where(eq(conversations.customerId, customerId));
}

/** Cuántos mensajes de Tallami todavía no leyó el alumno. */
export async function unreadForStudent(db: Db, customerId: string): Promise<number> {
  if (!isUuid(customerId)) return 0;
  return countRows(
    db
      .select({ total: count() })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .where(
        and(
          eq(conversations.customerId, customerId),
          eq(messages.sender, "coach"),
          or(isNull(conversations.studentReadAt), gt(messages.createdAt, conversations.studentReadAt)),
        ),
      ),
  );
}

export type InboxRow = {
  customerId: string;
  customerName: string;
  lastMessageAt: string;
  lastSender: MessageSender;
  snippet: string;
  unread: number;
};

/** El comienzo de un mensaje en una sola línea. */
function snippetOf(body: string): string {
  return [...body.replace(/\s+/g, " ")].slice(0, INBOX_SNIPPET_LENGTH).join("");
}

/** Mensajes del alumno posteriores a la última lectura de Tallami, para la conversación de la fila. */
const UNREAD_FOR_COACH = sql`${messages.sender} = 'student' and (${conversations.coachReadAt} is null or ${messages.createdAt} > ${conversations.coachReadAt})`;

/**
 * La bandeja de Tallami: primero las conversaciones con algo sin leer, después por último mensaje, la
 * más nueva primero. `unread` cuenta los mensajes del alumno posteriores a la última lectura de Tallami.
 */
export async function listInbox(db: Db): Promise<InboxRow[]> {
  const lastMessage = (column: "sender" | "body") =>
    sql<string>`(select m.${sql.raw(column)} from messages m where m.conversation_id = ${conversations.id} order by m.created_at desc, m.id desc limit 1)`;
  const rows = await db
    .select({
      customerId: conversations.customerId,
      customerName: customers.name,
      lastMessageAt: conversations.lastMessageAt,
      lastSender: lastMessage("sender"),
      lastBody: lastMessage("body"),
      unread: sql<number>`(select count(*)::int from messages where messages.conversation_id = ${conversations.id} and ${UNREAD_FOR_COACH})`,
    })
    .from(conversations)
    .innerJoin(customers, eq(conversations.customerId, customers.id))
    .orderBy(desc(conversations.lastMessageAt));

  const inbox = rows.map((row) => ({
    customerId: row.customerId,
    customerName: row.customerName,
    lastMessageAt: row.lastMessageAt.toISOString(),
    lastSender: row.lastSender as MessageSender,
    snippet: snippetOf(row.lastBody ?? ""),
    unread: Number(row.unread),
  }));
  // `sort` es estable: dentro de cada grupo queda el orden por último mensaje.
  return inbox.sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0));
}

/** Cuántas conversaciones (no mensajes) tienen algo sin leer para Tallami: el número del menú. */
export async function countUnreadConversations(db: Db): Promise<number> {
  return countRows(
    db
      .select({ total: count() })
      .from(conversations)
      .where(
        sql`exists (select 1 from messages where messages.conversation_id = ${conversations.id} and ${UNREAD_FOR_COACH})`,
      ),
  );
}

/** Borra la conversación del alumno con sus mensajes (cascada). `false` si no había. El alumno y sus ventas quedan. */
export async function deleteConversation(db: Db, customerId: string): Promise<boolean> {
  if (!isUuid(customerId)) return false;
  const deleted = await db
    .delete(conversations)
    .where(eq(conversations.customerId, customerId))
    .returning({ id: conversations.id });
  return deleted.length > 0;
}

/** Borra las conversaciones sin mensajes nuevos en 24 meses. Se llama desde `purgeExpiredRecords`. */
export async function purgeStaleConversations(db: Db, now: Date): Promise<void> {
  const cutoff = monthsBefore(now, PUBLIC_RECORD_RETENTION_MONTHS);
  await db.delete(conversations).where(lt(conversations.lastMessageAt, cutoff));
}
