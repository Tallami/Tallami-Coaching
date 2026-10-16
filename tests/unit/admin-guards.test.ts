import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  ADMIN_APP_DIR,
  EXEMPT_ADMIN_DIRS,
  analyzeGuards,
  listAdminEntryFiles,
} from "../helpers/admin-guards";

// La protección real del panel es `requireAdmin()` en cada página, cada acción del
// servidor y cada descarga (el `proxy` es solo un filtro previo). Estos tests la
// cuidan para TODO lo que hay en `src/app/admin`, también lo que se agregue después:
// leen el código fuente y exigen que cada función que expone un archivo del panel
// empiece con `await requireAdmin();`, o sea antes de cualquier acceso a la base.

const IMPORT = 'import { requireAdmin } from "@/admin/auth/require-admin";\nimport { getDb } from "@/db/client";\n';

function readAdminFile(file: string): string {
  return readFileSync(path.join(ADMIN_APP_DIR, file), "utf8");
}

function analyze(source: string, fileName = "page.tsx") {
  return analyzeGuards(source, fileName);
}

describe("analyzeGuards", () => {
  test("accepts a page, an action and a route that start by checking the session", () => {
    expect(
      analyze(`${IMPORT}
        export const metadata = { title: "Ventas" };
        export default async function SalesPage() {
          await requireAdmin();
          const db = await getDb();
          return db;
        }`),
    ).toEqual([]);

    expect(
      analyze(`"use server";\n${IMPORT}
        export async function saveAction(formData: FormData) {
          await requireAdmin();
          return getDb();
        }
        export const otherAction = async () => {
          await requireAdmin();
        };`, "actions.ts"),
    ).toEqual([]);

    expect(
      analyze(`${IMPORT}
        export async function GET(request: Request) {
          await requireAdmin();
          return new Response(String(await getDb()));
        }`, "route.ts"),
    ).toEqual([]);
  });

  test("lets a function-level directive come before the check", () => {
    expect(
      analyze(`${IMPORT}
        export async function saveAction() {
          "use server";
          await requireAdmin();
        }`, "actions.ts"),
    ).toEqual([]);
  });

  test("flags a page that opens the database before checking the session", () => {
    const problems = analyze(`${IMPORT}
      export default async function SalesPage() {
        const db = await getDb();
        await requireAdmin();
        return db;
      }`);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ entry: "default" });
  });

  test("flags a page that never checks the session", () => {
    expect(analyze(`${IMPORT}
      export default async function SalesPage() {
        return getDb();
      }`)).toHaveLength(1);
  });

  test("names the unguarded export among several actions", () => {
    const problems = analyze(`"use server";\n${IMPORT}
      export async function guarded() { await requireAdmin(); }
      export async function forgotten() { return getDb(); }
      export const forgottenToo = async () => getDb();`, "actions.ts");

    expect(problems.map((problem) => problem.entry)).toEqual(["forgotten", "forgottenToo"]);
  });

  test("flags a route handler that checks late, in a branch or in a nested function", () => {
    const late = analyze(`${IMPORT}
      export async function GET() {
        const rows = await getDb();
        await requireAdmin();
        return Response.json(rows);
      }`, "route.ts");
    const branch = analyze(`${IMPORT}
      export async function POST(request: Request) {
        if (request.method === "POST") await requireAdmin();
        return Response.json(await getDb());
      }`, "route.ts");
    const nested = analyze(`${IMPORT}
      export async function DELETE() {
        const check = async () => { await requireAdmin(); };
        return Response.json(await getDb());
      }`, "route.ts");

    expect(late).toHaveLength(1);
    expect(branch).toHaveLength(1);
    expect(nested).toHaveLength(1);
  });

  test("flags a check that is not awaited or takes the wrong shape", () => {
    expect(analyze(`${IMPORT}
      export default async function Page() { requireAdmin(); return getDb(); }`)).toHaveLength(1);
    expect(analyze(`${IMPORT}
      export default async function Page() { void requireAdmin(); return getDb(); }`)).toHaveLength(1);
    expect(analyze(`${IMPORT}
      export default function Page() { return null; }`)).toHaveLength(1);
  });

  test("follows an export written apart from the declaration", () => {
    const bad = analyze(`${IMPORT}
      async function Page() { return getDb(); }
      export default Page;`);
    const good = analyze(`${IMPORT}
      async function Page() { await requireAdmin(); return getDb(); }
      export default Page;`);
    const list = analyze(`${IMPORT}
      async function a() { await requireAdmin(); }
      async function b() { return getDb(); }
      export { a, b as renamed };`, "actions.ts");

    expect(bad).toHaveLength(1);
    expect(good).toEqual([]);
    expect(list.map((problem) => problem.entry)).toEqual(["renamed"]);
  });

  test("flags what it cannot read instead of letting it through", () => {
    // Un manejador envuelto en otra función, un export desde otro archivo, una expresión.
    expect(analyze(`${IMPORT}
      export const GET = withSomething(async () => getDb());`, "route.ts")).toHaveLength(1);
    expect(analyze(`${IMPORT}
      export { GET } from "./otra-ruta";`, "route.ts")).toHaveLength(1);
    expect(analyze(`${IMPORT}
      export default wrap(Page);`)).toHaveLength(1);
    expect(analyze(`${IMPORT}
      export const handler = async () => getDb();`, "actions.ts")).toHaveLength(1);
  });

  test("flags a page that exposes nothing at all", () => {
    expect(analyze(`${IMPORT}
      export const metadata = {};`)).toHaveLength(1);
  });

  test("does not trust a requireAdmin that does not come from the real module", () => {
    expect(
      analyze(`import { getDb } from "@/db/client";
        async function requireAdmin() {}
        export default async function Page() { await requireAdmin(); return getDb(); }`),
    ).toEqual([{ entry: "(archivo)", reason: expect.stringContaining("no importa") }]);
    expect(
      analyze(`import { requireAdmin } from "./mi-guarda";
        import { getDb } from "@/db/client";
        export default async function Page() { await requireAdmin(); return getDb(); }`),
    ).toEqual([{ entry: "(archivo)", reason: expect.stringContaining("no importa") }]);
    expect(
      analyze(`import { requireAdmin as guard } from "@/admin/auth/require-admin";
        export default async function Page() { await guard(); }`),
    ).not.toEqual([]);
  });

  test("ignores exports that are not functions, like the metadata", () => {
    expect(
      analyze(`${IMPORT}
        export const metadata = { title: "Ventas" };
        export const dynamic = "force-dynamic";
        export default async function Page() { await requireAdmin(); }`),
    ).toEqual([]);
  });
});

describe("the files of src/app/admin", () => {
  const files = listAdminEntryFiles();

  test("finds the pages, actions and routes of the panel, and leaves out only the doors", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "page.tsx",
        "actions.ts",
        "alumnos/page.tsx",
        "alumnos/actions.ts",
        "alumnos/[id]/page.tsx",
        "alumnos/nuevo/page.tsx",
        "configuracion/page.tsx",
        "configuracion/actions.ts",
        "facturacion/page.tsx",
        "facturacion/actions.ts",
        "facturacion/exportar/route.ts",
        "servicios/page.tsx",
        "ventas/page.tsx",
        "ventas/actions.ts",
        "ventas/[id]/page.tsx",
        "ventas/nueva/page.tsx",
        "ventas/exportar/route.ts",
      ]),
    );
    for (const door of EXEMPT_ADMIN_DIRS) {
      expect(files.some((file) => file.startsWith(`${door}/`)), door).toBe(false);
    }
    expect([...EXEMPT_ADMIN_DIRS].sort()).toEqual(["login", "setup"]);
  });

  test.each(listAdminEntryFiles())("%s checks the session before anything else", (file) => {
    expect(analyze(readAdminFile(file), file), file).toEqual([]);
  });
});
