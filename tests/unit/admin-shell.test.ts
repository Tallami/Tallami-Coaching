import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AdminShell } from "@/admin/ui/admin-shell";
import { EmptyState } from "@/admin/ui/empty-state";
import { PageHeader } from "@/admin/ui/page-header";
import { Pagination } from "@/admin/ui/pagination";
import { ADMIN_SECTIONS } from "@/admin/ui/sections";

describe("AdminShell", () => {
  const markup = renderToStaticMarkup(
    AdminShell({
      active: "sales",
      logoutAction: async () => {},
      children: createElement("p", null, "contenido de la página"),
    }),
  );

  test("lists every section in order, in one navigation", () => {
    expect(markup.match(/<nav /g)).toHaveLength(1);
    const positions = ADMIN_SECTIONS.map(({ label }) => markup.indexOf(`>${label}</a>`));

    expect(positions.every((position) => position > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(ADMIN_SECTIONS.map(({ label }) => label)).toEqual([
      "Resumen",
      "Ventas",
      "Servicios",
      "Alumnos",
      "Facturación",
      "Configuración",
    ]);
  });

  test("marks only the current section", () => {
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-current="page"[^>]*href="\/admin\/ventas"/);
  });

  test("has the logout button, the menu button and the page inside the main landmark", () => {
    expect(markup).toContain("Salir");
    expect(markup).toContain("Menú");
    expect(markup).toMatch(/<main id="contenido"[^>]*>[\s\S]*contenido de la página[\s\S]*<\/main>/);
  });

  test("the menu button starts closed and points at the menu", () => {
    expect(markup).toMatch(/aria-expanded="false"/);
    expect(markup).toMatch(/aria-controls="menu-del-panel"/);
    expect(markup).toContain('id="menu-del-panel"');
  });

  test("offers a way to skip the navigation", () => {
    expect(markup).toContain('href="#contenido"');
  });
});

describe("PageHeader", () => {
  test("is the page's only h1 and shows its actions", () => {
    const markup = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "Ventas",
        description: "Todo lo que cobraste.",
        actions: createElement("a", { href: "/x" }, "Nueva venta"),
      }),
    );

    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(markup).toContain("Ventas");
    expect(markup).toContain("Todo lo que cobraste.");
    expect(markup).toContain("Nueva venta");
  });
});

describe("EmptyState", () => {
  test("always carries the next step", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptyState, {
        title: "Todavía no hay ventas",
        action: createElement("a", { href: "/admin/ventas/nueva" }, "Cargá tu primera venta"),
      }),
    );

    expect(markup).toContain("Todavía no hay ventas");
    expect(markup).toContain('href="/admin/ventas/nueva"');
  });
});

describe("Pagination", () => {
  const hrefFor = (page: number) => `/admin/ventas?pagina=${page}`;

  function render(page: number, total: number): string {
    return renderToStaticMarkup(createElement(Pagination, { page, pageSize: 25, total, noun: "ventas", hrefFor }));
  }

  test("tells which sales are on the page and links to its neighbours", () => {
    const markup = render(2, 120);

    expect(markup).toContain("Mostrando 26 a 50 de 120 ventas");
    expect(markup).toContain("Página 2 de 5");
    expect(markup).toContain('href="/admin/ventas?pagina=1"');
    expect(markup).toContain('href="/admin/ventas?pagina=3"');
  });

  test("the first and last pages have no link in their direction", () => {
    const first = render(1, 60);
    expect(first).not.toContain("pagina=0");
    expect(first).toContain('href="/admin/ventas?pagina=2"');
    expect(first).toMatch(/aria-disabled="true"[^>]*>[\s\S]*Anterior/);

    const last = render(3, 60);
    expect(last).not.toContain("pagina=4");
    expect(last).toContain("Mostrando 51 a 60 de 60 ventas");
  });

  test("a single page shows the count and no links", () => {
    const markup = render(1, 6);

    expect(markup).toContain("Mostrando 1 a 6 de 6 ventas");
    expect(markup).not.toContain("<a ");
    expect(markup).not.toContain("Página 1 de 1");
  });

  test("with nothing to show it says so", () => {
    expect(render(1, 0)).toContain("Sin ventas");
  });

  describe("when there is exactly one", () => {
    const renderWithSingular = (total: number) =>
      renderToStaticMarkup(
        createElement(Pagination, { page: 1, pageSize: 25, total, noun: "alumnos", singularNoun: "alumno", hrefFor }),
      );

    test("it counts one student, not 1 alumnos", () => {
      expect(renderWithSingular(1)).toContain("Mostrando 1 a 1 de 1 alumno");
      expect(renderWithSingular(1)).not.toContain("1 alumnos");
    });

    test("the plural stays for two or more and for none", () => {
      expect(renderWithSingular(2)).toContain("Mostrando 1 a 2 de 2 alumnos");
      expect(renderWithSingular(0)).toContain("Sin alumnos");
    });

    test("a single sale reads 1 venta", () => {
      const markup = renderToStaticMarkup(
        createElement(Pagination, { page: 1, pageSize: 25, total: 1, noun: "ventas", singularNoun: "venta", hrefFor }),
      );

      expect(markup).toContain("de 1 venta");
      expect(markup).not.toContain("1 ventas");
    });
  });
});
