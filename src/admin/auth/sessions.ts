// Las sesiones del panel, guardadas en la tabla `admin_sessions`. La cookie
// (`session.ts`) lleva solo el id; que la sesión valga lo decide esta fila:
//
// - abierta: no está cerrada (`revokedAt`), no pasó su máximo de 8 horas
//   (`expiresAt`) y su último uso (`lastSeenAt`) es de hace menos de 30 minutos;
// - cada pedido que pasa por `requireAdmin()` es un uso, y el último uso se
//   anota como mucho una vez por minuto, para no escribir en la base en cada
//   clic.
//
// La hora la pone quien llama (`now`, por defecto la actual): así los tests
// recorren las 8 horas sin esperar y todo se compara contra la misma hora.

import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { adminEnrollmentCodes, adminPendingLogins, adminSessions } from "../../db/schema";
import {
  AUTH_RECORD_RETENTION_MS,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  SESSION_RETENTION_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from "./policy";
import { SESSION_ID_BYTES, isSessionId } from "./session";

/** Lo que el resto del panel sabe de una sesión: nada secreto (ni el desafío, ni el vencimiento). */
export type AdminSession = {
  id: string;
  /** La llave con la que se ingresó, o `null` si fue solo con la contraseña. */
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
 * Abre una sesión y devuelve su id (32 bytes al azar en base64url). `reauthed`
 * dice si la llave se acaba de usar: cuenta como la última confirmación.
 */
export async function createSession(
  db: Db,
  input: { passkeyId: string | null; device: string; reauthed: boolean },
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

/** Cierra las sesiones abiertas que ingresaron con la llave `passkeyId` y devuelve sus ids. */
export async function revokeSessionsForPasskey(
  db: Db,
  passkeyId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const closed = await db
    .update(adminSessions)
    .set({ revokedAt: now })
    .where(and(eq(adminSessions.passkeyId, passkeyId), isOpen(now)))
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
