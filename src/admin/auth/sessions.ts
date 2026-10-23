// Las sesiones del panel, guardadas en la tabla `admin_sessions`. La cookie
// (`session.ts`) lleva solo el id; que la sesión valga lo decide esta fila:
//
// - abierta: no está cerrada (`revokedAt`), no pasó su máximo de 8 horas
//   (`expiresAt`) y su último uso (`lastSeenAt`) es de hace menos de 30 minutos;
// - cada pedido que pasa por `requireAdmin()` es un uso, y el último uso se
//   anota como mucho una vez por minuto, para no escribir en la base en cada
//   clic.
//
// - cada sesión puede guardar un desafío WebAuthn (`challenge…`) para una
//   confirmación con la llave (`reauth`) o para registrar otra (`register`), de
//   un solo uso y 5 minutos de vida, y la hora de su última confirmación
//   (`reauthAt`), que habilita por 5 minutos las acciones delicadas.
//
// La hora la pone quien llama (`now`, por defecto la actual): así los tests
// recorren las 8 horas sin esperar y todo se compara contra la misma hora.

import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { adminEnrollmentCodes, adminPendingLogins, adminSessions } from "../../db/schema";
import {
  AUTH_RECORD_RETENTION_MS,
  CHALLENGE_MS,
  REAUTH_WINDOW_MS,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  SESSION_RETENTION_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from "./policy";
import { SESSION_ID_BYTES, isSessionId } from "./session";

/** Para qué se pidió el desafío guardado en una sesión. */
export type ChallengePurpose = "reauth" | "register";

/** Lo que el resto del panel sabe de una sesión: nada secreto (ni el desafío, ni el vencimiento). */
export type AdminSession = {
  id: string;
  /**
   * La llave con la que se ingresó. Es `null` solo si esa llave se borró después:
   * toda sesión se abre con una llave, y borrar una cierra las suyas
   * (`deletePasskeyUnlessLast`), así que una sesión abierta sin llave no debería verse.
   */
  passkeyId: string | null;
  /** Descripción corta del navegador y el sistema ("Chrome en Windows"). */
  device: string;
  createdAt: Date;
  lastSeenAt: Date;
  /** Última confirmación con la llave, o `null` si nunca se confirmó. */
  reauthAt: Date | null;
};

const SESSION_COLUMNS = {
  id: adminSessions.id,
  passkeyId: adminSessions.passkeyId,
  device: adminSessions.device,
  createdAt: adminSessions.createdAt,
  lastSeenAt: adminSessions.lastSeenAt,
  reauthAt: adminSessions.reauthAt,
};

/** Las sesiones abiertas a la hora `now`: no cerradas, dentro de las 8 horas y con uso de los últimos 30 minutos. */
function isOpen(now: Date) {
  return and(
    isNull(adminSessions.revokedAt),
    gt(adminSessions.expiresAt, now),
    gt(adminSessions.lastSeenAt, new Date(now.getTime() - SESSION_IDLE_MS)),
  );
}

/**
 * Abre una sesión con la llave `passkeyId` y devuelve su id (32 bytes al azar en
 * base64url). Nunca se abre una sesión con la contraseña sola. `reauthed` dice si la
 * llave se acaba de usar: cuenta como la última confirmación.
 */
export async function createSession(
  db: Db,
  input: { passkeyId: string; device: string; reauthed: boolean },
  now: Date = new Date(),
): Promise<string> {
  const id = randomBytes(SESSION_ID_BYTES).toString("base64url");
  await db.insert(adminSessions).values({
    id,
    passkeyId: input.passkeyId,
    device: input.device,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_MAX_MS),
    reauthAt: input.reauthed ? now : null,
  });
  return id;
}

/**
 * La sesión `sessionId` si sigue abierta a la hora `now`, o `null` (no existe,
 * está cerrada o venció por inactividad o por llegar a las 8 horas). Usarla
 * anota el último uso, salvo que el anterior sea de hace un minuto o menos.
 */
export async function validateSession(
  db: Db,
  sessionId: string,
  now: Date = new Date(),
): Promise<AdminSession | null> {
  if (!isSessionId(sessionId)) return null;
  const [session] = await db
    .select(SESSION_COLUMNS)
    .from(adminSessions)
    .where(and(eq(adminSessions.id, sessionId), isOpen(now)));
  if (!session) return null;

  if (now.getTime() - session.lastSeenAt.getTime() <= SESSION_TOUCH_INTERVAL_MS) return session;
  // Solo hacia adelante: dos pedidos a la vez no pueden dejar anotada una hora anterior.
  await db
    .update(adminSessions)
    .set({ lastSeenAt: now })
    .where(and(eq(adminSessions.id, sessionId), lt(adminSessions.lastSeenAt, now)));
  return { ...session, lastSeenAt: now };
}

/** Cierra una sesión. Si ya estaba cerrada, o no existe, no hace nada (conserva la primera hora de cierre). */
export async function revokeSession(db: Db, sessionId: string, now: Date = new Date()): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: now })
    .where(and(eq(adminSessions.id, sessionId), isNull(adminSessions.revokedAt)));
}

