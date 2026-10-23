// Con qué se mandan los avisos por email del panel (Resend). Tres variables:
//
// - `RESEND_API_KEY`: la clave de la cuenta de Resend;
// - `ADMIN_ALERT_EMAIL`: a dónde llegan los avisos (el email de Tallami);
// - `ADMIN_ALERT_FROM`: desde qué dirección salen. Sin dominio propio se usa la dirección
//   de prueba de Resend (`onboarding@resend.dev`), que solo entrega al email de la cuenta
//   de Resend: alcanza, porque el destinatario es el mismo Tallami.
//
// Sin las dos primeras no se manda nada y el panel dice "sin configurar".

/** Desde dónde salen los avisos mientras no haya un dominio propio verificado en Resend. */
export const DEFAULT_ALERT_FROM = "Panel de Tallami <onboarding@resend.dev>";

/** El dominio de la dirección de prueba de Resend: solo entrega al email de la cuenta. */
const RESEND_TEST_DOMAIN = "@resend.dev";

/** Una dirección sola (sin nombre ni espacios): lo justo para no mandar basura a Resend. */
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export type AlertConfig = { apiKey: string; to: string; from: string };

/** Lo que el panel muestra de los avisos: a dónde van (enmascarado) y si salen de la dirección de prueba. */
export type AlertStatus = { maskedEmail: string; usesTestSender: boolean };

/** El texto de la variable de entorno sin espacios, o `null` si falta o está vacía. */
function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

/**
 * La configuración de los avisos, o `null` si falta la clave o la dirección (o no es
 * una dirección): sin ella no se manda nada. Se lee del entorno en cada llamada: no
 * se guarda nada, así un cambio de variables en Vercel (un nuevo despliegue) rige solo.
 */
export function getAlertConfig(): AlertConfig | null {
  const apiKey = readEnv("RESEND_API_KEY");
  const to = readEnv("ADMIN_ALERT_EMAIL");
  if (apiKey === null || to === null || !EMAIL_PATTERN.test(to)) return null;
  return { apiKey, to, from: readEnv("ADMIN_ALERT_FROM") ?? DEFAULT_ALERT_FROM };
}

/** "tomas@gmail.com" → "t***@gmail.com": la primera letra y el dominio, nada más. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  return `${address.slice(0, 1)}***${address.slice(at)}`;
}

/** Lo que muestra Configuración → Seguridad, o `null` si los avisos no están configurados. Nunca lleva la clave. */
export function getAlertStatus(): AlertStatus | null {
  const config = getAlertConfig();
  if (config === null) return null;
  return {
    maskedEmail: maskEmail(config.to),
    usesTestSender: config.from.toLowerCase().includes(RESEND_TEST_DOMAIN),
  };
}
