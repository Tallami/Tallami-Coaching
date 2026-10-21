// El ingreso a medio camino: la contraseña ya estaba bien y falta el segundo paso
// (una llave de acceso, registrar la primera, o un código para otro dispositivo).
// Es una fila en `admin_pending_logins` atada a una cookie propia; no da acceso a
// ninguna página ni acción del panel, que siguen pidiendo la sesión completa.
//
// - Vive 5 minutos y se usa una sola vez: `consumePendingLogin` es un único
//   `update … where consumed_at is null and expires_at > now returning`, así dos
//   pedidos a la vez no pueden terminar el mismo ingreso.
// - `mode` dice cómo termina: `passkey` (hay llaves: firmar con una), `first-key`
//   (no hay ninguna: registrar la primera) o `code` (se canjeó un código y falta
//   registrar la llave del dispositivo nuevo).
// - Lleva el desafío de la ceremonia en curso (`challenge`); cada pedido de
//   opciones lo reemplaza y el ingreso, al terminar, se consume entero.
//
// La hora la pone quien llama (`now`, por defecto la actual), como en `sessions.ts`.

import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../../db/client";
import { adminPendingLogins } from "../../db/schema";
import { PENDING_LOGIN_MS } from "./policy";
import { SESSION_ID_BYTES } from "./session";

export const PENDING_COOKIE = "tallami_admin_pending";
/** La cookie solo viaja a las páginas del ingreso, y dura lo mismo que el ingreso a medio camino. */
const PENDING_COOKIE_PATH = "/admin/login";
const PENDING_COOKIE_MAX_AGE_SECONDS = PENDING_LOGIN_MS / 1000;
/** El id es el de una cookie: 32 bytes al azar en base64url, igual que el de una sesión (43 caracteres). */
const PENDING_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type PendingMode = "passkey" | "first-key" | "code";

export type PendingLogin = {
  id: string;
  mode: PendingMode;
  /** A dónde ir al terminar (una ruta del panel, ya validada). */
  nextPath: string;
  ipHash: string;
  /** Descripción corta del navegador y el sistema ("Chrome en Windows"). */
  device: string;
  /** El desafío de la ceremonia en curso, o `null` si todavía no se pidió. */
  challenge: string | null;
};

/** Opciones de la cookie del ingreso a medio camino. `secure` lo decide `shouldUseSecureCookie`. */
export function pendingCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: PENDING_COOKIE_PATH,
    maxAge: PENDING_COOKIE_MAX_AGE_SECONDS,
  } as const;
}

/** Abre un ingreso a medio camino y devuelve su id, el que va en la cookie. */
export async function createPendingLogin(
  db: Db,
  input: { mode: PendingMode; nextPath: string; ipHash: string; device: string },
  now: Date = new Date(),
): Promise<string> {
  const id = randomBytes(SESSION_ID_BYTES).toString("base64url");
  await db.insert(adminPendingLogins).values({
    id,
    mode: input.mode,
    nextPath: input.nextPath,
    ipHash: input.ipHash,
    device: input.device,
    createdAt: now,
    expiresAt: new Date(now.getTime() + PENDING_LOGIN_MS),
  });
  return id;
}

/** Que no haya vencido ni se haya usado, a la hora `now`. */
function isPending(now: Date) {
  return and(isNull(adminPendingLogins.consumedAt), gt(adminPendingLogins.expiresAt, now));
}

/**
 * El ingreso a medio camino de la cookie `id`, o `null` (sin cookie, con otra
 * forma, inexistente, vencido o ya usado). Leerlo no lo gasta.
 */
export async function readPendingLogin(
  db: Db,
  id: string | undefined,
  now: Date = new Date(),
): Promise<PendingLogin | null> {
  if (id === undefined || !PENDING_ID_PATTERN.test(id)) return null;
  const [pending] = await db
    .select({
      id: adminPendingLogins.id,
      mode: adminPendingLogins.mode,
      nextPath: adminPendingLogins.nextPath,
      ipHash: adminPendingLogins.ipHash,
      device: adminPendingLogins.device,
      challenge: adminPendingLogins.challenge,
    })
    .from(adminPendingLogins)
    .where(and(eq(adminPendingLogins.id, id), isPending(now)));
  // El tipo de `mode` es `string` para el driver; la base solo admite los tres modos (check).
  return pending ? { ...pending, mode: pending.mode as PendingMode } : null;
}

/** Guarda el desafío de la ceremonia en curso, en lugar del anterior. Un ingreso ya usado no cambia. */
export async function setPendingChallenge(db: Db, id: string, challenge: string): Promise<void> {
  await db
    .update(adminPendingLogins)
    .set({ challenge })
    .where(and(eq(adminPendingLogins.id, id), isNull(adminPendingLogins.consumedAt)));
}

/**
 * Pasa un ingreso de `passkey` a `code` (el usuario canjeó un código en lugar de
 * firmar con una llave) y descarta el desafío de la llave. Solo parte de `passkey`:
 * un ingreso `first-key` no tiene ninguna sesión de la que pueda haber salido un
 * código. `false` si no corresponde o ya no vale.
 */
export async function switchPendingToCode(db: Db, id: string, now: Date = new Date()): Promise<boolean> {
  const switched = await db
    .update(adminPendingLogins)
    .set({ mode: "code", challenge: null })
    .where(and(eq(adminPendingLogins.id, id), eq(adminPendingLogins.mode, "passkey"), isPending(now)))
    .returning({ id: adminPendingLogins.id });
  return switched.length > 0;
}

/** Usa el ingreso, una sola vez: `true` solo para el primer pedido, `false` si ya se usó o venció. */
export async function consumePendingLogin(db: Db, id: string, now: Date = new Date()): Promise<boolean> {
  const consumed = await db
    .update(adminPendingLogins)
    .set({ consumedAt: now })
    .where(and(eq(adminPendingLogins.id, id), isPending(now)))
    .returning({ id: adminPendingLogins.id });
  return consumed.length > 0;
}
