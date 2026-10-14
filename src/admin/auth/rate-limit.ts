// Límite de intentos de ingreso: 5 fallidos por IP cada 15 minutos. Los
// intentos viven en la tabla `login_attempts` (no en memoria): en Vercel cada
// pedido puede caer en una instancia distinta. La IP se guarda solo como hash
// (`hashIp`).
//
// Limitación conocida: mirar si la IP está bloqueada y anotar el intento son
// dos pasos; varios pedidos simultáneos de la misma IP pueden pasar los cinco
// antes de que se anote el primero. scrypt cuesta cientos de milisegundos y
// 128 MiB por intento, así que la ráfaga se serializa sola en el servidor.

import { and, count, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { loginAttempts } from "../../db/schema";

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Los intentos más viejos que esto se borran: la tabla no crece sin límite ni guarda historia de más. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** ¿Esta IP ya hizo `LOGIN_MAX_FAILURES` intentos fallidos en los últimos 15 minutos? */
export async function isLoginBlocked(db: Db, ipHash: string, now: Date): Promise<boolean> {
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
  return (row?.failures ?? 0) >= LOGIN_MAX_FAILURES;
}

/**
 * Anota un intento y borra los de hace más de 30 días. La hora la pone la app
 * (no la base), la misma con la que después se consulta el bloqueo.
 */
export async function recordLoginAttempt(
  db: Db,
  ipHash: string,
  succeeded: boolean,
  at: Date = new Date(),
): Promise<void> {
  await db.insert(loginAttempts).values({ ipHash, succeeded, createdAt: at });
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(at.getTime() - RETENTION_MS)));
}
