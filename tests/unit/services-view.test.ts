import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SALE_ITEMS, SITE_BOOKING_ITEMS, type SaleItem } from "@/admin/catalog";
import { MiniBars } from "@/admin/charts/mini-bars";
import type { ItemClicks } from "@/admin/interest/query";
import { buildServicesReport } from "@/admin/services/report";
import { ServicesView } from "@/admin/services/services-view";
import { NOW, sale } from "../helpers/metric-sales";

function clicks(counts: Partial<Record<SaleItem, number>> = {}): ItemClicks[] {
  return SITE_BOOKING_ITEMS.map((item) => ({ item, clicks: counts[item] ?? 0 }));
}

const SALES = [
  sale({ item: "lesson", dollars: 40, paidOn: "2026-10-05" }),
  sale({ item: "lesson", dollars: 40, paidOn: "2026-10-05" }),
  sale({ item: "lesson", dollars: 40, paidOn: "2026-07-05" }),
  sale({ item: "gamePlan", dollars: 120, paidOn: "2026-10-12" }),
  sale({ item: "lessonPack", dollars: 140, paidOn: "2026-10-01" }),
];

function render(sales = SALES, counts: Partial<Record<SaleItem, number>> = { lesson: 8, vodLive: 3 }): string {
  const report = buildServicesReport(sales, clicks(counts), "thisMonth", NOW);
  return renderToStaticMarkup(createElement(ServicesView, { report }));
}

/** La fila de un servicio (el `<tr>` con su `data-item`). */
function rowOf(markup: string, item: SaleItem): string {
  const match = markup.match(new RegExp(`<tr[^>]*data-item="${item}"[^>]*>[\\s\\S]*?</tr>`));
  if (!match) throw new Error(`Falta la fila de ${item}`);
  return match[0];
}

