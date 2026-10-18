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
//   Los paréntesis y las aserciones de tipo (`(async () => {…}) as Tipo`) no cambian
//   qué función es.
// - `requireAdmin` tiene que venir de `@/admin/auth/require-admin`, sin alias:
//   una función local con ese nombre no cuenta.
// - Lo que no se puede leer se informa como problema en vez de dejarlo pasar:
//   un `export … from`, un export de algo que no es una función escrita en el
//   archivo (un import reexportado, `export const f = otra`, una llamada que
//   envuelve el manejador, una clase). En un archivo de acciones (`actions` o con
//   `"use server"`) todo export tiene que ser una de esas funciones; en una
//   página o una ruta también se aceptan datos simples (literales, objetos y
//   listas) y la configuración de Next (`metadata`, `dynamic`, `revalidate`, …).
//   También se informan `export namespace` y `export import x = …`: esconden
//   funciones detrás de un nombre y no se pueden seguir.
// - Una función con su propia directiva `"use server"` adentro de una página, una
//   ruta o una acción (una acción en línea, escrita donde sea) también es un punto
//   de entrada público: tiene que empezar con `await requireAdmin();` igual que
//   las exportadas.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

export const ADMIN_APP_DIR = path.join(process.cwd(), "src", "app", "admin");
/** Las carpetas públicas del panel: el login y la página que dice qué falta configurar. */
export const EXEMPT_ADMIN_DIRS: readonly string[] = ["login", "setup"];

const REQUIRE_ADMIN_MODULE = "@/admin/auth/require-admin";
const REQUIRE_ADMIN = "requireAdmin";
const ENTRY_FILE = /^(page|route)\.(tsx?|jsx?)$|^actions\.tsx?$/;
const ACTIONS_FILE = /^actions\.(tsx?|jsx?)$/;
const ROUTE_FILE = /^route\.(tsx?|jsx?)$/;
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
/** Los exports de configuración que Next lee de una página o una ruta: son datos, no puntos de entrada. */
const NEXT_CONFIG_EXPORTS = /^(metadata|viewport|dynamic|revalidate|runtime|preferredRegion|maxDuration|fetchCache|dynamicParams)$/;

export interface GuardProblem {
  /** Nombre del export (`default`, `GET`, `saveSaleAction`, …) o `(archivo)` si el problema es del archivo. */
  entry: string;
  reason: string;
}

type FunctionNode = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function isFunctionNode(node: ts.Node | undefined): node is FunctionNode {
  return node !== undefined && (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

/** La expresión sin los paréntesis ni las aserciones de tipo que la envuelven (`(f)`, `f as T`, `f satisfies T`, `f!`, `<T>f`). */
function unwrap(expression: ts.Expression | undefined): ts.Expression | undefined {
  let current = expression;
  while (
    current !== undefined &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

/** La función que escribe `expression`, sin contar lo que la envuelve, o `undefined` si no es una función. */
function functionOf(expression: ts.Expression | undefined): FunctionNode | undefined {
  const inner = unwrap(expression);
  return isFunctionNode(inner) ? inner : undefined;
}

/** ¿Es un dato simple: un literal, un objeto, una lista o un número con signo? */
function isPlainData(expression: ts.Expression | undefined): boolean {
  const inner = unwrap(expression);
  if (inner === undefined) return false;
  return (
    ts.isStringLiteralLike(inner) ||
    ts.isNumericLiteral(inner) ||
    ts.isObjectLiteralExpression(inner) ||
    ts.isArrayLiteralExpression(inner) ||
    inner.kind === ts.SyntaxKind.TrueKeyword ||
    inner.kind === ts.SyntaxKind.FalseKeyword ||
    inner.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isPrefixUnaryExpression(inner) && ts.isNumericLiteral(inner.operand))
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);
}

const isExported = (node: ts.Node) => hasModifier(node, ts.SyntaxKind.ExportKeyword);
const isDefault = (node: ts.Node) => hasModifier(node, ts.SyntaxKind.DefaultKeyword);

/** Las funciones declaradas en la raíz del archivo, por nombre (para seguir `export default Page` y `export { a }`). */
function topLevelFunctions(source: ts.SourceFile): Map<string, FunctionNode> {
  const functions = new Map<string, FunctionNode>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const fn = functionOf(declaration.initializer);
        if (ts.isIdentifier(declaration.name) && fn) functions.set(declaration.name.text, fn);
      }
    }
  }
  return functions;
}

/** ¿Es una directiva de prólogo, como `"use server"`? */
function isDirective(statement: ts.Statement): boolean {
  return ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);
}

/** ¿El archivo empieza con la directiva `"use server"`? */
function hasUseServerDirective(source: ts.SourceFile): boolean {
  return source.statements.some(
    (statement) =>
      isDirective(statement) && (statement as ts.ExpressionStatement).expression.getText(source).slice(1, -1) === "use server",
  );
}

interface Collected {
  entries: Map<string, FunctionNode>;
  problems: GuardProblem[];
}

/**
 * Las funciones que el archivo exporta, y lo que exporta que no se puede
 * analizar. `isActions` es un archivo de acciones (`actions` o `"use server"`):
 * ahí todo export tiene que ser una función; `isRoute`, un `route`: sus
 * `GET`/`POST`/… tienen que ser funciones escritas en el archivo.
 */
