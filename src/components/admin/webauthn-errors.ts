// Qué decirle a Tallami cuando el navegador no completa la llave de acceso. Estos
// errores pasan en el navegador y nunca llegan al servidor (no cuentan como intento
// fallido): el texto es lo único que tiene para saber qué hacer. Se mira el `name`
// del error, que es el mismo en el error del navegador y en el de SimpleWebAuthn
// que lo envuelve; el mensaje en inglés nunca se muestra.

const CANCELLED =
  "Cancelaste o tu dispositivo no tiene una llave para este panel. Probá de nuevo, o usá tu celular con el código QR.";
const ALREADY_REGISTERED = "Este dispositivo ya tiene una llave registrada.";
const GENERIC = "No se pudo usar la llave. Probá de nuevo.";

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
      return `Las llaves solo funcionan en ${origin}.`;
    // Al registrar: el dispositivo ya tiene una de las llaves del panel.
    case "InvalidStateError":
      return ALREADY_REGISTERED;
    default:
      return GENERIC;
  }
}
