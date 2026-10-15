import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { OverviewView } from "@/admin/overview/overview-view";
import { buildOverview, type OverviewData } from "@/admin/overview/overview-data";
import { computeKpis } from "@/admin/metrics/kpis";
import type { MonotributoSettings } from "@/admin/metrics/monotributo";
import { monotributoStatus } from "@/admin/metrics/monotributo";
import type { MetricSale } from "@/admin/metrics/metric-sale";
import { pendingWork } from "@/admin/metrics/pending";
import { PERIODS, periodRange, previousPeriodRange, type Period } from "@/admin/metrics/period";
import { incomeByCountry, incomeByItem, monthlyIncome } from "@/admin/metrics/series";
import { NOW, sale } from "../helpers/metric-sales";

const SETTINGS: MonotributoSettings = { category: "C", annualCapArsMinor: 300_000_000, validFrom: "2026-08-01" };

/** Octubre (1 al 13) contra septiembre (1 al 13): 300 contra 200 dólares. */
function sampleSales(): MetricSale[] {
  return [
    sale({ id: "oct-1", customerId: "ana", paidOn: "2026-10-05", dollars: 200 }),
    sale({ id: "oct-2", customerId: "bruno", paidOn: "2026-10-09", dollars: 100, country: "BR", paymentMethod: "pix" }),
    sale({ id: "sep-1", customerId: "ana", paidOn: "2026-09-05", dollars: 120 }),
    sale({ id: "sep-2", customerId: "carla", paidOn: "2026-09-12", dollars: 80, country: null }),
    // Septiembre pasado el día 20: queda fuera del tramo comparable (1 al 13).
    sale({ id: "sep-late", customerId: "dario", paidOn: "2026-09-20", dollars: 500 }),
  ];
}

function render(data: OverviewData): string {
  return renderToStaticMarkup(createElement(OverviewView, { data }));
}

function build(
  sales: readonly MetricSale[],
  period: Period = "thisMonth",
  settings: MonotributoSettings | null = SETTINGS,
  now = NOW,
) {
  return buildOverview(sales, settings, period, now);
}

describe("buildOverview", () => {
  test("puts every number from the metrics under the selected period", () => {
    const sales = sampleSales();
    for (const period of PERIODS) {
      const data = build(sales, period);
      expect(data.period).toBe(period);
      expect(data.today).toBe("2026-10-13");
      expect(data.range).toEqual(periodRange(period, NOW));
      expect(data.previousRange).toEqual(previousPeriodRange(period, NOW));
      expect(data.kpis).toEqual(computeKpis(sales, period, NOW));
      expect(data.byItem).toEqual(incomeByItem(sales, periodRange(period, NOW)));
      expect(data.byCountry).toEqual(incomeByCountry(sales, periodRange(period, NOW)));
      expect(data.months).toEqual(monthlyIncome(sales, 12, NOW));
      expect(data.pending).toEqual(pendingWork(sales, NOW));
      expect(data.monotributo.status).toEqual(monotributoStatus(sales, SETTINGS, NOW));
    }
  });

  test("the previous income is what the delta compares against", () => {
    const data = build(sampleSales());
    // 300 dólares contra 200 del 1 al 13 de septiembre: +50 %.
    expect(data.kpis.incomeUsdMinor).toBe(30_000);
    expect(data.previousIncomeUsdMinor).toBe(20_000);
    expect(data.kpis.incomeUsdDeltaPct).toBe(50);
  });

  test("the previous income is zero when nothing was collected, and then there is no delta", () => {
    const data = build([sale({ paidOn: "2026-10-05" })]);
    expect(data.previousIncomeUsdMinor).toBe(0);
    expect(data.kpis.incomeUsdDeltaPct).toBeNull();
  });

  test("counts the days of the period, today included", () => {
    expect(build([], "thisMonth").rangeDays).toBe(13);
    expect(build([], "lastMonth").rangeDays).toBe(30);
    expect(build([], "last30").rangeDays).toBe(30);
    expect(build([], "thisMonth", SETTINGS, new Date("2026-10-03T15:00:00.000Z")).rangeDays).toBe(3);
  });

  test("tells whether there is anything to show", () => {
    expect(build([]).hasSales).toBe(false);
    expect(build([sale()]).hasSales).toBe(true);
  });

  test("monotributo carries its window, settings and status", () => {
    const data = build(sampleSales());
    expect(data.monotributo.window).toEqual({ from: "2025-10-14", to: "2026-10-13" });
    expect(data.monotributo.settings).toEqual(SETTINGS);
    expect(build(sampleSales(), "thisMonth", null).monotributo.settings).toBeNull();
  });
});

