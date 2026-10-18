import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { HBarChart } from "@/admin/charts/hbar-chart";
import type { MonotributoSettings } from "@/admin/metrics/monotributo";
import { buildOverview, type OverviewData } from "@/admin/overview/overview-data";
import { OverviewView } from "@/admin/overview/overview-view";
import { NOW, sale } from "../helpers/metric-sales";

const SETTINGS: MonotributoSettings = { category: "C", annualCapArsMinor: 300_000_000, validFrom: "2026-08-01" };

function render(sales = [sale()]): string {
  const data: OverviewData = buildOverview(sales, SETTINGS, "thisMonth", NOW);
  return renderToStaticMarkup(createElement(OverviewView, { data }));
}

/** El trozo de HTML de un bloque: desde su `data-testid` hasta el final del bloque siguiente de su misma clase. */
function block(html: string, testId: string): string {
  const start = html.indexOf(`data-testid="${testId}"`);
  if (start < 0) throw new Error(`No hay un bloque ${testId}.`);
  const next = html.indexOf('data-testid="pending-', start + 1);
  return html.slice(start, next < 0 ? undefined : next);
}

function plain(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** Ocho entregas por hacer (VOD grabado cobrado y sin entregar), con fecha de entrega de más cerca a más lejos. */
function eightDeliveries() {
  return Array.from({ length: 8 }, (_, index) =>
    sale({
      id: `delivery-${index + 1}`,
      item: "vodRecorded",
      customerId: `c${index + 1}`,
      dueAt: `2026-10-${String(14 + index).padStart(2, "0")}T18:00:00.000Z`,
    }),
  );
}

describe("the bars of the breakdowns", () => {
  test("have no full track behind them, so a bar does not read as a percentage of 100", () => {
    const markup = renderToStaticMarkup(
      createElement(HBarChart, {
        rows: [{ key: "a", label: "Plan de juego", value: 200_000, valueText: "USD 2.000,00" }],
        ariaLabel: "Ingresos",
      }),
    );

    expect(markup).not.toContain("fill-neutral-tint");
    // Una sola barra por fila: la del valor.
    expect(markup.match(/<rect /g)).toHaveLength(2);
  });

  test("each breakdown says the bars are relative to the biggest one, apart from the percentages", () => {
    const html = render([sale({ id: "a", dollars: 100 }), sale({ id: "b", dollars: 50, item: "gamePlan" })]);

    for (const testId of ["items-income", "payments-income", "countries-income"]) {
      const text = plain(html.slice(html.indexOf(`data-testid="${testId}"`)));
      expect(text, testId).toContain("Las barras son relativas a la mayor");
    }
  });
});

describe("the pending deliveries", () => {
  test("show the first five and the rest on request, like the sessions to mark", () => {
    const deliveries = block(render(eightDeliveries()), "pending-deliveries");

    expect(deliveries).toContain(">8<");
    const visible = deliveries.slice(0, deliveries.indexOf("<details"));
    for (const id of ["delivery-1", "delivery-2", "delivery-3", "delivery-4", "delivery-5"]) {
      expect(visible).toContain(`/admin/ventas/${id}"`);
    }
    expect(visible).not.toContain("/admin/ventas/delivery-6");
    const rest = deliveries.slice(deliveries.indexOf("<details"));
    expect(rest).toContain("Ver las 3 restantes");
    for (const id of ["delivery-6", "delivery-7", "delivery-8"]) expect(rest).toContain(`/admin/ventas/${id}"`);
  });

  test("a single one left in the fold says so in the singular", () => {
    const deliveries = block(render(eightDeliveries().slice(0, 6)), "pending-deliveries");

    expect(deliveries).toContain("Ver 1 más");
  });

  test("a short list has no fold", () => {
    const deliveries = block(render(eightDeliveries().slice(0, 5)), "pending-deliveries");

    expect(deliveries).not.toContain("<details");
  });
});

describe("getting to the pending list from the top of the page", () => {
  test("a link at the start of the overview points to the pending block", () => {
    const html = render();

    expect(html).toMatch(/<a [^>]*href="#pendientes"[^>]*>[^<]*Ir a pendientes/);
    expect(html.indexOf('href="#pendientes"')).toBeLessThan(html.indexOf('data-testid="kpi-income-usd"'));
  });

  test("the block it points to exists and can be the target of the link", () => {
    expect(render()).toMatch(/<section[^>]*id="pendientes"[^>]*data-testid="pending"/);
  });

  test("the link is for narrow screens only", () => {
    const link = /<a [^>]*href="#pendientes"[^>]*class="([^"]*)"/.exec(render())?.[1] ?? "";

    expect(link).toMatch(/\bhidden\b/);
    expect(link).toMatch(/narrow:(inline-)?flex/);
  });
});
