// El aviso de bloqueo: a lo sumo uno por ventana de intentos (15 minutos) en TOTAL, no por
// conexión. Lo piden la contraseña y los dos pasos de la llave justo después de anotar un
// fallo.
//
// Dos condiciones, las dos necesarias:
//
// 1. la conexión acaba de llegar al tope de fallos (`failuresInWindow === LOGIN_MAX_FAILURES`);
// 2. el aviso global tiene lugar (`claimAlertSlot`).
//
// La primera sola no alcanza: una ráfaga de contraseñas malas en paralelo hace que todos los
// pedidos cuenten justo 5 (cinco avisos), y quien siga probando vuelve a llenar el tope cada
// vez que se le vence el fallo más viejo (cinco por ventana por conexión, sin límite si rota
// de IP). La segunda lo acota: un solo email de bloqueo por ventana, sin importar cuántas
// conexiones se bloqueen. El bloqueo en sí no depende del aviso.

import type { Db } from "../../db/client";
import { LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS, failuresInWindow } from "../auth/rate-limit";
import { notifySecurityEvent } from "./notify";
import { claimAlertSlot } from "./throttle";

/** La fila de `settings` donde queda la hora del último aviso de bloqueo. */
export const LOGIN_BLOCKED_ALERT_KEY = "alerta:login-blocked";

/**
 * Avisa del bloqueo si el fallo que se acaba de anotar llena el tope de esta conexión y en
 * esta ventana todavía no se avisó de ninguno. Se llama solo después de un fallo anotado de
 * verdad: un intento ya bloqueado no deja ninguna fila (`reserveLoginAttempt`) y no llega
 * acá. Nunca tira: un error al contar o al anotar el aviso no puede cambiar lo que contesta
 * el ingreso; queda en el log por su nombre, sin el mensaje (podría traer la conexión a la base).
 */
export async function notifyIfJustBlocked(db: Db, ipHash: string, now: Date = new Date()): Promise<void> {
  try {
    if ((await failuresInWindow(db, ipHash, now)) !== LOGIN_MAX_FAILURES) return;
    if (await claimAlertSlot(db, LOGIN_BLOCKED_ALERT_KEY, LOGIN_WINDOW_MS, now)) notifySecurityEvent("login-blocked");
  } catch (error) {
    const reason = error instanceof Error ? error.name : typeof error;
    console.error(`Aviso de seguridad (login-blocked): no se pudo decidir si avisar. ${reason}`);
  }
}
