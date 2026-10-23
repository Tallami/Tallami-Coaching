// Límite de intentos de ingreso: 5 fallidos por IP cada 15 minutos. Los
// intentos viven en la tabla `login_attempts` (no en memoria): en Vercel cada
// pedido puede caer en una instancia distinta. La IP se guarda solo como hash
// (`loginIpHash`: el /64 de una IPv6, ver `login-ip.ts`).
//
// Reservar antes de revisar. Mirar si la IP está bloqueada y recién después
// anotar el fallo deja pasar una ráfaga: todos los pedidos simultáneos ven
// "cero fallos" antes de que alguno anote el suyo. Por eso cada intento primero
// anota un fallo (`reserveLoginAttempt`), después cuenta los fallos de la
// ventana incluido el propio, y solo si no se pasó del tope sigue a revisar la
// contraseña. Cada pedido que sigue ya dejó su fila escrita antes de contar, y
// el que cuenta último ve las de todos: como mucho `LOGIN_MAX_FAILURES`
// contraseñas se revisan, sin transacciones ni bloqueos, igual en PGlite que
// en el pooler de Supabase. Si el intento resulta correcto, `confirmLoginSuccess`
// da vuelta su fila a éxito; si se bloquea, su fila se borra (un bloqueo no
// se prolonga por seguir intentando).
//
// El final del segundo paso (verificar la llave) reserva igual que la contraseña,
// antes de mirar la respuesta (`src/admin/auth/login-steps.ts`): una llave
// inválida o de otro sitio queda anotada como fallo y una buena confirma el
// éxito. `isLoginBlocked` solo sirve para contestar de antemano, al pedir las
// opciones de la llave, que esa conexión ya no puede entrar.

import { and, count, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { loginAttempts } from "../../db/schema";

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Los intentos más viejos que esto se borran: la tabla no crece sin límite ni guarda historia de más. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Fallos de esta IP en los 15 minutos anteriores a `now` (sin contar el límite exacto). */
async function countRecentFailures(db: Db, ipHash: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const [row] = await db
    .select({ failures: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ipHash, ipHash),
        eq(loginAttempts.succeeded, false),
        gt(loginAttempts.createdAt, since),
      ),
    );
  return row?.failures ?? 0;
}

async function purgeOldAttempts(db: Db, now: Date): Promise<void> {
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(now.getTime() - RETENTION_MS)));
}

/**
 * Reserva un lugar para un intento de ingreso, antes de revisar la contraseña.
 * Devuelve el id de la reserva (un fallo anotado hasta que se confirme el éxito)
 * o `null` si la IP ya agotó sus intentos: en ese caso no deja ninguna fila.
 * La hora la pone la app (no la base), la misma con la que se cuenta la ventana;
 * al reservar se borran también los intentos de hace más de 30 días.
 */
export async function reserveLoginAttempt(
  db: Db,
  ipHash: string,
  at: Date = new Date(),
): Promise<number | null> {
  const [reservation] = await db
    .insert(loginAttempts)
    .values({ ipHash, succeeded: false, createdAt: at })
    .returning({ id: loginAttempts.id });

  // Cuenta también la fila recién escrita: pasarse del tope es tener ya
  // `LOGIN_MAX_FAILURES` fallos antes de este intento.
  if ((await countRecentFailures(db, ipHash, at)) > LOGIN_MAX_FAILURES) {
    await db.delete(loginAttempts).where(eq(loginAttempts.id, reservation.id));
    return null;
  }
  await purgeOldAttempts(db, at);
  return reservation.id;
}

/**
 * Anota un fallo del segundo paso (una llave inválida o de otra cuenta, un código
 * incorrecto o vencido). La contraseña no pasa por acá: sus fallos los anota
 * `reserveLoginAttempt`.
 */
export async function recordLoginFailure(db: Db, ipHash: string, at: Date = new Date()): Promise<void> {
  await db.insert(loginAttempts).values({ ipHash, succeeded: false, createdAt: at });
}

/** Cuántos fallos tiene esta IP en los 15 minutos anteriores a `now`. */
export function failuresInWindow(db: Db, ipHash: string, now: Date = new Date()): Promise<number> {
  return countRecentFailures(db, ipHash, now);
}

/** ¿Llegó esta IP al tope de fallos? Si es así, el próximo intento ya no se revisa. */
export async function isLoginBlocked(db: Db, ipHash: string, now: Date = new Date()): Promise<boolean> {
  return (await failuresInWindow(db, ipHash, now)) >= LOGIN_MAX_FAILURES;
}

/** La contraseña era correcta: la reserva deja de contar como fallo. */
export async function confirmLoginSuccess(db: Db, attemptId: number): Promise<void> {
  await db.update(loginAttempts).set({ succeeded: true }).where(eq(loginAttempts.id, attemptId));
}
