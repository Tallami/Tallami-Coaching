import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { salesToCsv } from "@/admin/export/csv";

// Un carácter NUL o una marca de orden de bytes (BOM) escritos de verdad dentro
// de un archivo de código no se ven en el editor y rompen cosas (un BOM al
// principio de un archivo de código, un NUL en un texto que va a Postgres). Cuando
// hacen falta se escriben con su secuencia de escape ("\u0000", "\uFEFF"): el
// CSV del contador, por ejemplo, empieza con un BOM y su código lo escribe así.

const ROOT = process.cwd();
const SOURCE_DIRS = ["src", "tests", "scripts", "drizzle"];
const SOURCE_FILES = ["next.config.ts", "playwright.config.ts", "playwright.demo.config.ts", "vitest.config.ts"];
const CODE_FILE = /\.(tsx?|mjs|cjs|jsx?|sql|json|css)$/;
const IGNORED_DIRS = new Set(["node_modules", ".next", "tweet-snapshots"]);

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return IGNORED_DIRS.has(entry.name) ? [] : listFiles(full);
    return CODE_FILE.test(entry.name) ? [full] : [];
  });
}

const files = [
  ...SOURCE_DIRS.flatMap((dir) => listFiles(path.join(ROOT, dir))),
  ...SOURCE_FILES.map((file) => path.join(ROOT, file)),
];

/** ¿Tiene el texto un NUL o un BOM de verdad (el carácter, no su escape)? */
function hasLiteralInvisibles(text: string): boolean {
  return text.includes("\uFEFF") || text.includes("\u0000");
}

describe("source files", () => {
  test("finds the code of the project", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  test("none has a literal NUL character or a byte order mark, at the start or anywhere else", () => {
    const offenders = files
      .filter((file) => hasLiteralInvisibles(readFileSync(file, "utf8")) || readFileSync(file).includes(0))
      .map((file) => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });

  test("the check does see them: a text with either one is caught, and one with only the escape is not", () => {
    expect(hasLiteralInvisibles('const BOM = "\uFEFF";')).toBe(true);
    expect(hasLiteralInvisibles("a\u0000b")).toBe(true);
    expect(hasLiteralInvisibles(String.raw`const BOM = "\uFEFF";`)).toBe(false);
  });

  test("and the CSV of the accountant still starts with a byte order mark: it is written with an escape", () => {
    const csv = salesToCsv([]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).startsWith("Fecha de cobro;")).toBe(true);
    // Los tres bytes de un BOM en UTF-8: lo que Excel necesita para leer bien los acentos.
    expect([...new TextEncoder().encode(csv).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
