// Recuperar el acceso al panel cuando se perdieron todos los dispositivos (o cambió el
// dominio de la web, que deja inservibles las llaves): borra TODAS las llaves de acceso y
// cierra TODAS las sesiones. El siguiente ingreso con la contraseña pide registrar una
// llave nueva, como el primer día.
//
//   npm run admin:reset-passkeys
//
// Pide escribir la frase BORRAR LLAVES. Con la frase por la entrada estándar no
// pregunta nada:
//
//   echo "BORRAR LLAVES" | npm run admin:reset-passkeys
//
// Actúa sobre la base de `DATABASE_URL` si está definida (la de producción: la forma
// segura de cargarla es la del README, "Ponerlo en línea", paso 3) y, si no, sobre la
// base local (PGlite). Antes de preguntar dice sobre cuál va a actuar, para no borrar las
// llaves de una creyendo que son las de la otra.
//
// Solo la corre quien tiene las credenciales de la base, o sea Tallami: ninguna página
// del panel la llama. Manda el aviso por email `passkeys-reset` si Resend está
// configurado en esta terminal (`RESEND_API_KEY` y `ADMIN_ALERT_EMAIL`): este comando no
// lee ningún archivo `.env`, así que las variables hay que cargarlas como `DATABASE_URL`.

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { getAlertStatus, type AlertStatus } from "../src/admin/alerts/config";
import { sendSecurityAlert } from "../src/admin/alerts/send";
import { resetPasskeys, type PasskeyResetResult } from "../src/admin/auth/reset-passkeys";
import { DEFAULT_PGLITE_DIR, getDb, type Db } from "../src/db/client";
import { closeDb } from "../src/db/close";
import { getDatabaseUrl } from "../src/db/config";

/** La frase que hay que escribir, tal cual, para borrar. */
export const RESET_CONFIRMATION = "BORRAR LLAVES";
/** Lo que dice el aviso por email en "Dispositivo". */
export const RESET_ALERT_DEVICE = "Comando de recuperación (npm run admin:reset-passkeys)";

/** No se escribió la frase: no se tocó nada. */
export class ResetCancelledError extends Error {
  constructor() {
    super(`No se borró nada: para seguir hay que escribir exactamente ${RESET_CONFIRMATION}.`);
    this.name = "ResetCancelledError";
  }
}

/** ¿Lo escrito es la frase? Sin distinguir el fin de línea ni los espacios de los costados, y nada más. */
export function isConfirmed(answer: string): boolean {
  return answer.trim() === RESET_CONFIRMATION;
}

/** El servidor de una `DATABASE_URL`, o `null` si no se puede leer. Nunca el usuario ni la contraseña. */
function hostOf(databaseUrl: string): string | null {
  try {
    return new URL(databaseUrl).hostname || null;
  } catch {
    return null;
  }
}

/** Sobre qué base va a actuar el comando, dicho para una persona. Nunca lleva la contraseña de la base. */
export function describeTarget(env: { DATABASE_URL?: string; PGLITE_DIR?: string }): string {
  const url = env.DATABASE_URL?.trim();
  if (url) {
    const host = hostOf(url);
    return host
      ? `la base remota de DATABASE_URL (servidor ${host})`
      : "la base remota de DATABASE_URL";
  }
  return `la base local (PGlite), en la carpeta ${env.PGLITE_DIR?.trim() || DEFAULT_PGLITE_DIR}`;
}

function counted(amount: number, singular: string, plural: string): string {
  return `${amount} ${amount === 1 ? singular : plural}`;
}

/** Lo que el comando le cuenta a la persona al terminar. */
export function describeResetResult({ passkeys, sessions }: PasskeyResetResult): string {
  const next = "El próximo ingreso con la contraseña te pide registrar una llave nueva.";
  if (passkeys === 0 && sessions === 0) {
    return `Listo: no había llaves ni sesiones abiertas, así que no cambió nada. ${next}`;
  }
  const keys = passkeys === 0 ? "no había llaves" : `${passkeys === 1 ? "se borró" : "se borraron"} ${counted(passkeys, "llave", "llaves")}`;
  const closed =
    sessions === 0
      ? "no había sesiones abiertas"
      : `${sessions === 1 ? "se cerró" : "se cerraron"} ${counted(sessions, "sesión abierta", "sesiones abiertas")}`;
  return `Listo: ${keys} y ${closed}. ${next}`;
}

/** Qué pasó con el aviso por email, según cómo está configurado en esta terminal. */
export function describeAlertOutcome(status: AlertStatus): string {
  if (status.kind === "off") {
    return "Aviso por email: sin configurar en esta terminal (hacen falta RESEND_API_KEY y ADMIN_ALERT_EMAIL), no se mandó.";
  }
  if (status.kind === "invalid") {
    return `Aviso por email: no se mandó, ${status.variable} no es una dirección de email.`;
  }
  return `Aviso por email: se mandó a ${status.maskedEmail}. Si algo falló, el motivo aparece arriba.`;
}

/**
 * Hace el reinicio y avisa por email. Espera el aviso: el comando termina el proceso apenas
 * vuelve esta función, y un email sin mandar se perdería (acá no hay `after()`: no hay un
 * pedido de Next). `sendSecurityAlert` no tira nunca, así que un email que falla no deshace
 * un reinicio que ya se hizo. `deps` es para los tests.
 */
export async function runPasskeyReset(
  db: Db,
  deps: { sendAlert?: typeof sendSecurityAlert; now?: Date } = {},
): Promise<PasskeyResetResult> {
  const now = deps.now ?? new Date();
  const result = await resetPasskeys(db, now);
  const sendAlert = deps.sendAlert ?? sendSecurityAlert;
  await sendAlert("passkeys-reset", { device: RESET_ALERT_DEVICE, country: null }, { now });
  return result;
}

/** Lo que llegó por la entrada estándar (la frase por pipe). */
async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Pregunta y espera una línea. Si se cierra la entrada sin responder (Ctrl+D), es una respuesta
 * vacía. `input` y `output` son la terminal; los tests pasan otros.
 */
export function ask(
  question: string,
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): Promise<string> {
  return new Promise((resolve) => {
    const lines = createInterface({ input, output });
    lines.once("close", () => resolve(""));
    lines.question(question, (answer) => {
      resolve(answer);
      lines.close();
    });
  });
}

async function readAnswer(): Promise<string> {
  return process.stdin.isTTY ? ask("> ") : readAllStdin();
}

function introduction(target: string): string {
  return [
    "Este comando borra TODAS las llaves de acceso del panel y cierra TODAS las sesiones abiertas.",
    `Va a actuar sobre ${target}.`,
    "",
    "Usalo solo si perdiste todos tus dispositivos o si cambió el dominio de la web.",
    "Si todavía entrás con alguno, borrá la llave que perdiste desde Configuración → Seguridad.",
    "",
    `Para seguir, escribí ${RESET_CONFIRMATION} y apretá Enter. Cualquier otra cosa cancela y no se borra nada.`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const target = describeTarget({ DATABASE_URL: getDatabaseUrl(), PGLITE_DIR: process.env.PGLITE_DIR });
  process.stdout.write(`${introduction(target)}\n`);
  // Se confirma antes de abrir la base: una frase equivocada no toca nada, ni siquiera la conexión.
  if (!isConfirmed(await readAnswer())) throw new ResetCancelledError();

  const db = await getDb();
  try {
    const result = await runPasskeyReset(db);
    process.stdout.write(`\n${describeResetResult(result)}\n${describeAlertOutcome(getAlertStatus())}\n`);
  } finally {
    await closeDb(db);
  }
}

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
