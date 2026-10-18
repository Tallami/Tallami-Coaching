import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

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

describe("source files", () => {
  test("finds the code of the project", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  test("none has a literal NUL character or a byte order mark", () => {
    const offenders = files
      .filter((file) => {
        const bytes = readFileSync(file);
        const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
        return hasBom || bytes.includes(0);
      })
      .map((file) => path.relative(ROOT, file));

    expect(offenders).toEqual([]);
  });

  test("the CSV writes its byte order mark with an escape, never as the character itself", () => {
    const csv = readFileSync(path.join(ROOT, "src", "admin", "export", "csv.ts"), "utf8");

    expect(csv).toContain(String.raw`const BOM = "\uFEFF";`);
    expect(csv).not.toContain("\uFEFF");
  });
});
