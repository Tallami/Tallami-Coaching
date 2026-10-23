// El aviso de bloqueo: una vez por bloqueo, no por intento. Lo piden la contraseña y los
// dos pasos de la llave justo después de anotar un fallo.

import type { Db } from "../../db/client";
import { LOGIN_MAX_FAILURES, failuresInWindow } from "../auth/rate-limit";
import { notifySecurityEvent } from "./notify";

/**
 * Avisa del bloqueo si el fallo que se acaba de anotar es el que llena el tope. Se
 * llama solo después de un fallo anotado de verdad: un intento que ya estaba bloqueado
 * no deja ninguna fila (`reserveLoginAttempt`) y no llega acá, así que seguir
 * probando no repite el aviso. Nunca tira: un error al contar no puede cambiar lo que
 * contesta el ingreso.
 */
export async function notifyIfJustBlocked(db: Db, ipHash: string): Promise<void> {
  try {
    if ((await failuresInWindow(db, ipHash)) === LOGIN_MAX_FAILURES) notifySecurityEvent("login-blocked");
  } catch (error) {
    const reason = error instanceof Error ? error.name : typeof error;
    console.error(`Aviso de seguridad (login-blocked): no se pudo contar los fallos. ${reason}`);
  }
}
