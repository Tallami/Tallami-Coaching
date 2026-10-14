// Un intento de ingreso: reservar el lugar, revisar la contraseña, confirmar el
// resultado. La acción del servidor (`src/app/admin/login/actions.ts`) se
// ocupa del pedido (IP, cookie, redirección); acá está la regla.

import type { Db } from "../../db/client";
import { getPasswordHash } from "./config";
import { verifyPassword } from "./password";
import { confirmLoginSuccess, reserveLoginAttempt } from "./rate-limit";

export type LoginResult = "ok" | "invalid" | "blocked";

/**
 * - `blocked`: la IP ya tuvo 5 fallos en 15 minutos (contando los intentos que
 *   todavía se están revisando). No se mira la contraseña, ni siquiera la
 *   correcta, y no queda nada anotado.
 * - `invalid`: contraseña incorrecta, o `ADMIN_PASSWORD_HASH` sin configurar:
 *   desde afuera no se distingue, para no dar pistas. El fallo ya estaba
 *   anotado desde la reserva.
 * - `ok`: contraseña correcta; la reserva pasa a ser un ingreso.
 *
 * El lugar se reserva ANTES de revisar la contraseña (ver `rate-limit.ts`): así
 * una ráfaga de pedidos simultáneos no puede probar más de 5 contraseñas. Si
 * la revisión falla por un error, la reserva queda como fallo: ante la duda, no
 * se deja entrar ni se regala un intento.
 */
export async function attemptLogin(
  db: Db,
  ipHash: string,
  password: string,
  now: Date = new Date(),
): Promise<LoginResult> {
  const attemptId = await reserveLoginAttempt(db, ipHash, now);
  if (attemptId === null) return "blocked";

  const stored = getPasswordHash();
  const succeeded = stored !== null && (await verifyPassword(password, stored));
  if (!succeeded) return "invalid";

  await confirmLoginSuccess(db, attemptId);
  return "ok";
}
