// Los emails que manda el sitio (Resend), a quien compra o escribe y a Tallami. No depende
// de Next: de programar el envío para después de la respuesta se ocupa quien llama.
//
// Ninguna función de acá tira: un email que no sale nunca rompe un cobro. Devuelven `false`
// y dejan una línea en el log, sin direcciones, textos ni claves: el mensaje de un error del
// SDK puede traer la dirección de destino, así que de un error ajeno se anota solo el tipo.

import { Resend } from "resend";
import { getAlertConfig, RESEND_TEST_DOMAIN } from "@/admin/alerts/config";

/** Cómo está el remitente para el público. `test-sender`: la dirección de prueba de Resend, que solo le entrega al dueño de la cuenta. */
export type PublicEmailSetup = { kind: "ready"; apiKey: string; from: string } | { kind: "missing" } | { kind: "test-sender" };

export type EmailMessage = { to: string; subject: string; text: string };

/** Lo que manda un email de verdad: tira si no salió. */
export type EmailTransport = (message: EmailMessage & { from: string }) => Promise<void>;

export interface EmailDeps {
  /** Reemplaza a Resend en los tests. */
  transport?: EmailTransport;
}

/** Un rechazo de Resend: lleva solo su nombre y su estado, nada del email. */
class EmailRejectedError extends Error {
  constructor(name: string, statusCode: number | null) {
    super(`Resend rechazó el email: ${name} (HTTP ${statusCode ?? "sin respuesta"}).`);
    this.name = "EmailRejectedError";
  }
}

/** Resend no tira cuando la API rechaza el pedido: contesta `{ error }`. Acá pasa a ser un error como cualquier otro. */
function resendTransport(apiKey: string): EmailTransport {
  return async (message) => {
    const { error } = await new Resend(apiKey).emails.send(message);
    if (error) throw new EmailRejectedError(error.name, error.statusCode);
  };
}

function describeError(error: unknown): string {
  if (error instanceof EmailRejectedError) return error.message;
  return error instanceof Error ? error.name : typeof error;
}

async function deliver(message: EmailMessage & { from: string }, transport: EmailTransport): Promise<boolean> {
  try {
    await transport(message);
    return true;
  } catch (error) {
    console.error("[email] no se pudo mandar:", describeError(error));
    return false;
  }
}

function readEnv(name: string): string | null {
  return process.env[name]?.trim() || null;
}

/**
 * El remitente para el público (`PUBLIC_EMAIL_FROM`) y la clave (`RESEND_API_KEY`). Se lee
 * del entorno en cada llamada, como los avisos del panel: sin él no se puede pagar.
 */
export function getPublicEmailSetup(): PublicEmailSetup {
  const apiKey = readEnv("RESEND_API_KEY");
  const from = readEnv("PUBLIC_EMAIL_FROM");
  if (apiKey === null || from === null) return { kind: "missing" };
  if (from.toLowerCase().includes(RESEND_TEST_DOMAIN)) return { kind: "test-sender" };
  return { kind: "ready", apiKey, from };
}

/** Un email a alguien del público. `false` si no salió, también si el remitente no sirve para eso. */
export async function sendPublicEmail(message: EmailMessage, deps: EmailDeps = {}): Promise<boolean> {
  const setup = getPublicEmailSetup();
  if (setup.kind !== "ready") {
    console.error(`[email] no se mandó: el remitente para el público no está listo (${setup.kind}).`);
    return false;
  }
  return deliver({ ...message, from: setup.from }, deps.transport ?? resendTransport(setup.apiKey));
}

/**
 * Un email a Tallami: va a `ADMIN_ALERT_EMAIL` y sale del remitente de los avisos del panel,
 * que con la dirección de prueba de Resend también le llega. `false` si no salió.
 */
export async function sendTallamiEmail(message: Omit<EmailMessage, "to">, deps: EmailDeps = {}): Promise<boolean> {
  const config = getAlertConfig();
  if (config === null) {
    console.error("[email] no se mandó: faltan RESEND_API_KEY o ADMIN_ALERT_EMAIL, o la dirección no es válida.");
    return false;
  }
  return deliver({ ...message, to: config.to, from: config.from }, deps.transport ?? resendTransport(config.apiKey));
}
