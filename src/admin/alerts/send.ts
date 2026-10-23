// Mandar un aviso de seguridad por email, sin que nada se rompa por eso. No depende de
// Next (se usa también desde el comando de recuperación, que corre fuera del servidor):
// de programar el envío para después de la respuesta se ocupa `notify.ts`.

import { Resend } from "resend";
import { getAlertConfig, type AlertConfig } from "./config";
import { renderSecurityAlert, type AlertContext, type SecurityEvent } from "./render";

export type { AlertContext, SecurityEvent } from "./render";

/** Un email listo para salir. */
export type AlertMessage = { from: string; to: string; subject: string; text: string; html: string };

/** Lo que manda un email de verdad: tira si no salió. */
export type AlertTransport = (message: AlertMessage) => Promise<void>;

/**
 * El transporte de Resend. Resend no tira cuando la API rechaza el pedido: contesta
 * `{ error }`. Acá eso pasa a ser un error, para que se registre igual que cualquier
 * otro fallo, y se lleva solo el nombre y el estado: el texto del error de Resend puede
 * traer la dirección de destino.
 */
function resendTransport(config: AlertConfig): AlertTransport {
  return async (message) => {
    const { error } = await new Resend(config.apiKey).emails.send(message);
    if (error) throw new Error(`Resend rechazó el aviso: ${error.name} (HTTP ${error.statusCode ?? "sin respuesta"}).`);
  };
}

/**
 * Manda el aviso del evento `event`. NUNCA tira: un fallo (Resend caído, clave mala,
 * un transporte que rompe) se registra con `console.error` y nada más, para que el
 * ingreso o el cambio de seguridad que lo causó no dependan del email. Sin
 * configuración (`getAlertConfig()`) no hace nada.
 *
 * En el log va el evento y el error, nunca la clave, la dirección ni el contenido del aviso.
 *
 * `deps` es para los tests y el comando de recuperación: `transport` reemplaza a Resend
 * y `now` fija la hora que dice el aviso.
 */
export async function sendSecurityAlert(
  event: SecurityEvent,
  context: AlertContext,
  deps: { transport?: AlertTransport; now?: Date } = {},
): Promise<void> {
  try {
    const config = getAlertConfig();
    if (config === null) return;
    const rendered = renderSecurityAlert(event, context, deps.now ?? new Date());
    const transport = deps.transport ?? resendTransport(config);
    await transport({ from: config.from, to: config.to, ...rendered });
  } catch (error) {
    console.error(`Aviso de seguridad (${event}): no se pudo mandar.`, describeError(error));
  }
}

/** Qué anotar de un fallo: su nombre y su mensaje (los de los errores de acá y del SDK no llevan datos del aviso). */
function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : `un valor que no es un error (${typeof error})`;
}
