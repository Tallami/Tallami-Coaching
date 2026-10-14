// Un intento de ingreso: ¿está bloqueada la IP?, ¿es la contraseña?, anotar el
// resultado. La acción del servidor (`src/app/admin/login/actions.ts`) se
// ocupa del pedido (IP, cookie, redirección); acá está la regla.

import type { Db } from "../../db/client";
import { getPasswordHash } from "./config";
import { verifyPassword } from "./password";
import { isLoginBlocked, recordLoginAttempt } from "./rate-limit";

export type LoginResult = "ok" | "invalid" | "blocked";

/**
 * - `blocked`: la IP ya tuvo 5 fallos en 15 minutos. No se mira la contraseña
 *   (ni siquiera la correcta) y no se anota nada.
 * - `invalid`: contraseña incorrecta, o `ADMIN_PASSWORD_HASH` sin configurar:
 *   desde afuera no se distingue, para no dar pistas. Se anota el fallo.
 * - `ok`: contraseña correcta; se anota el ingreso.
 */
export async function attemptLogin(
  db: Db,
  ipHash: string,
  password: string,
  now: Date = new Date(),
): Promise<LoginResult> {
  if (await isLoginBlocked(db, ipHash, now)) return "blocked";

  const stored = getPasswordHash();
  const succeeded = stored !== null && (await verifyPassword(password, stored));
  await recordLoginAttempt(db, ipHash, succeeded, now);
  return succeeded ? "ok" : "invalid";
}
