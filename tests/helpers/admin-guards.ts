// Análisis del código fuente del panel para `tests/unit/admin-guards.test.ts`:
// ¿cada función que expone un archivo de `src/app/admin` empieza verificando la
// sesión? Se lee el árbol sintáctico con la API de TypeScript (no hace falta
// ejecutar nada ni simular la base).
//
// Reglas:
// - Entran los archivos del panel que se pueden pedir desde afuera: `page`,
//   `route`, `actions` y cualquier archivo con la directiva `"use server"`.
//   Quedan afuera `login/` y `setup/`, las dos puertas que existen justamente
//   para cuando todavía no hay sesión.
// - Cada función exportada de esos archivos (la de `export default` de una
//   página, los `GET`/`POST` de una ruta, cada acción) debe tener como primera
//   sentencia `await requireAdmin();`. Después de las directivas (`"use server"`)
//   y antes de cualquier otra cosa: así nada la antecede, tampoco el acceso a la base.
// - `requireAdmin` tiene que venir de `@/admin/auth/require-admin`, sin alias:
//   una función local con ese nombre no cuenta.
// - Lo que no se puede leer (un manejador envuelto en otra función, un
//   `export … from`) se informa como problema en vez de dejarlo pasar.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const ADMIN_APP_DIR = path.join(process.cwd(), "src", "app", "admin");
/** Las carpetas públicas del panel: el login y la página que dice qué falta configurar. */
export const EXEMPT_ADMIN_DIRS: readonly string[] = ["login", "setup"];

const REQUIRE_ADMIN_MODULE = "@/admin/auth/require-admin";
const REQUIRE_ADMIN = "requireAdmin";
const ENTRY_FILE = /^(page|route)\.(tsx?|jsx?)$|^actions\.tsx?$/;
const ROUTE_FILE = /^route\.(tsx?|jsx?)$/;
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export interface GuardProblem {
  /** Nombre del export (`default`, `GET`, `saveSaleAction`, …) o `(archivo)` si el problema es del archivo. */
  entry: string;
  reason: string;
}

type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function isFunctionNode(node: ts.Node | undefined): node is FunctionNode {
  return node !== undefined && (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function isDefault(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}

/** Las funciones declaradas en la raíz del archivo, por nombre (para seguir `export default Page` y `export { a }`). */
function topLevelFunctions(source: ts.SourceFile): Map<string, FunctionNode> {
  const functions = new Map<string, FunctionNode>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && isFunctionNode(declaration.initializer)) {
          functions.set(declaration.name.text, declaration.initializer);
        }
      }
    }
  }
  return functions;
}

interface Collected {
  entries: Map<string, FunctionNode>;
  problems: GuardProblem[];
}

/** Las funciones que el archivo exporta, y lo que exporta que no se puede analizar. */
function collectExports(source: ts.SourceFile, isRoute: boolean): Collected {
  const locals = topLevelFunctions(source);
  const entries = new Map<string, FunctionNode>();
  const problems: GuardProblem[] = [];
  const unreadable = (entry: string, reason: string) => problems.push({ entry, reason });

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      entries.set(isDefault(statement) ? "default" : (statement.name?.text ?? "default"), statement);
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = ts.isIdentifier(declaration.name) ? declaration.name.text : declaration.name.getText(source);
        if (isFunctionNode(declaration.initializer)) {
          entries.set(name, declaration.initializer);
        } else if (isRoute && HTTP_METHODS.has(name)) {
          unreadable(name, "el manejador no es una función escrita en el archivo: no se puede comprobar");
        } else if (declaration.initializer && ts.isCallExpression(declaration.initializer)) {
          // `export const metadata = …` es un dato; una llamada podría ser una acción envuelta.
          if (!/^(metadata|viewport|dynamic|revalidate|runtime|preferredRegion|maxDuration|fetchCache|dynamicParams)$/.test(name)) {
            unreadable(name, "export resuelto con una llamada: no se puede comprobar si verifica la sesión");
          }
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      const target = ts.isIdentifier(statement.expression) ? locals.get(statement.expression.text) : statement.expression;
      if (isFunctionNode(target)) entries.set("default", target);
      else unreadable("default", "`export default` no es una función escrita en el archivo: no se puede comprobar");
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (statement.moduleSpecifier) {
        unreadable("(archivo)", "reexporta desde otro archivo: no se puede comprobar");
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const local = locals.get((element.propertyName ?? element.name).text);
          if (isFunctionNode(local)) entries.set(element.name.text, local);
        }
      }
    }
  }
  return { entries, problems };
}

