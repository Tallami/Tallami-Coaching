// El código para registrar una llave en otro dispositivo (por ejemplo la PC de
// escritorio, que puede no tener Bluetooth para usar la llave del celular).
//
// Nace en una sesión abierta con llave (Configuración → Seguridad) y se canjea en
// el dispositivo nuevo después de la contraseña. Diez caracteres de un alfabeto
// sin letras ni números que se confunden (`policy.ts`), de un solo uso, vencen a
// los 10 minutos y se guardan solo como hash: HMAC-SHA256 con una clave derivada de
// `ADMIN_SESSION_SECRET` y un contexto propio, igual que `hashIp`. Sin el secreto
// no se puede volver del hash al código, ni comprobar una conjetura contra la base.
//
// - Hay un solo código vivo a la vez: generar uno anula los anteriores sin usar.
// - Canjear es un único `update … where used_at is null and expires_at > now
//   returning`: dos pedidos a la vez no pueden canjear el mismo código.
// - El código muere con la sesión que lo generó: si se cierra (por ejemplo con
//   "Cerrar todas las sesiones"), ya no se puede canjear. Así cerrar las sesiones
//   también deja sin efecto los códigos que esa sesión había dejado sueltos.
// - Los intentos fallidos los cuenta quien llama contra el límite de intentos de
//   ingreso (`rate-limit.ts`): son 32^10 códigos posibles.

import { createHmac, randomInt } from "node:crypto";
import { and, eq, exists, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { adminEnrollmentCodes, adminSessions } from "../../db/schema";
import { getSessionSecret } from "./config";
import { ENROLLMENT_CODE_ALPHABET, ENROLLMENT_CODE_LENGTH, ENROLLMENT_CODE_MS } from "./policy";

const CODE_HASH_CONTEXT = "tallami-admin:enrollment-code:v1";
/**
 * El número del bloqueo de aviso que serializa la generación de códigos (ver el
 * de las llaves en `passkeys.ts`): distinto de aquel, y siempre el mismo.
 */
const ENROLLMENT_CODE_LOCK_ID = 7_410_210_002;
/** Cuántos caracteres tiene cada mitad del código mostrado ("ABCDE-FGHJK"). */
const DISPLAY_GROUP_LENGTH = ENROLLMENT_CODE_LENGTH / 2;

/** El HMAC del código, en hexadecimal. Tira si falta el secreto de las sesiones. */
function hashCode(code: string): string {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET falta o tiene menos de 32 caracteres.");
  }
  const key = createHmac("sha256", secret).update(CODE_HASH_CONTEXT).digest();
  return createHmac("sha256", key).update(code).digest("hex");
}

function randomCode(): string {
  let code = "";
  for (let i = 0; i < ENROLLMENT_CODE_LENGTH; i += 1) {
    code += ENROLLMENT_CODE_ALPHABET[randomInt(ENROLLMENT_CODE_ALPHABET.length)];
  }
  return code;
}

/** Como lo teclea quien lo recibe: sin espacios ni guiones y en mayúsculas. */
function normalizeCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

function hasCodeShape(code: string): boolean {
  return code.length === ENROLLMENT_CODE_LENGTH && [...code].every((char) => ENROLLMENT_CODE_ALPHABET.includes(char));
}

/** El código en dos mitades para leerlo y teclearlo mejor: `"ABCDE-FGHJK"`. */
export function formatEnrollmentCode(code: string): string {
  return `${code.slice(0, DISPLAY_GROUP_LENGTH)}-${code.slice(DISPLAY_GROUP_LENGTH)}`;
}

/**
 * Genera un código nuevo en la sesión `sessionId` y lo devuelve en claro (es la
 * única vez que se ve). Anula los códigos anteriores que no se usaron.
 */
export async function generateEnrollmentCode(
  db: Db,
  sessionId: string,
  now: Date = new Date(),
): Promise<string> {
  const code = randomCode();
  const codeHash = hashCode(code);
  await db.transaction(async (tx) => {
    // Sin el bloqueo, dos generaciones a la vez borrarían las dos "lo anterior" y
    // dejarían dos códigos vivos.
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(ENROLLMENT_CODE_LOCK_ID))})`);
    await tx.delete(adminEnrollmentCodes).where(isNull(adminEnrollmentCodes.usedAt));
    await tx.insert(adminEnrollmentCodes).values({
      codeHash,
      createdBySession: sessionId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ENROLLMENT_CODE_MS),
    });
  });
  return code;
}

/** La sesión que generó el código sigue sin cerrarse ni llegar a sus 8 horas. */
function createdByLiveSession(db: Db, now: Date) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(adminSessions)
      .where(
        and(
          eq(adminSessions.id, adminEnrollmentCodes.createdBySession),
          isNull(adminSessions.revokedAt),
          gt(adminSessions.expiresAt, now),
        ),
      ),
  );
}

/**
 * Canjea el código tal como lo tecleó quien lo recibe. `true` solo una vez por
 * código y solo antes de que venza; `false` para cualquier otra cosa (forma
 * inválida, código inexistente, usado, vencido, o de una sesión ya cerrada). Un
 * código con la forma equivocada no llega a la base.
 */
export async function redeemEnrollmentCode(db: Db, raw: string, now: Date = new Date()): Promise<boolean> {
  const code = normalizeCode(raw);
  if (!hasCodeShape(code)) return false;
  const redeemed = await db
    .update(adminEnrollmentCodes)
    .set({ usedAt: now })
    .where(
      and(
        eq(adminEnrollmentCodes.codeHash, hashCode(code)),
        isNull(adminEnrollmentCodes.usedAt),
        gt(adminEnrollmentCodes.expiresAt, now),
        createdByLiveSession(db, now),
      ),
    )
    .returning({ id: adminEnrollmentCodes.id });
  return redeemed.length > 0;
}