/** El texto de una celda por su columna, sin etiquetas. */
function cellOf(row: string, column: string): string {
  const match = row.match(new RegExp(`<t[dh][^>]*data-col="${column}"[^>]*>([\\s\\S]*?)</t[dh]>`));
  if (!match) throw new Error(`Falta la columna ${column}`);
  return match[1]
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("ServicesView", () => {
  test("has the columns of the brief, one row per catalog item", () => {
    const markup = render();

    for (const header of [
      "Servicio",
      "Ventas",
      "Ingresos",
      "Ticket promedio",
      "% del total",
      "Última venta",
      "Clics en Reservar",
      "Conversión",
    ]) {
      expect(markup, header).toContain(`>${header}</th>`);
    }
    expect(markup.match(/data-testid="service-row"/g)).toHaveLength(SALE_ITEMS.length);
  });

  test("explains how conversion is computed", () => {
    expect(render()).toContain("conversión: ventas cobradas ÷ clics en Reservar");
  });

  test("writes each number of a row", () => {
    const lesson = rowOf(render(), "lesson");

    expect(cellOf(lesson, "item")).toBe("Clase 1 a 1");
    expect(cellOf(lesson, "sales")).toBe("2");
    expect(cellOf(lesson, "income")).toBe("USD 80,00");
    expect(cellOf(lesson, "avg")).toBe("USD 40,00");
    expect(cellOf(lesson, "share")).toBe("23,5 %");
    expect(cellOf(lesson, "last")).toContain("05/10/2026");
    expect(cellOf(lesson, "clicks")).toBe("8");
    // 8 clics y 3 ventas contando la del pack: 2 de Clase 1 a 1 y 1 del pack (que se pide desde ese botón).
    expect(cellOf(lesson, "conversion")).toBe("37,5 % incluye 1 venta del pack");
  });

  test("the pack note only shows in Clase 1 a 1, and only when the pack sold", () => {
    const markup = render();

    expect(markup.match(/incluye \d+ ventas? del pack/g)).toHaveLength(1);
    expect(cellOf(rowOf(markup, "lessonPack"), "conversion")).toBe("—");
    expect(cellOf(rowOf(markup, "gamePlan"), "conversion")).toBe("—");
    const withoutPack = render([sale({ item: "lesson", paidOn: "2026-10-05" })], { lesson: 4 });
    expect(withoutPack).not.toMatch(/incluye \d+ ventas? del pack/);
    expect(cellOf(rowOf(withoutPack, "lesson"), "conversion")).toBe("25 %");
    const twoPacks = render(
      [sale({ item: "lessonPack", paidOn: "2026-10-05" }), sale({ item: "lessonPack", paidOn: "2026-10-06" })],
      { lesson: 4 },
    );
    expect(cellOf(rowOf(twoPacks, "lesson"), "conversion")).toBe("50 % incluye 2 ventas del pack");
  });

  test("the footnote says Clase 1 a 1 counts the pack sales", () => {
    expect(render()).toContain("la conversión de Clase 1 a 1 cuenta también las ventas del pack");
  });

  test("the trend column says right in its header that each row has its own scale", () => {
    expect(render()).toMatch(/>Últimos 6 meses\s?<span[^>]*>\(escala propia\)<\/span><\/th>/);
  });

  test("shows a dash, never NaN or Infinity, when there is nothing to divide by", () => {
    const markup = render();
    const tournament = rowOf(markup, "tournament");

    expect(cellOf(tournament, "sales")).toBe("0");
    expect(cellOf(tournament, "avg")).toBe("—");
    expect(cellOf(tournament, "last")).toBe("—");
    expect(cellOf(tournament, "clicks")).toBe("0");
    expect(cellOf(tournament, "conversion")).toBe("—");
    expect(markup).not.toMatch(/NaN|Infinity|undefined|null/);
  });

  test("conversion with clicks but no sales is 0 %, not a dash", () => {
    expect(cellOf(rowOf(render(), "vodLive"), "conversion")).toBe("0 %");
  });

  test("items without a button show a dash in clicks and conversion, and say why", () => {
    const markup = render();
    const pack = rowOf(markup, "lessonPack");

    expect(cellOf(pack, "clicks")).toBe("—");
    expect(cellOf(pack, "conversion")).toBe("—");
    expect(cellOf(pack, "sales")).toBe("1");
    expect(cellOf(rowOf(markup, "other"), "clicks")).toBe("—");
    expect(markup).toContain("no tienen botón propio en el sitio");
  });

  test("conversion over 100 % is written as it is and the page explains why", () => {
    const sales = [sale({ item: "tournament" }), sale({ item: "tournament" }), sale({ item: "tournament" })];

    const markup = render(sales, { tournament: 2 });

    expect(cellOf(rowOf(markup, "tournament"), "conversion")).toBe("150 %");
    expect(markup).toContain("puede pasar de 100 %");
  });

  test("each row has a six-bar chart with a text alternative", () => {
    const lesson = rowOf(render(), "lesson");

    expect(lesson.match(/data-testid="mini-bar"/g)).toHaveLength(6);
    expect(lesson).toContain('role="img"');
    expect(lesson).toContain("mayo de 2026: USD 0,00");
    expect(lesson).toContain("julio de 2026: USD 40,00");
    expect(lesson).toContain("octubre de 2026: USD 80,00");
    expect(lesson).toContain("mes en curso");
  });

  test("the last sale says how long ago it was", () => {
    const gamePlan = cellOf(rowOf(render(), "gamePlan"), "last");

    expect(gamePlan).toBe("12/10/2026 ayer");
    expect(cellOf(rowOf(render(), "lesson"), "last")).toBe("05/10/2026 hace 8 días");
  });

  test("a summary line gives the period, the sales and the clicks", () => {
    const markup = render();

    expect(markup).toContain("Este mes");
    expect(markup).toContain("1–13 oct.");
    expect(markup).toMatch(/4 ventas/);
    expect(markup).toMatch(/11 clics/);
  });

  describe("clicks dropped for being over the ceiling", () => {
    function renderWithDropped(dropped: number): string {
      const report = buildServicesReport(SALES, clicks({ lesson: 8, vodLive: 3 }), "thisMonth", NOW, dropped);
      return renderToStaticMarkup(createElement(ServicesView, { report }));
    }

    test("says how many were dropped when there were some in the period", () => {
      const markup = renderWithDropped(12);

      expect(markup).toMatch(/data-testid="services-dropped"[^>]*>12 clics descartados por exceso/);
    });

    test("writes a single one in the singular", () => {
      expect(renderWithDropped(1)).toMatch(/data-testid="services-dropped"[^>]*>1 clic descartado por exceso/);
    });

    test("says nothing when none were dropped", () => {
      const markup = renderWithDropped(0);

      expect(markup).not.toContain("services-dropped");
      expect(markup).not.toContain("descartado");
    });

    test("explains the ceilings in the notes below the table", () => {
      expect(render()).toContain("200 clics por minuto o de 2.000 por hora");
    });
  });

  test("keeps the period selector of the overview, pointing to this page", () => {
    const markup = render();

    expect(markup).toContain('aria-label="Período de los servicios"');
    expect(markup).toContain('href="/admin/servicios"');
    expect(markup).toContain('href="/admin/servicios?periodo=30-dias"');
    expect(markup).toContain('aria-current="true"');
  });

  test("the table scrolls inside its own container", () => {
    const markup = render();

    expect(markup).toContain('data-slot="table-container"');
    expect(markup).toContain('role="region"');
    expect(markup).toContain('aria-label="Servicios: ventas, ingresos y clics"');
    expect(markup).toContain('tabindex="0"');
  });

  test("without sales or clicks it invites to load the first sale instead of drawing zeros", () => {
    const report = buildServicesReport([], clicks(), "thisMonth", NOW);
    const markup = renderToStaticMarkup(createElement(ServicesView, { report }));

    expect(markup).toContain("Todavía no hay ventas ni clics");
    expect(markup).toContain('href="/admin/ventas/nueva"');
    expect(markup).not.toContain("<table");
  });

  test("the period selector stays when there is nothing to show, so you can always go back to a period with data", () => {
    const report = buildServicesReport([], clicks(), "lastMonth", NOW);
    const markup = renderToStaticMarkup(createElement(ServicesView, { report }));

    expect(markup).not.toContain("<table");
    expect(markup).toContain('aria-label="Período de los servicios"');
    expect(markup).toContain('href="/admin/servicios"');
    expect(markup).toContain('aria-current="true"');
  });

  test("with clicks but no sales it still shows the table", () => {
    const report = buildServicesReport([], clicks({ lesson: 4 }), "thisMonth", NOW);
    const markup = renderToStaticMarkup(createElement(ServicesView, { report }));

    expect(markup).toContain("<table");
    expect(cellOf(rowOf(markup, "lesson"), "conversion")).toBe("0 %");
  });
});

describe("MiniBars", () => {
  const BARS = [
    { key: "2026-08", name: "agosto de 2026", value: 4000, valueText: "USD 40,00" },
    { key: "2026-09", name: "septiembre de 2026", value: 0, valueText: "USD 0,00" },
    { key: "2026-10", name: "octubre de 2026", value: 8000, valueText: "USD 80,00", isPartial: true },
  ];

  function bars(data = BARS): string {
    return renderToStaticMarkup(createElement(MiniBars, { bars: data, label: "Ingresos por mes", partialNote: "mes en curso" }));
  }

  test("is one image with a name that lists every month, and one titled bar per month", () => {
    const markup = bars();

    expect(markup).toContain('role="img"');
    expect(markup).toContain(
      'aria-label="Ingresos por mes: agosto de 2026 USD 40,00, septiembre de 2026 USD 0,00, octubre de 2026 USD 80,00 (mes en curso)"',
    );
    expect(markup.match(/data-testid="mini-bar"/g)).toHaveLength(3);
    expect(markup).toContain("<title>octubre de 2026: USD 80,00 (mes en curso)</title>");
  });

  test("the tallest bar fills the height, the others are proportional and zero leaves a stub", () => {
    const markup = bars();
    const heights = [...markup.matchAll(/data-testid="mini-bar"[^>]*data-height="(\d+)"/g)].map((match) => Number(match[1]));

    expect(heights).toHaveLength(3);
    expect(heights[2]).toBeGreaterThan(heights[0]);
    expect(heights[0]).toBeCloseTo(heights[2] / 2, 0);
    expect(heights[1]).toBeGreaterThan(0);
    expect(heights[1]).toBeLessThan(heights[0]);
  });

  test("a series of zeros still draws a baseline and no NaN", () => {
    const markup = bars(BARS.map((bar) => ({ ...bar, value: 0, valueText: "USD 0,00" })));

    expect(markup).not.toContain("NaN");
    expect(markup.match(/data-testid="mini-bar"/g)).toHaveLength(3);
  });
});