/** ¿La sentencia es una directiva de prólogo, como `"use server"`? */
function isDirective(statement: ts.Statement): boolean {
  return ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);
}

/** ¿Es exactamente `await requireAdmin();`? */
function isAwaitedGuard(statement: ts.Statement | undefined): boolean {
  if (!statement || !ts.isExpressionStatement(statement)) return false;
  const expression = statement.expression;
  if (!ts.isAwaitExpression(expression) || !ts.isCallExpression(expression.expression)) return false;
  const call = expression.expression;
  return ts.isIdentifier(call.expression) && call.expression.text === REQUIRE_ADMIN && call.arguments.length === 0;
}

function guardProblem(fn: FunctionNode): string | null {
  if (!fn.body || !ts.isBlock(fn.body)) {
    return "no tiene un cuerpo con bloque, así que no puede llamar a `await requireAdmin()` primero";
  }
  const first = fn.body.statements.find((statement) => !isDirective(statement));
  return isAwaitedGuard(first) ? null : "su primera sentencia no es `await requireAdmin();`";
}

/** ¿El archivo importa `requireAdmin` del módulo real, sin alias? */
function importsRealGuard(source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === REQUIRE_ADMIN_MODULE &&
      !statement.importClause?.isTypeOnly &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some(
        (element) => element.name.text === REQUIRE_ADMIN && element.propertyName === undefined && !element.isTypeOnly,
      ),
  );
}

/**
 * Los problemas de un archivo del panel (vacío si cada función que expone
 * verifica la sesión primero). `fileName` decide el tipo de archivo
 * (`route.ts` exige que sus manejadores se puedan leer).
 */
export function analyzeGuards(sourceText: string, fileName: string): GuardProblem[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { entries, problems } = collectExports(source, ROUTE_FILE.test(path.basename(fileName)));
  const found = [...problems];

  if (!importsRealGuard(source)) {
    found.push({ entry: "(archivo)", reason: `no importa { ${REQUIRE_ADMIN} } de "${REQUIRE_ADMIN_MODULE}"` });
  }
  if (entries.size === 0 && found.length === 0) {
    found.push({ entry: "(archivo)", reason: "no expone ninguna función que se pueda comprobar" });
  }
  for (const [entry, fn] of entries) {
    const reason = guardProblem(fn);
    if (reason) found.push({ entry, reason });
  }
  return found;
}

/** ¿Empieza con la directiva `"use server"`? */
function hasUseServerDirective(sourceText: string): boolean {
  const source = ts.createSourceFile("archivo.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return source.statements.some(
    (statement) => isDirective(statement) && (statement as ts.ExpressionStatement).expression.getText(source).slice(1, -1) === "use server",
  );
}

function walk(dir: string, relative: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      // Las puertas públicas se saltan enteras, pero solo las de la raíz del panel.
      return relative === "" && EXEMPT_ADMIN_DIRS.includes(entry.name) ? [] : walk(path.join(dir, entry.name), child);
    }
    return [child];
  });
}

/** Los archivos del panel que se tienen que comprobar, con ruta relativa a `src/app/admin` y barras `/`. */
export function listAdminEntryFiles(): string[] {
  return walk(ADMIN_APP_DIR, "")
    .filter((file) => /\.(tsx?|jsx?)$/.test(file))
    .filter((file) => {
      const name = path.posix.basename(file);
      return ENTRY_FILE.test(name) || hasUseServerDirective(readFileSync(path.join(ADMIN_APP_DIR, file), "utf8"));
    })
    .sort();
}
