import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { passkeyNameSchema } from "@/admin/auth/passkey-name";
import { PASSKEY_NAME_MAX_LENGTH } from "@/admin/auth/policy";

// El nombre de una llave se valida igual en los tres lugares donde se registra o se renombra una
// (Configuración → Seguridad, la primera llave y el registro con un código): una sola definición.

const ACTION_FILES = [
  "src/app/admin/configuracion/seguridad/actions.ts",
  "src/app/admin/login/llave/code-actions.ts",
  "src/app/admin/login/primera-llave/actions.ts",
];

describe("passkeyNameSchema", () => {
  test("accepts a name of 1 to the maximum characters and trims it", () => {
    expect(passkeyNameSchema.parse("Celular")).toBe("Celular");
    expect(passkeyNameSchema.parse("  PC de escritorio  ")).toBe("PC de escritorio");
    expect(passkeyNameSchema.parse("x".repeat(PASSKEY_NAME_MAX_LENGTH))).toHaveLength(PASSKEY_NAME_MAX_LENGTH);
  });

  test.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["too long", "x".repeat(PASSKEY_NAME_MAX_LENGTH + 1)],
    ["not a text", 42],
    ["nothing", undefined],
  ])("refuses a name that is %s", (_label, name) => {
    expect(passkeyNameSchema.safeParse(name).success).toBe(false);
  });
});

describe("the actions that take a key name", () => {
  test.each(ACTION_FILES)("%s uses the shared schema and does not define its own", (file) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

    expect(source).toContain('from "@/admin/auth/passkey-name"');
    expect(source).not.toMatch(/z\.string\(\)\.trim\(\)\.min\(1\)\.max\(PASSKEY_NAME_MAX_LENGTH\)/);
    expect(source).not.toMatch(/const nameSchema\b/);
  });
});
