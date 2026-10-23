// Avisar de un evento de seguridad desde una acción del servidor: se programa con
// `after()` y sale cuando el navegador ya tiene su respuesta, así el email nunca
// demora un ingreso ni lo puede romper. Va aparte de `send.ts` porque necesita el
// pedido de Next (`headers()`, `after()`); el comando de recuperación no lo tiene.

import { headers } from "next/headers";
import { after } from "next/server";
import { describeDevice } from "../auth/device";
import { parseCountryCode, type AlertContext, type SecurityEvent } from "./render";
import { sendSecurityAlert } from "./send";

/** El encabezado donde Vercel informa el país de la conexión (código de dos letras). */
const COUNTRY_HEADER = "x-vercel-ip-country";

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Dónde pasó, según el pedido en curso: el navegador y el sistema del `user-agent` y
 * el país de Vercel. Si el pedido no se puede leer, un dispositivo desconocido: el
 * aviso sale igual.
 */
async function requestContext(): Promise<AlertContext> {
  try {
    const requestHeaders = await headers();
    return {
      device: describeDevice(requestHeaders.get("user-agent")),
      country: parseCountryCode(requestHeaders.get(COUNTRY_HEADER)),
    };
  } catch (error) {
    // Solo el nombre del error: el mensaje podría traer datos del pedido.
    console.error(`Aviso de seguridad: no se pudo leer el pedido, se avisa sin dispositivo. ${errorName(error)}`);
    return { device: describeDevice(null), country: null };
  }
}

/**
 * Avisa por email que pasó `event` en el pedido actual. `extra` suma datos del evento
 * (el nombre de la llave). No espera nada y no tira nunca: lo único que hace en el
 * pedido es programar el envío; si ni eso se puede (fuera de un pedido de Next),
 * queda en el log y sigue.
 */
export function notifySecurityEvent(event: SecurityEvent, extra: Partial<AlertContext> = {}): void {
  try {
    after(async () => {
      const context = await requestContext();
      await sendSecurityAlert(event, { ...context, ...extra });
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "motivo desconocido";
    console.error(`Aviso de seguridad (${event}): no se pudo programar el envío. ${reason}`);
  }
}