/** Cierra todas las sesiones abiertas (la actual incluida) y dice cuántas cerró. */
export async function revokeAllSessions(db: Db, now: Date = new Date()): Promise<number> {
  const closed = await db
    .update(adminSessions)
    .set({ revokedAt: now })
    .where(isOpen(now))
    .returning({ id: adminSessions.id });
  return closed.length;
}

/**
 * Cierra las sesiones abiertas que quedaron sin llave y devuelve sus ids. Borrar una
 * llave les suelta la llave a las sesiones que se abrieron con ella (`on delete set
 * null`), así que por la llave ya no se las encuentra: se las busca por eso, por no
 * tener llave. Con al menos una llave registrada no puede haber una sesión legítima
 * sin llave, así que cerrarlas nunca sobra. Va después del borrado y no antes: el
 * borrado decide (la última llave no se borra) y una sesión que se abra con esa llave
 * mientras tanto también queda sin ella. La usa `deletePasskeyUnlessLast`, dentro de
 * la misma transacción del borrado.
 */
export async function revokeKeylessSessions(db: Db, now: Date = new Date()): Promise<string[]> {
  const closed = await db
    .update(adminSessions)
    .set({ revokedAt: now })
    .where(and(isNull(adminSessions.passkeyId), isOpen(now)))
    .returning({ id: adminSessions.id });
  return closed.map((row) => row.id);
}

/** Las sesiones abiertas a la hora `now`, la más nueva primero. */
export async function listActiveSessions(db: Db, now: Date = new Date()): Promise<AdminSession[]> {
  return db
    .select(SESSION_COLUMNS)
    .from(adminSessions)
    .where(isOpen(now))
    .orderBy(desc(adminSessions.createdAt));
}

/**
 * Guarda en la sesión el desafío de una ceremonia WebAuthn, en lugar de cualquier
 * otro que tuviera, con 5 minutos de vida. No hace nada si la sesión no existe.
 */
export async function setSessionChallenge(
  db: Db,
  sessionId: string,
  purpose: ChallengePurpose,
  challenge: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(adminSessions)
    .set({
      challenge,
      challengePurpose: purpose,
      challengeExpiresAt: new Date(now.getTime() + CHALLENGE_MS),
    })
    .where(eq(adminSessions.id, sessionId));
}

/**
 * Saca el desafío de la sesión y lo gasta: es de un solo uso. Devuelve `null` si
 * no había ninguno, si era para otro propósito o si ya venció (a los 5 minutos
 * justos); en esos casos también queda gastado, así un pedido equivocado no deja
 * un desafío vivo para el siguiente.
 *
 * Es un compare-and-swap: se lee el desafío y se lo borra solo si sigue siendo ese
 * mismo, así de varios pedidos simultáneos solo uno se lo lleva.
 */
export async function takeSessionChallenge(
  db: Db,
  sessionId: string,
  purpose: ChallengePurpose,
  now: Date = new Date(),
): Promise<string | null> {
  const [stored] = await db
    .select({
      challenge: adminSessions.challenge,
      purpose: adminSessions.challengePurpose,
      expiresAt: adminSessions.challengeExpiresAt,
    })
    .from(adminSessions)
    .where(eq(adminSessions.id, sessionId));
  if (!stored || stored.challenge === null) return null;

  const [taken] = await db
    .update(adminSessions)
    .set({ challenge: null, challengePurpose: null, challengeExpiresAt: null })
    .where(and(eq(adminSessions.id, sessionId), eq(adminSessions.challenge, stored.challenge)))
    .returning({ id: adminSessions.id });
  if (!taken) return null; // otro pedido se lo llevó primero

  const isForThisPurpose = stored.purpose === purpose;
  const isStillValid = stored.expiresAt !== null && stored.expiresAt.getTime() > now.getTime();
  return isForThisPurpose && isStillValid ? stored.challenge : null;
}

/** Anota que la llave se acaba de usar para confirmar: abre la ventana de las acciones delicadas. */
export async function markReauthed(db: Db, sessionId: string, now: Date = new Date()): Promise<void> {
  await db.update(adminSessions).set({ reauthAt: now }).where(eq(adminSessions.id, sessionId));
}

/** ¿Se confirmó con la llave hace menos de 5 minutos? (A los 5 justos, ya no.) */
export function hasRecentReauth(session: AdminSession, now: Date = new Date()): boolean {
  return session.reauthAt !== null && now.getTime() - session.reauthAt.getTime() < REAUTH_WINDOW_MS;
}

/**
 * Borra lo que ya nadie necesita: las sesiones de más de 30 días y los ingresos
 * a medio camino y códigos que vencieron hace más de un día. Las sesiones
 * arrastran los códigos que crearon (`on delete cascade`).
 */
export async function purgeExpiredAuthRecords(db: Db, now: Date = new Date()): Promise<void> {
  const oldSessions = new Date(now.getTime() - SESSION_RETENTION_MS);
  const longExpired = new Date(now.getTime() - AUTH_RECORD_RETENTION_MS);
  await db.delete(adminSessions).where(lt(adminSessions.createdAt, oldSessions));
  await db.delete(adminPendingLogins).where(lt(adminPendingLogins.expiresAt, longExpired));
  await db.delete(adminEnrollmentCodes).where(lt(adminEnrollmentCodes.expiresAt, longExpired));
}
