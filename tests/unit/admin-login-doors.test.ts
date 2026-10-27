import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

// `login/` es una de las dos puertas públicas del panel: sus páginas y acciones NO empiezan con
// `requireAdmin()` (justamente son lo que abre la sesión), así que `admin-guards.test.ts` las deja
// afuera. Eso es un hueco si alguien suma ahí una acción o una página nueva sin verificar nada:
// quedaría abierta y ningún test lo notaría. Este test fija la lista EXACTA de lo que `login/`
// expone. Una puerta nueva rompe el test y obliga a decidir a conciencia: verificar el ingreso a
// medio camino (`beginLoginStep` / `finishLoginStep`, o la cookie), escribirle su test y recién ahí
// sumarla acá.

const LOGIN_DIR = path.join(process.cwd(), "src", "app", "admin", "login");

interface DoorFile {
  /** ¿Tiene la directiva "use server" a nivel de archivo? Entonces cada export es un punto de entrada público. */
  useServer: boolean;
  /** Los nombres que exporta como valor (`default` para la página). Los tipos no cuentan. */
  exports: string[];
  /** Cuántas funciones tienen su propia directiva "use server" adentro (acciones en línea, también públicas). */
  inlineServerActions: number;
}

/** Todos los archivos bajo `login/`, con ruta relativa y barras `/`, ordenados. */
function listFiles(dir: string, relative = ""): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      return entry.isDirectory() ? listFiles(path.join(dir, entry.name), child) : [child];
    })
    .sort();
}

function isUseServer(statement: ts.Statement): boolean {
  return ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use server";
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

/** Los nombres de los valores que exporta una declaración, o `["*"]` si reexporta lo que no se puede leer. */
function exportedValues(statement: ts.Statement): string[] {
  if (ts.isExportAssignment(statement)) return ["default"];
  if (ts.isExportDeclaration(statement)) {
    if (statement.isTypeOnly) return [];
    const clause = statement.exportClause;
    return clause && ts.isNamedExports(clause)
      ? clause.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text)
      : ["*"];
  }
  if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) return [];
  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword)) return ["default"];
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return [];
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map((declaration) => declaration.name.getText());
  }
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
    return [statement.name.text];
  }
  return ["(no se puede leer)"];
}

function countInlineServerActions(source: ts.SourceFile): number {
  let found = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node) && "body" in node && node.body && ts.isBlock(node.body) && node.body.statements.some(isUseServer)) {
      found += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function describeFile(file: string): DoorFile {
  const text = readFileSync(path.join(LOGIN_DIR, file), "utf8");
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  return {
    useServer: source.statements.some(isUseServer),
    exports: source.statements.flatMap(exportedValues).sort(),
    inlineServerActions: countInlineServerActions(source),
  };
}

/** Lo que `src/app/admin/login/**` expone hoy. Sumar una puerta es cambiar esto a propósito. */
const EXPECTED_DOORS: Record<string, DoorFile> = {
  // La contraseña (primer paso).
  "actions.ts": { useServer: true, exports: ["loginAction"], inlineServerActions: 0 },
  "page.tsx": { useServer: false, exports: ["default", "metadata"], inlineServerActions: 0 },
  // El segundo paso con una llave ya registrada, y el canje del código para otro dispositivo.
  "llave/actions.ts": {
    useServer: true,
    exports: ["beginPasskeyLoginAction", "finishPasskeyLoginAction"],
    inlineServerActions: 0,
  },
  "llave/code-actions.ts": {
    useServer: true,
    exports: ["beginCodePasskeyAction", "finishCodePasskeyAction", "redeemCodeAction"],
    inlineServerActions: 0,
  },
  "llave/page.tsx": { useServer: false, exports: ["default", "metadata"], inlineServerActions: 0 },
  // El segundo paso cuando todavía no hay ninguna llave.
  "primera-llave/actions.ts": {
    useServer: true,
    exports: ["beginFirstPasskeyAction", "finishFirstPasskeyAction"],
    inlineServerActions: 0,
  },
  "primera-llave/page.tsx": { useServer: false, exports: ["default", "metadata"], inlineServerActions: 0 },
};

describe("the public doors of src/app/admin/login", () => {
  test("has exactly these files: a new page, action or route there is a new door", () => {
    expect(listFiles(LOGIN_DIR)).toEqual(Object.keys(EXPECTED_DOORS).sort());
  });

  test.each(Object.entries(EXPECTED_DOORS))("%s exposes exactly what is listed here", (file, expected) => {
    expect(describeFile(file)).toEqual(expected);
  });

  test("the reader sees what a new door would look like", () => {
    const source = (text: string) => ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true);
    const statements = (text: string) => source(text).statements.flatMap(exportedValues).sort();

    expect(statements('"use server";\nexport async function a() {}\nexport const b = async () => {};')).toEqual(["a", "b"]);
    expect(statements("export default function Page() {}\nexport const metadata = {};")).toEqual(["default", "metadata"]);
    expect(statements("export { c, d as e } from './otro';\nexport * from './mas';")).toEqual(["*", "c", "e"]);
    expect(statements("export type T = string;\nexport interface I {}\nexport type { U } from './otro';")).toEqual([]);
    expect(countInlineServerActions(source("export default function P() { async function f() { 'use server'; } return f; }"))).toBe(1);
  });
});
