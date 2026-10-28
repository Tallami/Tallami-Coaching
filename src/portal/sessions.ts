// Las sesiones del alumno en el portal, guardadas en la tabla `portal_sessions`.
// Es un sistema aparte, y más simple, que el del panel (`src/admin/auth/`): sin
// JWT. La cookie `tallami_alumno` lleva un token opaco (32 bytes al azar, en
// base64url) y la base guarda solo su SHA-256: quien lea la tabla no puede armar
// una cookie. El token es de 256 bits al azar, no una contraseña elegida por
// alguien, así que un hash simple alcanza y buscar la fila por el hash no abre un
// ataque de tiempos (no se puede ir de un hash a un token).
//
// Una sesión vale mientras no esté cerrada (`revokedAt`) y no hayan pasado 30
// días desde que se abrió (`expiresAt`); usarla no la alarga. A los 30 días justos
// ya no vale.
//
// La hora la pone quien llama (`now`, por defecto la actual): así los tests
// recorren los 30 días sin esperar y todo se compara contra la misma hora.

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { portalSessions } from "../db/schema";
import { PORTAL_SESSION_MS } from "./policy";

/** La cookie de sesión del alumno. La del panel (`tallami_admin`) es otra y nunca se mezclan. */
export const PORTAL_COOKIE = "tallami_alumno";

/** Un token son 32 bytes al azar, en base64url: 43 caracteres. */
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** El `id` con el que se guarda la sesión de `token`: su SHA-256 en hexadecimal. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** ¿Tiene `value` la forma de un token de sesión? (No dice si la sesión existe.) */
function isToken(value: string | undefined): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/**
 * Opciones de la cookie de sesión. `secure` es verdadero salvo http en `localhost`
 * (lo decide quien arma la respuesta). `SameSite=Lax` y no `Strict`: al volver de
 * Discord o Google el navegador llega desde otro sitio y la cookie tiene que viajar
 * en esa navegación.
 */
export function portalCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: PORTAL_SESSION_MS / 1000,
  } as const;
}

/**
 * Abre una sesión para la cuenta `accountId` y devuelve su token en claro, que
 * va a la cookie y no se guarda en ningún otro lado: en la base queda solo el hash.
 */
export async function createPortalSession(
  db: Db,
  accountId: string,
  now: Date = new Date(),
): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await db.insert(portalSessions).values({
    id: hashToken(token),
    accountId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + PORTAL_SESSION_MS),
  });
  return token;
}

/**
 * La cuenta dueña de la sesión de `token` si sigue abierta a la hora `now`, o
 * `null` (sin token, con algo que no es un token, sin sesión, cerrada o vencida).
 */
export async function readPortalSession(
  db: Db,
  token: string | undefined,
  now: Date = new Date(),
): Promise<{ accountId: string } | null> {
  if (!isToken(token)) return null;
  const [session] = await db
    .select({ accountId: portalSessions.accountId })
    .from(portalSessions)
    .where(
      and(
        eq(portalSessions.id, hashToken(token)),
        isNull(portalSessions.revokedAt),
        gt(portalSessions.expiresAt, now),
      ),
    );
  return session ? { accountId: session.accountId } : null;
}

/** Cierra la sesión de `token`. Si ya estaba cerrada, o no existe, no hace nada (conserva la primera hora de cierre). */
export async function revokePortalSession(
  db: Db,
  token: string | undefined,
  now: Date = new Date(),
): Promise<void> {
  if (!isToken(token)) return;
  await db
    .update(portalSessions)
    .set({ revokedAt: now })
    .where(and(eq(portalSessions.id, hashToken(token)), isNull(portalSessions.revokedAt)));
}

/** Cierra todas las sesiones abiertas de la cuenta (al desvincularla o al borrarla del panel). */
export async function revokeAccountSessions(
  db: Db,
  accountId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(portalSessions)
    .set({ revokedAt: now })
    .where(and(eq(portalSessions.accountId, accountId), isNull(portalSessions.revokedAt)));
}
