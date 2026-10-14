import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { verifyPassword } from "@/admin/auth/password";
import { escapeForDotenv, formatInstructions } from "../../scripts/admin-password";

const SCRIPT = fileURLToPath(new URL("../../scripts/admin-password.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url));
const PASSWORD = "una-clave-larga-de-prueba";

/** Corre el script como `npm run admin:password`, con la contraseña por la entrada estándar. */
function runScript(input: string) {
  return spawnSync(process.execPath, [TSX, SCRIPT], { input, encoding: "utf8" });
}

/** El valor que sigue al nombre de la variable, en la línea `NOMBRE=valor`. */
function envLine(stdout: string, name: string): string {
  const line = stdout.split("\n").find((candidate) => candidate.trim().startsWith(`${name}=`));
  if (!line) throw new Error(`No hay una línea ${name}= en la salida`);
  return line.trim().slice(name.length + 1);
}

describe("escapeForDotenv", () => {
  test("puts a backslash before every dollar sign", () => {
    expect(escapeForDotenv("scrypt$131072$8$1$c2Fs$aGFz")).toBe(
      "scrypt\\$131072\\$8\\$1\\$c2Fs\\$aGFz",
    );
    expect(escapeForDotenv("sin-signos")).toBe("sin-signos");
  });
});

describe("formatInstructions", () => {
  test("gives the raw value for Vercel and the escaped one for .env files", () => {
    const text = formatInstructions("scrypt$1$2", "secreto");

    expect(text).toContain("  scrypt$1$2");
    expect(text).toContain("ADMIN_PASSWORD_HASH=scrypt\\$1\\$2");
    expect(text).toContain("ADMIN_SESSION_SECRET=secreto");
  });
});

describe("npm run admin:password", () => {
  test("prints a hash that verifies the password, and a fresh session secret", async () => {
    const result = runScript(`${PASSWORD}\n`);

    expect(result.status).toBe(0);
    const dotenvHash = envLine(result.stdout, "ADMIN_PASSWORD_HASH");
    const hash = dotenvHash.replaceAll("\\$", "$");
    expect(hash).toMatch(/^scrypt\$131072\$8\$1\$/);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword("otra-clave-distinta", hash)).toBe(false);
    expect(envLine(result.stdout, "ADMIN_SESSION_SECRET").length).toBeGreaterThanOrEqual(32);
  });

  test("never prints the password", () => {
    const result = runScript(`${PASSWORD}\n`);

    expect(result.stdout).not.toContain(PASSWORD);
    expect(result.stderr).not.toContain(PASSWORD);
  });

  test.each([
    ["an empty password", "\n"],
    ["a short one", "corta\n"],
  ])("refuses %s", (_label, input) => {
    const result = runScript(input);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("al menos 12 caracteres");
    expect(result.stdout).not.toContain("scrypt$");
  });
});
