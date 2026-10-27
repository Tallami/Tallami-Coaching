import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AlertStatus } from "@/admin/alerts/config";
import { countPasskeys, insertPasskey } from "@/admin/auth/passkeys";
import { createSession, listActiveSessions } from "@/admin/auth/sessions";
import { closeDb } from "@/db/close";
import type { Db } from "@/db/client";
import { openPglite } from "@/db/pglite";
import {
  RESET_ALERT_DEVICE,
  RESET_CONFIRMATION,
  ask,
  describeAlertOutcome,
  describeResetResult,
  describeTarget,
  isConfirmed,
  runPasskeyReset,
} from "../../scripts/admin-reset-passkeys";
import { createTestDb } from "../helpers/db";

const SCRIPT = fileURLToPath(new URL("../../scripts/admin-reset-passkeys.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url));

let tempDir: string;
let pgliteDir: string;

beforeEach(() => {
  // Una carpeta propia en la carpeta temporal del sistema: el comando nunca toca `.data/pglite`.
  tempDir = mkdtempSync(path.join(os.tmpdir(), "tallami-reset-passkeys-"));
  pgliteDir = path.join(tempDir, "pglite");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Deja en la carpeta una base con 2 llaves y 1 sesión abierta, y la cierra (PGlite no admite dos procesos a la vez). */
async function seedFolder(): Promise<void> {
  const db = await openPglite(pgliteDir);
  try {
    const ids: string[] = [];
    for (const credentialId of ["credencial-1", "credencial-2"]) {
      const passkey = await insertPasskey(
        db,
        { credentialId, publicKey: "clave-publica", counter: 0, transports: [], name: credentialId },
        { onlyIfNone: false },
      );
      if (!passkey) throw new Error("No se guardó la llave de prueba.");
      ids.push(passkey.id);
    }
    await createSession(db, { passkeyId: ids[0], device: "Chrome en Windows", reauthed: true });
  } finally {
    await closeDb(db);
  }
}

/** Lo que quedó en la carpeta: cuántas llaves y cuántas sesiones abiertas. */
async function readFolder(): Promise<{ passkeys: number; openSessions: number }> {
  const db = await openPglite(pgliteDir);
  try {
    return { passkeys: await countPasskeys(db), openSessions: (await listActiveSessions(db)).length };
  } finally {
    await closeDb(db);
  }
}

/** Corre el comando como `npm run admin:reset-passkeys`, con lo que se escribe por la entrada estándar. */
function runScript(input: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [TSX, SCRIPT], {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      PGLITE_DIR: pgliteDir,
      DATABASE_URL: "",
      VERCEL: "",
      RESEND_API_KEY: "",
      ADMIN_ALERT_EMAIL: "",
      ADMIN_ALERT_FROM: "",
      ...env,
    },
  });
}

describe("npm run admin:reset-passkeys", () => {
  test("with the right phrase it deletes the keys, closes the sessions and says what it did", async () => {
    await seedFolder();

    const result = runScript(`${RESET_CONFIRMATION}\n`);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("se borraron 2 llaves");
    expect(result.stdout).toContain("se cerró 1 sesión abierta");
    expect(await readFolder()).toEqual({ passkeys: 0, openSessions: 0 });
  });

  test("the phrase also works from a Windows terminal, with the line ending \\r\\n", async () => {
    await seedFolder();

    const result = runScript(`${RESET_CONFIRMATION}\r\n`);

    expect(result.status).toBe(0);
    expect(await readFolder()).toEqual({ passkeys: 0, openSessions: 0 });
  });

  test.each([
    ["another phrase", "borrar todo\n"],
    ["the phrase in lower case", "borrar llaves\n"],
    ["only half of it", "BORRAR\n"],
    ["a yes", "si\n"],
    ["nothing", ""],
    ["an empty line", "\n"],
  ])("with %s it touches nothing and exits with code 1", async (_label, input) => {
    await seedFolder();

    const result = runScript(input);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No se borró nada");
    expect(result.stdout).not.toContain("Listo");
    expect(await readFolder()).toEqual({ passkeys: 2, openSessions: 1 });
  });

  test("shows which database it is about to act on before asking, and never a password", () => {
    const result = runScript("no\n");

    expect(result.stdout).toContain(pgliteDir);
    expect(result.stdout).toContain(RESET_CONFIRMATION);
  });

  test("on a database without keys it still finishes well and says there was nothing to delete", async () => {
    const result = runScript(`${RESET_CONFIRMATION}\n`);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("no había llaves");
  });
});

describe("isConfirmed", () => {
  test("accepts exactly the phrase, ignoring the end of line and the spaces around it", () => {
    expect(isConfirmed(RESET_CONFIRMATION)).toBe(true);
    expect(isConfirmed(`${RESET_CONFIRMATION}\n`)).toBe(true);
    expect(isConfirmed(`  ${RESET_CONFIRMATION}\r\n`)).toBe(true);
  });

  test("refuses everything else", () => {
    for (const answer of ["", "BORRAR", "borrar llaves", "BORRAR  LLAVES", "BORRAR LLAVES AHORA", "BORRAR LLAVES\nBORRAR LLAVES"]) {
      expect(isConfirmed(answer), answer).toBe(false);
    }
  });
});

// La pregunta de la terminal (cuando se corre a mano, sin la frase por pipe), con una entrada de mentira.
describe("ask", () => {
  test("shows the question and answers with the first line typed", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = "";
    output.on("data", (chunk: Buffer) => {
      shown += chunk.toString("utf8");
    });

    const answer = ask("> ", input, output);
    input.write(`${RESET_CONFIRMATION}\r\n`);

    expect(isConfirmed(await answer)).toBe(true);
    expect(shown).toContain("> ");
  });

  test("an input that closes without an answer (Ctrl+D) is an empty answer, not a hang", async () => {
    const input = new PassThrough();

    const answer = ask("> ", input, new PassThrough());
    input.end();

    expect(await answer).toBe("");
  });
});

describe("describeTarget", () => {
  test("a remote database is named by its server and its user, never by its password", () => {
    const text = describeTarget({
      DATABASE_URL: "postgres://postgres.abcdef:UnaClaveSecreta123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
    });

    expect(text).toContain("aws-0-sa-east-1.pooler.supabase.com");
    expect(text).toContain("DATABASE_URL");
    expect(text).not.toContain("UnaClaveSecreta123");
    // Los servidores del pooler son de una región y los comparten muchos proyectos: lo que identifica el proyecto es el usuario (`postgres.<código>`).
    expect(text).toBe(
      "la base remota de DATABASE_URL (servidor aws-0-sa-east-1.pooler.supabase.com, usuario postgres.abcdef)",
    );
  });

  test("the direct connection shows its plain user, and a user without a password shows too", () => {
    expect(describeTarget({ DATABASE_URL: "postgres://postgres:Secreta987@db.abcdef.supabase.co:5432/postgres" })).toBe(
      "la base remota de DATABASE_URL (servidor db.abcdef.supabase.co, usuario postgres)",
    );
    expect(describeTarget({ DATABASE_URL: "postgres://postgres.abcdef@aws-0-sa-east-1.pooler.supabase.com/postgres" })).toContain(
      "usuario postgres.abcdef",
    );
  });

  test("a user written with percent signs is shown as it reads, and still never the password", () => {
    const text = describeTarget({ DATABASE_URL: "postgres://mi%20usuario:Clave%40Secreta@servidor.example.com/postgres" });

    expect(text).toContain("usuario mi usuario");
    expect(text).not.toContain("Clave");
    expect(text).not.toContain("Secreta");
  });

  test("an address without a user names only the server", () => {
    expect(describeTarget({ DATABASE_URL: "postgres://servidor.example.com:5432/postgres" })).toBe(
      "la base remota de DATABASE_URL (servidor servidor.example.com)",
    );
  });

  test("a DATABASE_URL that cannot be read does not leak its text either", () => {
    const text = describeTarget({ DATABASE_URL: "esto-no-es-una-url-con-clave-secreta" });

    expect(text).toContain("DATABASE_URL");
    expect(text).not.toContain("clave-secreta");
  });

  test("without DATABASE_URL it is the local database, in the folder of PGLITE_DIR or the default one", () => {
    expect(describeTarget({ PGLITE_DIR: "/tmp/mi-base" })).toContain("/tmp/mi-base");
    expect(describeTarget({})).toContain(".data/pglite");
    expect(describeTarget({ DATABASE_URL: "   ", PGLITE_DIR: "  " })).toContain(".data/pglite");
    expect(describeTarget({})).toContain("local");
    // El mismo valor que abre la base (`getPgliteDir`): sin los espacios de los costados.
    expect(describeTarget({ PGLITE_DIR: "  /tmp/mi-base \n" })).toBe("la base local (PGlite), en la carpeta /tmp/mi-base");
  });
});

describe("describeResetResult", () => {
  test("counts keys and sessions in singular and plural", () => {
    expect(describeResetResult({ passkeys: 2, sessions: 3 })).toContain("se borraron 2 llaves y se cerraron 3 sesiones abiertas");
    expect(describeResetResult({ passkeys: 1, sessions: 1 })).toContain("se borró 1 llave y se cerró 1 sesión abierta");
    expect(describeResetResult({ passkeys: 0, sessions: 0 })).toContain("no había llaves");
  });

  test("tells what the next login will ask for", () => {
    expect(describeResetResult({ passkeys: 2, sessions: 0 })).toContain("registrar una llave nueva");
  });
});

describe("describeAlertOutcome", () => {
  const cases: Array<[string, AlertStatus, string]> = [
    ["not configured", { kind: "off" }, "sin configurar"],
    ["a wrong address", { kind: "invalid", variable: "ADMIN_ALERT_EMAIL" }, "ADMIN_ALERT_EMAIL"],
    ["a configured one", { kind: "active", maskedEmail: "t***@gmail.com", usesTestSender: true }, "se intentó mandar a t***@gmail.com"],
  ];

  test.each(cases)("%s", (_label, status, expected) => {
    expect(describeAlertOutcome(status)).toContain(expected);
  });

  test("never says the email was sent: sendSecurityAlert swallows its failures, so all it knows is that it tried", () => {
    const text = describeAlertOutcome({ kind: "active", maskedEmail: "t***@gmail.com", usesTestSender: false });

    expect(text).not.toMatch(/se mandó/);
    expect(text).toContain("Si algo falló, el motivo aparece arriba");
  });
});

describe("runPasskeyReset", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
    const passkey = await insertPasskey(
      db,
      { credentialId: "credencial", publicKey: "clave", counter: 0, transports: [], name: "PC" },
      { onlyIfNone: false },
    );
    await createSession(db, { passkeyId: passkey?.id ?? "", device: "Chrome en Windows", reauthed: true });
  });

  test("resets and then sends the 'passkeys-reset' alert, from the recovery command", async () => {
    const sendAlert = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-10-23T15:00:00.000Z");

    const result = await runPasskeyReset(db, { sendAlert, now });

    expect(result).toEqual({ passkeys: 1, sessions: 1 });
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledWith("passkeys-reset", { device: RESET_ALERT_DEVICE, country: null }, { now });
    expect(await countPasskeys(db)).toBe(0);
  });

  test("waits for the alert before finishing: the command closes the process right after, and an unsent email would be lost", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: string[] = [];
    const sendAlert = vi.fn().mockImplementation(async () => {
      await gate;
      events.push("alert sent");
    });

    const running = runPasskeyReset(db, { sendAlert }).then(() => events.push("finished"));
    await vi.waitFor(() => expect(sendAlert).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual([]);

    release();
    await running;
    expect(events).toEqual(["alert sent", "finished"]);
  });

  test("sends no alert when the reset itself fails", async () => {
    const sendAlert = vi.fn().mockResolvedValue(undefined);
    const broken = {
      transaction: () => Promise.reject(new Error("la base no contesta")),
    } as unknown as Db;

    await expect(runPasskeyReset(broken, { sendAlert })).rejects.toThrow("la base no contesta");

    expect(sendAlert).not.toHaveBeenCalled();
  });
});