function collectExports(source: ts.SourceFile, { isActions, isRoute }: { isActions: boolean; isRoute: boolean }): Collected {
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
        const fn = functionOf(declaration.initializer);
        if (fn) {
          entries.set(name, fn);
        } else if (isRoute && HTTP_METHODS.has(name)) {
          unreadable(name, "el manejador no es una función escrita en el archivo: no se puede comprobar");
        } else if (isActions) {
          unreadable(name, "en un archivo de acciones todo export tiene que ser una función escrita en el archivo: no se puede comprobar");
        } else if (!NEXT_CONFIG_EXPORTS.test(name) && !isPlainData(declaration.initializer)) {
          unreadable(name, "export que no es un dato, ni la configuración de Next, ni una función escrita en el archivo: no se puede comprobar");
        }
      }
    } else if (ts.isModuleDeclaration(statement) && isExported(statement) && !hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) {
      unreadable(statement.name.getText(source), "export de un namespace: no se puede comprobar");
    } else if (ts.isImportEqualsDeclaration(statement) && isExported(statement) && !statement.isTypeOnly) {
      unreadable(statement.name.text, "export de un alias de importación (`export import x = …`): no se puede comprobar");
    } else if ((ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && isExported(statement)) {
      // Una clase exportada no es una función que se pueda comprobar; en una página o ruta, un enum es solo un dato.
      if (ts.isClassDeclaration(statement) || isActions) {
        unreadable(isDefault(statement) ? "default" : (statement.name?.text ?? "default"), "export de una clase o un enum: no se puede comprobar");
      }
    } else if (ts.isExportAssignment(statement)) {
      const expression = unwrap(statement.expression);
      const target = expression !== undefined && ts.isIdentifier(expression) ? locals.get(expression.text) : functionOf(expression);
      if (target) entries.set("default", target);
      else unreadable("default", "`export default` no es una función escrita en el archivo: no se puede comprobar");
    } else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
      if (statement.moduleSpecifier) {
        unreadable("(archivo)", "reexporta desde otro archivo: no se puede comprobar");
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly) continue;
          const exported = element.name.text;
          const local = locals.get((element.propertyName ?? element.name).text);
          if (local) entries.set(exported, local);
          else if (isActions || !NEXT_CONFIG_EXPORTS.test(exported)) {
            unreadable(exported, "export de algo que no es una función escrita en el archivo (un import, un dato): no se puede comprobar");
          }
        }
      }
    }
  }
  return { entries, problems };
}

/** ¿El cuerpo de la función empieza con la directiva `"use server"` (antes de cualquier otra sentencia)? */
function hasInlineUseServer(fn: FunctionNode): boolean {
  if (!fn.body || !ts.isBlock(fn.body)) return false;
  for (const statement of fn.body.statements) {
    if (!isDirective(statement)) return false;
    if ((statement as ts.ExpressionStatement).expression.getText().slice(1, -1) === "use server") return true;
  }
  return false;
}

/** Cómo se llama una función escrita en línea: su nombre, el de la variable que la guarda o el de la propiedad. */
function inlineName(fn: FunctionNode): string {
  if ((ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) && fn.name) return fn.name.text;
  let parent: ts.Node | undefined = fn.parent;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent))) {
    parent = parent.parent;
  }
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent) && (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))) {
    return parent.name.text;
  }
  return "(función en línea)";
}

/** Las funciones con su propia directiva `"use server"` escritas en cualquier parte del archivo. */
function inlineServerActions(source: ts.SourceFile): { name: string; fn: FunctionNode }[] {
  const found: { name: string; fn: FunctionNode }[] = [];
  const visit = (node: ts.Node): void => {
    if (isFunctionNode(node) && hasInlineUseServer(node)) found.push({ name: inlineName(node), fn: node });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
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

/** `.ts`/`.js` se leen como tal: en TSX, `<Tipo>valor` sería una etiqueta y el árbol saldría mal. */
function scriptKindOf(fileName: string): ts.ScriptKind {
  switch (path.extname(fileName)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

/**
 * Los problemas de un archivo del panel (vacío si cada función que expone
 * verifica la sesión primero). `fileName` decide el tipo de archivo
 * (`route.ts` exige que sus manejadores se puedan leer; `actions.ts` y los
 * archivos con `"use server"` solo pueden exportar funciones).
 */
export function analyzeGuards(sourceText: string, fileName: string): GuardProblem[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const base = path.basename(fileName);
  const { entries, problems } = collectExports(source, {
    isActions: ACTIONS_FILE.test(base) || hasUseServerDirective(source),
    isRoute: ROUTE_FILE.test(base),
  });
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
  // Las acciones en línea que no son un export ya revisado: también se piden por afuera.
  const checked = new Set<FunctionNode>(entries.values());
  for (const { name, fn } of inlineServerActions(source)) {
    if (checked.has(fn)) continue;
    const reason = guardProblem(fn);
    if (reason) found.push({ entry: name, reason: `acción en línea con "use server": ${reason}` });
  }
  return found;
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
      if (ENTRY_FILE.test(name)) return true;
      const text = readFileSync(path.join(ADMIN_APP_DIR, file), "utf8");
      return hasUseServerDirective(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file)));
    })
    .sort();
}