describe("OverviewView", () => {
  test("overview renders the empty state without sales", () => {
    const html = render(build([]));

    expect(html).toContain("Todavía no hay ventas cobradas");
    expect(html).toContain('href="/admin/ventas/nueva"');
    expect(html).toContain("Cargá tu primera venta");
    // Sin ventas no hay números que mostrar ni período que elegir.
    expect(html).not.toContain("Cobrado en dólares");
    expect(html).not.toContain("Este año");
  });

  test("income cards say what was collected, and only the dollars carry a variation", () => {
    const html = render(build(sampleSales()));

    expect(html).toContain("Cobrado en dólares");
    expect(html).toContain("Cobrado en pesos");
    expect(html).toContain("Ventas cobradas");
    const usd = section(html, "kpi-income-usd");
    const ars = section(html, "kpi-income-ars");
    expect(plain(usd)).toContain("+50 %");
    expect(plain(usd)).toContain("USD 300,00");
    expect(plain(ars)).toContain("$ 450.000,00");
    expect(plain(ars)).not.toContain("%");
    expect(ars).not.toContain("data-direction");
    expect(plain(ars)).not.toContain("vs.");
  });

  test("the dollar card names both spans, and the amount it is compared with", () => {
    const usd = plain(section(render(build(sampleSales())), "kpi-income-usd"));

    expect(usd).toContain("1–13 oct.");
    expect(usd).toContain("vs. 1–13 sep.");
    expect(usd).toContain("USD 200,00");
  });

  test("the compared span follows the period", () => {
    const labelOf = (period: Period) => plain(section(render(build(sampleSales(), period)), "kpi-income-usd"));

    expect(labelOf("lastMonth")).toContain("vs. 1–31 ago.");
    expect(labelOf("last30")).toContain("vs. 15 ago. – 13 sep.");
    expect(labelOf("thisYear")).toContain("vs. 1 ene. – 13 oct. 2025");
    expect(labelOf("last12")).toContain("vs. 1 nov. 2024 – 13 oct. 2025");
  });

  test("no previous income reads as no comparison, never as an infinite growth", () => {
    const usd = section(render(build([sale({ paidOn: "2026-10-05" })])), "kpi-income-usd");

    expect(plain(usd)).toContain("Sin comparación");
    expect(usd).not.toContain("data-direction");
  });

  test("early in the period it says there are few days to compare", () => {
    const early = render(build(sampleSales(), "thisMonth", SETTINGS, new Date("2026-10-03T15:00:00.000Z")));
    expect(early).toContain("Pocos días para comparar");
    expect(render(build(sampleSales(), "thisMonth"))).not.toContain("Pocos días para comparar");
    expect(render(build(sampleSales(), "lastMonth"))).not.toContain("Pocos días para comparar");
  });

  test("shows the period being looked at and how it is compared", () => {
    const html = render(build(sampleSales()));
    expect(html).toContain("Este mes");
    expect(html).toContain("1–13 oct.");
  });

  test("the period selector marks the current one and links to the others", () => {
    const html = render(build(sampleSales(), "last30"));

    const links = new Map(
      [...html.matchAll(/<a ([^>]*href="(\/admin(?:\?periodo=[a-z0-9-]+)?)"[^>]*)>/g)].map((match) => [
        match[2],
        match[1],
      ]),
    );
    expect([...links.keys()]).toEqual([
      "/admin",
      "/admin?periodo=mes-pasado",
      "/admin?periodo=30-dias",
      "/admin?periodo=12-meses",
      "/admin?periodo=este-ano",
    ]);
    expect(links.get("/admin?periodo=30-dias")).toContain('aria-current="true"');
    for (const [href, attributes] of links) {
      if (href !== "/admin?periodo=30-dias") expect(attributes, href).not.toContain("aria-current");
    }
  });

  test("countries show their name in Spanish, and students without one say so", () => {
    const html = render(build(sampleSales(), "last12"));

    expect(html).toContain("Argentina");
    expect(html).toContain("Brasil");
    expect(html).toContain("Sin país");
    expect(html).not.toMatch(/>AR</);
  });

  test("shares are labelled as rounded", () => {
    const html = render(build(sampleSales()));
    expect(html).toContain("redondeados");
    expect(html).toMatch(/title="[^"]*redondead/);
  });

  test("lists the items without sales in the last 90 days", () => {
    const html = render(build(sampleSales()));
    expect(html).toContain("Sin ventas en los últimos 90 días");
    expect(html).toContain("Temporada Pro");
    expect(html).not.toContain(">Otro<");
  });

  test("the monotributo meter says its window, that it goes by collection date and where the cap comes from", () => {
    const html = render(build(sampleSales()));
    const card = section(html, "monotributo");
    const text = plain(card);

    expect(text).toContain("14/10/2025");
    expect(text).toContain("13/10/2026");
    expect(text).toContain("por fecha de cobro");
    expect(text).toContain("categoría C");
    expect(text).toContain("$ 3.000.000,00");
    expect(text).toContain("$ 1.500.000,00");
    expect(text).toContain("lo que cargaste");
    expect(text).toContain("01/08/2026");
    expect(card).toContain('role="meter"');
    expect(card).toContain('aria-valuenow="50"');
  });

  test("without monotributo settings it still shows the total and links to Configuración", () => {
    const html = renderToStaticMarkup(
      createElement(OverviewView, { data: buildOverview(sampleSales(), null, "thisMonth", NOW) }),
    );
    const card = section(html, "monotributo");

    expect(plain(card)).toContain("$ 1.500.000,00");
    expect(card).toContain('href="/admin/configuracion"');
    expect(card).not.toContain('role="meter"');
  });

  test("over the cap the monotributo says by how much", () => {
    const html = render(
      build([sale({ amountArsMinor: 125_000_000, amountUsdMinor: 100 })], "thisMonth", {
        ...SETTINGS,
        annualCapArsMinor: 100_000_000,
      }),
    );
    const card = plain(section(html, "monotributo"));

    expect(card).toContain("Superaste el tope");
    expect(card).toContain("$ 250.000,00");
  });

  test("next to the cap the card never writes a negative amount or a zero over", () => {
    const cardFor = (collectedArsMinor: number) =>
      plain(
        section(
          render(
            build([sale({ amountArsMinor: collectedArsMinor, amountUsdMinor: 1 })], "thisMonth", {
              ...SETTINGS,
              annualCapArsMinor: 10_000_000,
            }),
          ),
          "monotributo",
        ),
      );

    // 99,95 %: se redondea a 100 %, pero todavía quedan $ 50,00.
    const almost = cardFor(9_995_000);
    expect(almost).toContain("100 %");
    expect(almost).toContain("Estás a punto de llegar al tope: te quedan $ 50,00");
    expect(almost).not.toContain("Superaste");
    expect(almost).not.toContain("-$");
    // Justo el tope.
    const exact = cardFor(10_000_000);
    expect(exact).toContain("Llegaste al tope");
    expect(exact).not.toContain("Superaste");
    expect(exact).not.toContain("$ 0,00 ");
    // 100,05 %: pasado por $ 50,00.
    const over = cardFor(10_005_000);
    expect(over).toContain("Superaste el tope por $ 50,00");
    expect(over).not.toContain("-$");
  });

  test("the meter of the card is warn near the cap and danger only at or over it", () => {
    const meterOf = (collectedArsMinor: number) =>
      section(
        render(
          build([sale({ amountArsMinor: collectedArsMinor, amountUsdMinor: 1 })], "thisMonth", {
            ...SETTINGS,
            annualCapArsMinor: 10_000_000,
          }),
        ),
        "monotributo",
      );

    expect(meterOf(9_995_000)).toContain("fill-warn");
    expect(meterOf(9_995_000)).not.toContain("fill-danger");
    expect(meterOf(10_000_000)).toContain("fill-danger");
    expect(meterOf(10_005_000)).toContain("fill-danger");
  });

  test("the repeat rate says of whom it is", () => {
    const html = render(build(sampleSales()));
    expect(plain(section(html, "kpi-repeat-rate"))).toContain("de los que compraron, ya habían comprado antes");
  });

  test("pending deliveries and sessions link to their sale and flag what is unpaid", () => {
    const sales = [
      sale({ id: "vod-late", item: "vodRecorded", customerId: "ana", dueAt: "2026-10-12T18:00:00.000Z" }),
      sale({ id: "plan-soon", item: "gamePlan", customerId: "bruno", dueAt: "2026-10-16T18:00:00.000Z" }),
      sale({
        id: "lesson-unpaid",
        item: "lesson",
        customerId: "carla",
        status: "pending",
        paidOn: null,
        dueAt: "2026-10-15T18:00:00.000Z",
      }),
    ];
    const html = render(build(sales));
    const deliveries = section(html, "pending-deliveries");
    const sessions = section(html, "pending-sessions");

    expect(deliveries).toContain('href="/admin/ventas/vod-late"');
    expect(deliveries).toContain("Vencida");
    expect(deliveries).toContain('href="/admin/ventas/plan-soon"');
    expect(deliveries).toContain("Ana");
    expect(sessions).toContain('href="/admin/ventas/lesson-unpaid"');
    expect(sessions).toContain("Sin cobrar");
    expect(sessions).toContain("jue 15/10, 15:00");
  });

  test("sessions to mark show how many there are, the first five and the rest on request", () => {
    const sales = Array.from({ length: 8 }, (_, index) =>
      sale({
        id: `past-${index + 1}`,
        item: "lesson",
        customerId: `c${index + 1}`,
        dueAt: `2026-10-0${index + 1}T18:00:00.000Z`,
        status: index === 6 ? "pending" : "paid",
        paidOn: index === 6 ? null : "2026-09-20",
      }),
    );
    const html = render(build(sales));
    const toMark = section(html, "pending-to-mark");

    expect(toMark).toContain(">8<");
    const visible = toMark.slice(0, toMark.indexOf("<details"));
    for (const id of ["past-1", "past-2", "past-3", "past-4", "past-5"]) {
      expect(visible).toContain(`/admin/ventas/${id}"`);
    }
    expect(visible).not.toContain("/admin/ventas/past-6");
    const rest = toMark.slice(toMark.indexOf("<details"));
    expect(rest).toContain("Ver las 3 restantes");
    for (const id of ["past-6", "past-7", "past-8"]) expect(rest).toContain(`/admin/ventas/${id}"`);
    // La que nunca se cobró sale marcada, también entre las restantes.
    expect(rest).toContain("Sin cobrar");
  });

  test("a short list of sessions to mark has no fold", () => {
    const html = render(build([sale({ id: "one", item: "lesson", dueAt: "2026-10-01T18:00:00.000Z" })]));
    const toMark = section(html, "pending-to-mark");

    expect(toMark).toContain('href="/admin/ventas/one"');
    expect(toMark).not.toContain("<details");
  });

  test("shows the sales still to be invoiced with their total in pesos", () => {
    const html = render(build([sale({ invoiceStatus: "pending", dollars: 40 }), sale({ invoiceStatus: "pending", dollars: 60 })]));
    const uninvoiced = section(html, "pending-uninvoiced");

    expect(uninvoiced).toContain(">2<");
    expect(plain(uninvoiced)).toContain("$ 150.000,00");
    expect(uninvoiced).toContain('href="/admin/facturacion"');
  });

  test("when nothing is pending it says so instead of leaving empty boxes", () => {
    const html = render(build([sale({ invoiceStatus: "issued" })]));

    expect(section(html, "pending-deliveries")).toContain("Nada pendiente");
    expect(section(html, "pending-sessions")).toContain("Nada pendiente");
    expect(section(html, "pending-to-mark")).toContain("Nada pendiente");
    expect(section(html, "pending-uninvoiced")).toContain("Todo lo cobrado está facturado");
  });

  test("a month chart bar per month, each with its name and amount", () => {
    const html = render(build(sampleSales()));
    expect(html.match(/data-testid="bar"/g)).toHaveLength(12);
    expect(html).toContain('aria-label="octubre de 2026: USD 300,00 (mes en curso, parcial)"');
    expect(html).toContain('aria-label="septiembre de 2026: USD 700,00"');
    expect(html).toContain('aria-label="agosto de 2026: USD 0,00"');
  });

  test("a period without sales still renders every block, saying so", () => {
    const html = render(build([sale({ paidOn: "2026-05-05" })], "thisMonth"));

    expect(html).toContain("Cobrado en dólares");
    expect(html).toContain("USD 0,00");
    expect(html).toContain("Sin ventas cobradas en este período");
    expect(html).not.toContain("Todavía no hay ventas cobradas");
  });
});

/** El texto de un trozo de HTML: sin etiquetas y con los espacios juntos. */
function plain(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/**
 * El trozo de HTML de un bloque, desde su `data-testid` hasta que termina el
 * elemento (se cuentan las aperturas y cierres del mismo tipo de etiqueta).
 */
function section(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`;
  const markerAt = html.indexOf(marker);
  if (markerAt < 0) throw new Error(`No hay un bloque ${testId} en el HTML.`);
  const start = html.lastIndexOf("<", markerAt);
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))?.[1];
  if (!tag) throw new Error(`No se pudo leer la etiqueta de ${testId}.`);
  const open = new RegExp(`<${tag}[\\s>]`, "g");
  const close = new RegExp(`</${tag}>`, "g");
  let depth = 0;
  let cursor = start;
  while (cursor < html.length) {
    open.lastIndex = cursor;
    close.lastIndex = cursor;
    const nextOpen = open.exec(html);
    const nextClose = close.exec(html);
    if (!nextClose) break;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + 1;
    } else {
      depth -= 1;
      cursor = nextClose.index + 1;
      if (depth === 0) return html.slice(start, nextClose.index + `</${tag}>`.length);
    }
  }
  throw new Error(`No se encontró el final del bloque ${testId}.`);
}
