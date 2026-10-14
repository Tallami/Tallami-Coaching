// Genera el hash de la contraseña del panel de admin (`ADMIN_PASSWORD_HASH`) y,
// de paso, un secreto nuevo para firmar las sesiones (`ADMIN_SESSION_SECRET`).
//
//   npm run admin:password
//
// Pide la contraseña sin mostrarla (dos veces, para evitar un error de tipeo).
// Con la contraseña por la entrada estándar no pregunta nada:
//
//   echo "mi-contraseña-larga" | npm run admin:password
//
// La contraseña nunca se pasa como argumento ni se imprime: quedaría en el
// historial de la terminal.

import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { hashPassword } from "../src/admin/auth/password";

const MIN_PASSWORD_LENGTH = 12;
const SESSION_SECRET_BYTES = 48;

const CTRL_C = String.fromCharCode(3);
const CTRL_D = String.fromCharCode(4);
const BACKSPACE = String.fromCharCode(127);

/**
 * Next.js expande `$VARIABLE` en los archivos `.env*`: el hash lleva muchos
 * `$` y se rompería. En un `.env` van escapados con barra invertida; en las
 * variables de Vercel van tal cual.
 */
export function escapeForDotenv(value: string): string {
  return value.replaceAll("$", "\\$");
}

/** El texto que se muestra al terminar: dónde cargar cada valor. */
export function formatInstructions(hash: string, sessionSecret: string): string {
  return [
    "Listo. Cargá estas dos variables de entorno.",
    "",
    "En Vercel (Project Settings > Environment Variables), el valor tal cual:",
    "",
    "  ADMIN_PASSWORD_HASH",
    `  ${hash}`,
    "",
    "  ADMIN_SESSION_SECRET (un secreto nuevo; si ya tenés uno, conservalo)",
    `  ${sessionSecret}`,
    "",
    "En un archivo .env.local (el $ lleva barra invertida porque Next.js lo expande):",
    "",
    `  ADMIN_PASSWORD_HASH=${escapeForDotenv(hash)}`,
    `  ADMIN_SESSION_SECRET=${sessionSecret}`,
    "",
  ].join("\n");
}

/** Lee todo lo que llega por la entrada estándar (contraseña por pipe). */
async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** Pregunta en la terminal sin mostrar lo que se escribe. */
function readHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    let value = "";

    const finish = (action: () => void) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      action();
    };

    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n" || char === CTRL_D) {
          return finish(() => resolve(value));
        }
        if (char === CTRL_C) {
          return finish(() => reject(new Error("Cancelado.")));
        }
        value = char === BACKSPACE || char === "\b" ? value.slice(0, -1) : value + char;
      }
    };

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    return (await readAllStdin()).replace(/\r?\n$/, "");
  }
  const password = await readHidden("Contraseña del panel: ");
  if (password.length < MIN_PASSWORD_LENGTH) return password;
  const again = await readHidden("Repetila: ");
  if (again !== password) {
    throw new Error("Las dos contraseñas no coinciden.");
  }
  return password;
}

async function main(): Promise<void> {
  const password = await readPassword();
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `La contraseña tiene que tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  }
  const hash = await hashPassword(password);
  const sessionSecret = randomBytes(SESSION_SECRET_BYTES).toString("base64");
  process.stdout.write(`\n${formatInstructions(hash, sessionSecret)}`);
}

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
