// Volver el panel al estado de "primera llave": la recuperación cuando se pierden todos
// los dispositivos o cambia el dominio (las llaves quedan atadas a él). Solo la corre
// `npm run admin:reset-passkeys` (`scripts/admin-reset-passkeys.ts`), desde la compu de
// Tallami y con las credenciales de la base: ninguna página ni acción del panel la
// llama, así que no hay manera de dispararla desde la web.
//
// Todo en una sola transacción, o pasa todo o no pasa nada:
//
// - borra todas las llaves;
// - cierra todas las sesiones abiertas (las filas quedan, cerradas, como historial);
// - borra los ingresos a medio camino y los códigos para otro dispositivo: ni un ingreso
//   que ya había pasado la contraseña ni un código generado antes sirven después.
//
// Lo último que hace es borrar los códigos: si algo falla, no queda hecha la mitad
// (llaves borradas con sesiones abiertas, o al revés).
//
// El siguiente ingreso con la contraseña ya no encuentra llaves y lleva a "registrar la
// primera llave" (`loadLoginStep`), como el primer día.

import type { Db } from "../../db/client";
import { adminEnrollmentCodes, adminPasskeys, adminPendingLogins } from "../../db/schema";
import { revokeAllSessions } from "./sessions";

/** Cuántas llaves se borraron y cuántas sesiones abiertas se cerraron. */
export type PasskeyResetResult = { passkeys: number; sessions: number };

/** Borra todas las llaves y cierra todas las sesiones. `now` es la hora contra la que se miran las sesiones abiertas. */
export async function resetPasskeys(db: Db, now: Date = new Date()): Promise<PasskeyResetResult> {
  return db.transaction(async (tx) => {
    const deleted = await tx.delete(adminPasskeys).returning({ id: adminPasskeys.id });
    const closedSessions = await revokeAllSessions(tx, now);
    await tx.delete(adminPendingLogins);
    await tx.delete(adminEnrollmentCodes);
    return { passkeys: deleted.length, sessions: closedSessions };
  });
}
