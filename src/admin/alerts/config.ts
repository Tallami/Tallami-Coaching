// Con qué se mandan los avisos por email del panel (Resend). Tres variables:
//
// - `RESEND_API_KEY`: la clave de la cuenta de Resend;
// - `ADMIN_ALERT_EMAIL`: a dónde llegan los avisos (el email de Tallami);
// - `ADMIN_ALERT_FROM`: desde qué dirección salen. Sin dominio propio se usa la dirección
//   de prueba de Resend (`onboarding@resend.dev`), que solo entrega al email de la cuenta
//   de Resend: alcanza, porque el destinatario es el mismo Tallami.
//
// Sin las dos primeras no se manda nada y el panel dice "sin configurar". Si
// `ADMIN_ALERT_EMAIL` está pero no es una dirección, tampoco se manda nada y el panel dice
// "configuración inválida" y qué variable revisar (nunca su valor).

/** Desde dónde salen los avisos mientras no haya un dominio propio verificado en Resend. */
export const DEFAULT_ALERT_FROM = "Panel de Tallami <onboarding@resend.dev>";

/** El dominio de la dirección de prueba de Resend: solo entrega al email de la cuenta. */
const RESEND_TEST_DOMAIN = "@resend.dev";

/** Una dirección sola (sin nombre ni espacios): lo justo para no mandar basura a Resend. */
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export type AlertConfig = { apiKey: string; to: string; from: string };

/** Cómo está la configuración de los avisos: lista, con una variable que falta, o con una variable mal escrita. */
export type AlertSetup =
  | { kind: "ready"; config: AlertConfig }
  | { kind: "missing" }
  | { kind: "invalid"; variable: "ADMIN_ALERT_EMAIL" };

/**
 * Lo que el panel muestra de los avisos: a dónde van (enmascarado) y si salen de la
 * dirección de prueba; que no están configurados; o qué variable está mal (sin su valor).
 */
export type AlertStatus =
  | { kind: "active"; maskedEmail: string; usesTestSender: boolean }
  | { kind: "off" }
  | { kind: "invalid"; variable: "ADMIN_ALERT_EMAIL" };

/** El texto de la variable de entorno sin espacios, o `null` si falta o está vacía. */
function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * El estado de la configuración de los avisos: `missing` si falta la clave o la
 * dirección, `invalid` si la dirección está pero no es una dirección. Se lee del
 * entorno en cada llamada: no se guarda nada, así un cambio de variables en Vercel (un
 * nuevo despliegue) rige solo.
 */
export function getAlertSetup(): AlertSetup {
  const apiKey = readEnv("RESEND_API_KEY");
  const to = readEnv("ADMIN_ALERT_EMAIL");
  if (apiKey === null || to === null) return { kind: "missing" };
  if (!EMAIL_PATTERN.test(to)) return { kind: "invalid", variable: "ADMIN_ALERT_EMAIL" };
  return { kind: "ready", config: { apiKey, to, from: readEnv("ADMIN_ALERT_FROM") ?? DEFAULT_ALERT_FROM } };
}

/** La configuración de los avisos, o `null` si no está lista (falta algo o la dirección no es válida): sin ella no se manda nada. */
export function getAlertConfig(): AlertConfig | null {
  const setup = getAlertSetup();
  return setup.kind === "ready" ? setup.config : null;
}

/** "tomas@gmail.com" → "t***@gmail.com": la primera letra y el dominio, nada más. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}

/** Lo que muestra Configuración → Seguridad. Nunca lleva la clave ni la dirección entera. */
export function getAlertStatus(): AlertStatus {
  const setup = getAlertSetup();
  if (setup.kind === "missing") return { kind: "off" };
  if (setup.kind === "invalid") return { kind: "invalid", variable: setup.variable };
  const { config } = setup;
  return {
    kind: "active",
    maskedEmail: maskEmail(config.to),
    usesTestSender: config.from.toLowerCase().includes(RESEND_TEST_DOMAIN),
  };
}
