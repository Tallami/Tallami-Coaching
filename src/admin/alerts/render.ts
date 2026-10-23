// El texto de cada aviso de seguridad: asunto, texto plano y un HTML mínimo. Es una
// función pura: la hora y los datos del pedido los pone quien llama. Cada aviso dice
// qué pasó, cuándo (hora de Argentina), desde qué dispositivo y de qué país, y qué
// hacer si no fue Tallami. Nunca lleva contraseñas, códigos ni enlaces para entrar.

import { ENROLLMENT_CODE_MS } from "../auth/policy";
import { LOGIN_WINDOW_MS } from "../auth/rate-limit";
import { dateToArgentinaLocal, formatDay } from "../dates";

/** Lo que dispara un aviso. `passkeys-reset` lo manda el comando de recuperación. */
export type SecurityEvent =
  | "login"
  | "first-passkey"
  | "passkey-added"
  | "passkey-removed"
  | "code-generated"
  | "sessions-closed"
  | "login-blocked"
  | "passkeys-reset";

/** Desde dónde pasó. `country` es el código de dos letras que informa Vercel, si lo informa. */
export type AlertContext = {
  device: string;
  country: string | null;
  /** El nombre de la llave, para los avisos que hablan de una. */
  passkeyName?: string;
};

export type RenderedAlert = { subject: string; text: string; html: string };

/** Qué hacer si no fue Tallami. Es la misma frase en todos los avisos. */
const IF_NOT_YOU = "Si no fuiste vos: entrá y cerrá todas las sesiones, y cambiá la contraseña.";

const SIGNATURE = "Aviso automático del panel de Tallami Coaching.";

const MINUTE_MS = 60_000;

/** Una duración en minutos enteros, para decirla en el texto ("10"): sale de la política, no de una copia del número. */
function minutes(ms: number): number {
  return Math.round(ms / MINUTE_MS);
}

const EVENT_TEXT: Record<SecurityEvent, { subject: string; what: string }> = {
  login: {
    subject: "Ingreso al panel de Tallami",
    what: "Se ingresó al panel con la contraseña y una llave de acceso.",
  },
  "first-passkey": {
    subject: "Primera llave de acceso en el panel de Tallami",
    what: "Se registró la primera llave de acceso del panel y se ingresó con ella.",
  },
  "passkey-added": {
    subject: "Llave de acceso agregada al panel de Tallami",
    what: "Se agregó una llave de acceso al panel.",
  },
  "passkey-removed": {
    subject: "Llave de acceso borrada del panel de Tallami",
    what: "Se borró una llave de acceso del panel. Las sesiones que se habían abierto con ella se cerraron.",
  },
  "code-generated": {
    subject: "Código para registrar otro dispositivo en el panel de Tallami",
    what: `Se generó un código para registrar la llave de otro dispositivo. Vence a los ${minutes(ENROLLMENT_CODE_MS)} minutos y sirve una sola vez.`,
  },
  "sessions-closed": {
    subject: "Se cerraron todas las sesiones del panel de Tallami",
    what: "Se cerraron todas las sesiones abiertas del panel, incluida la de quien lo pidió.",
  },
  "login-blocked": {
    subject: "Ingreso bloqueado en el panel de Tallami",
    // Se manda un solo aviso de bloqueo por ventana, sea de la conexión que sea (`blocked.ts`).
    what: `Se bloquearon intentos de ingreso al panel: una conexión llegó al máximo de intentos fallidos (contraseña, llave o código) y queda bloqueada hasta que pasen ${minutes(LOGIN_WINDOW_MS)} minutos de sus intentos. En ese tiempo no se manda otro aviso de bloqueo, aunque otras conexiones también se bloqueen.`,
  },
  "passkeys-reset": {
    subject: "Se borraron las llaves de acceso del panel de Tallami",
    what: "Se borraron todas las llaves de acceso del panel y se cerraron todas las sesiones. El próximo ingreso con la contraseña pide registrar una llave nueva.",
  },
};

/** El código de país de Vercel, o `null` si no son exactamente dos letras (es un encabezado: no se confía en él). */
export function parseCountryCode(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
}

const countryNames = new Intl.DisplayNames(["es"], { type: "region" });

/** "AR" → "Argentina (AR)"; un código que Intl no conoce se muestra tal cual. */
function describeCountry(code: string | null): string {
  if (code === null) return "país desconocido";
  try {
    const name = countryNames.of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

/** Un nombre de llave en una sola línea: sin saltos ni caracteres de control, que podrían inventar líneas en el texto. */
function singleLine(text: string): string {
  return text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").trim();
}

/** "21/10/2026 00:30", en la hora de Argentina. */
function formatArgentinaTime(date: Date): string {
  const [day, time] = dateToArgentinaLocal(date).split("T");
  return `${formatDay(day)} ${time}`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * El aviso del evento `event`, ocurrido a la hora `now` desde `context`. El HTML
 * escapa todo lo que no es texto fijo (el nombre de una llave lo elige Tallami, y el
 * dispositivo sale de un encabezado del pedido).
 */
export function renderSecurityAlert(event: SecurityEvent, context: AlertContext, now: Date): RenderedAlert {
  const { subject, what } = EVENT_TEXT[event];
  const details: Array<[label: string, value: string]> = [
    ["Cuándo", `${formatArgentinaTime(now)} (hora de Argentina)`],
    ["Dispositivo", singleLine(context.device)],
    ["Ubicación", describeCountry(parseCountryCode(context.country))],
  ];
  if (context.passkeyName !== undefined) details.push(["Llave", singleLine(context.passkeyName)]);

  const text = [
    what,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    IF_NOT_YOU,
    "",
    SIGNATURE,
  ].join("\n");

  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#111111">',
    `<p style="margin:0 0 16px"><strong>${escapeHtml(what)}</strong></p>`,
    ...details.map(
      ([label, value]) => `<p style="margin:0 0 4px">${escapeHtml(label)}: <strong>${escapeHtml(value)}</strong></p>`,
    ),
    `<p style="margin:16px 0">${escapeHtml(IF_NOT_YOU)}</p>`,
    `<p style="margin:0;color:#666666;font-size:14px">${escapeHtml(SIGNATURE)}</p>`,
    "</div>",
  ].join("\n");

  return { subject, text, html };
}
