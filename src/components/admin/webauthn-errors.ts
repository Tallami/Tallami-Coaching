// Qué decirle a Tallami cuando el navegador no completa la llave de acceso. Estos
// errores pasan en el navegador y nunca llegan al servidor (no cuentan como intento
// fallido): el texto es lo único que tiene para saber qué hacer. Se mira el `name`
// del error, que es el mismo en el error del navegador y en el de SimpleWebAuthn
// que lo envuelve; el mensaje en inglés nunca se muestra.

const CANCELLED =
  "Cancelaste o tu dispositivo no tiene una llave para este panel. Probá de nuevo, o usá tu celular con el código QR.";
const ALREADY_REGISTERED = "Este dispositivo ya tiene una llave registrada.";
const GENERIC = "No se pudo usar la llave. Probá de nuevo.";

/** El aviso de que las llaves solo valen en `origin`: el mismo para el `SecurityError` del navegador y para la guarda de la pestaña. */
function wrongOriginMessage(origin: string): string {
  return `Las llaves solo funcionan en ${origin}.`;
}

/**
 * El aviso si esta pestaña no está en `origin` (el origen configurado de las llaves,
 * `getWebAuthnConfig().origin`), o `null` si está ahí. Se mira ANTES de pedirle nada al
 * servidor. El navegador no alcanza para detectarlo: en `www.tallami.com`, con el sitio
 * configurado en `https://tallami.com`, acepta el dominio de la llave (es el padre),
 * no tira `SecurityError` y es el servidor el que rechaza el origen, con lo que cada
 * intento contaría para el bloqueo. Sin navegador (el servidor al renderizar) no hay
 * pestaña que comparar: `null`.
 */
export function originMismatchMessage(origin: string): string | null {
  if (typeof window === "undefined") return null;
  return window.location.origin === origin ? null : wrongOriginMessage(origin);
}

function nameOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("name" in error)) return null;
  return typeof error.name === "string" ? error.name : null;
}

/**
 * El aviso en español para `error`. `origin` es el origen configurado de las
 * llaves (`getWebAuthnConfig().origin`): con otra dirección (`127.0.0.1`, la IP de
 * la red, una vista previa de Vercel) el navegador tira `SecurityError` y hay que
 * decir dónde sí funcionan.
 */
export function describeWebAuthnError(error: unknown, origin: string): string {
  switch (nameOf(error)) {
    // Tocó "Cancelar", venció el tiempo o el dispositivo no tiene ninguna de las llaves pedidas.
    case "NotAllowedError":
      return CANCELLED;
    case "SecurityError":
      return wrongOriginMessage(origin);
    // Al registrar: el dispositivo ya tiene una de las llaves del panel.
    case "InvalidStateError":
      return ALREADY_REGISTERED;
    default:
      return GENERIC;
  }
}
