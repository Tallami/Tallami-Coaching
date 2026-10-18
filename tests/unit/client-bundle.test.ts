import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

// Lo que importa un componente de cliente (`"use client"`) viaja al navegador.
// zod pesa y las validaciones son del servidor: un formulario que trae zod por
// una lista de categorías o un límite de largo (en lugar de leerlos de un módulo
// sin zod, como `src/admin/customers/limits.ts`) engorda el panel para nada.
//
// Se sigue lo que cada componente de cliente importa, directo y a través de los
// módulos que importan esos, sin entrar a los archivos `"use server"` (para el
// navegador son solo una llamada al servidor) ni a los `import type` (se borran).

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const CLIENT_DIRS = ["admin", path.join("components", "admin")].map((dir) => path.join(SRC, dir));
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;

function listCodeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listCodeFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function startsWithDirective(source: string, directive: string): boolean {
  return new RegExp(String.raw`^\s*(?:(?://[^\n]*|/\*[\s\S]*?\*/)\s*)*["']${directive}["']`).test(source);
}

/** El archivo al que apunta un import de `@/…` o relativo, o `null` si es un paquete. */
function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (base === null) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Los archivos que viajan al navegador con `entry`, sin contar los de servidor, y los que importan zod. */
function zodImportersReachedBy(entry: string): string[] {
  const seen = new Set<string>();
  const importers: string[] = [];
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    if (file !== entry && startsWithDirective(source, "use server")) continue;
    for (const [, specifier] of source.matchAll(IMPORT)) {
      if (specifier === "zod") importers.push(path.relative(ROOT, file));
      const next = resolveImport(file, specifier);
      if (next) pending.push(next);
    }
  }
  return importers;
}

const clientFiles = CLIENT_DIRS.flatMap(listCodeFiles).filter((file) =>
  startsWithDirective(readFileSync(file, "utf8"), "use client"),
);

describe("components that run in the browser", () => {
  test("finds the client components of the panel", () => {
    const names = clientFiles.map((file) => path.basename(file));

    expect(names).toEqual(
      expect.arrayContaining(["settings-form.tsx", "student-form.tsx", "sale-form.tsx", "uninvoiced-list.tsx"]),
    );
  });

  test.each(clientFiles.map((file) => [path.relative(ROOT, file), file]))("%s does not pull zod into the browser", (_name, file) => {
    expect(zodImportersReachedBy(file)).toEqual([]);
  });
});
