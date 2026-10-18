import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { buildBilling, type BillingData } from "@/admin/billing/billing-data";
import { BillingView } from "@/admin/billing/billing-view";
import { INITIAL_INVOICING_FORM_STATE } from "@/admin/billing/form-state";
import { CONFIRM_NOT_REQUIRED_ABOVE } from "@/admin/billing/uninvoiced-list";
import type { MetricSale } from "@/admin/metrics/metric-sale";
import type { MonotributoSettings } from "@/admin/metrics/monotributo";
import { NOW, sale } from "../helpers/metric-sales";
import { saleRow } from "../helpers/sale-rows";

const SETTINGS: MonotributoSettings = { category: "C", annualCapArsMinor: 1_000_000_000, validFrom: "2026-08-01" };

async function noop() {
  return INITIAL_INVOICING_FORM_STATE;
}

function build(
  overrides: {
    rows?: ReturnType<typeof saleRow>[];
    truncated?: boolean;
    sales?: MetricSale[];
    settings?: MonotributoSettings | null;
  } = {},
): BillingData {
  return buildBilling({
    uninvoiced: { rows: overrides.rows ?? [], truncated: overrides.truncated ?? false },
    sales: overrides.sales ?? [],
    settings: overrides.settings === undefined ? SETTINGS : overrides.settings,
    now: NOW,
  });
}

function render(data: BillingData): string {
  return renderToStaticMarkup(createElement(BillingView, { data, invoiceAction: noop }));
}

describe("buildBilling", () => {
  test("groups the pending list by month and totals it", () => {
    const data = build({
      rows: [
        saleRow({ paidOn: "2026-10-12", amountArsMinor: 6_000_000, amountUsdMinor: 4000 }),
        saleRow({ paidOn: "2026-10-03", amountArsMinor: 3_000_000, amountUsdMinor: 2000 }),
        saleRow({ paidOn: "2026-09-20", amountArsMinor: 1_500_000, amountUsdMinor: 1000 }),
      ],
    });

    expect(data.uninvoiced).toMatchObject({ count: 3, arsMinor: 10_500_000, usdMinor: 7000, truncated: false });
    expect(data.uninvoiced.groups.map((group) => [group.month, group.count])).toEqual([
      ["2026-10", 2],
      ["2026-09", 1],
    ]);
  });

  test("lists the last 12 months newest first, with the totals of the year", () => {
    const data = build({
      sales: [
        sale({ paidOn: "2026-10-02", dollars: 100, invoiceStatus: "issued" }),
        sale({ paidOn: "2026-02-02", dollars: 40, invoiceStatus: "pending" }),
      ],
    });

    expect(data.months).toHaveLength(12);
    expect(data.months[0].month).toBe("2026-10");
    expect(data.months[11].month).toBe("2025-11");
    expect(data.total.collected.usdMinor).toBe(14000);
    expect(data.total.pending.usdMinor).toBe(4000);
  });

  test("the monotributo is the one of the overview, over the same sales", () => {
    const data = build({ sales: [sale({ paidOn: "2026-10-02", dollars: 100 })] });

    expect(data.monotributo.settings).toEqual(SETTINGS);
    expect(data.monotributo.status.last12ArsMinor).toBe(100 * 100 * 1500);
    expect(data.monotributo.window).toEqual({ from: "2025-10-14", to: "2026-10-13" });
  });

  test("the export starts with the monotributo window and ends today", () => {
    expect(build().exportDefaults).toEqual({ from: "2025-10-14", to: "2026-10-13" });
  });

  test("tells whether there is any income at all", () => {
    expect(build().hasIncome).toBe(false);
    expect(build({ sales: [sale({ status: "cancelled" })] }).hasIncome).toBe(false);
    expect(build({ sales: [sale({ paidOn: "2026-10-14" })] }).hasIncome).toBe(false);
    expect(build({ sales: [sale()] }).hasIncome).toBe(true);
    expect(build({ rows: [saleRow()] }).hasIncome).toBe(true);
  });
});

describe("BillingView", () => {
  test("with no income it invites to load the first sale", () => {
    const markup = render(build());

    expect(markup).toContain("Todavía no hay ventas cobradas");
    expect(markup).toContain('href="/admin/ventas/nueva"');
    expect(markup).not.toContain("<table");
  });

  test("with everything invoiced it says so and offers nothing to mark", () => {
    const markup = render(build({ sales: [sale({ paidOn: "2026-10-02" })] }));

    expect(markup).toContain("Todo lo cobrado está facturado");
    expect(markup).not.toContain("Marcar como facturadas");
    // El resumen de 12 meses y la exportación siguen estando.
    expect(markup).toContain("Cobrado y facturado, mes a mes");
    expect(markup).toContain("Exportar para el contador");
  });

  test("shows each pending sale with a checkbox that names it, grouped by month", () => {
    const markup = render(
      build({
        rows: [
          saleRow({ customerName: "Ana Pérez", paidOn: "2026-10-12", item: "gamePlan", amountMinor: 12000, amountUsdMinor: 12000, amountArsMinor: 18_000_000 }),
          saleRow({ customerName: "Beto Gómez", paidOn: "2026-09-20", item: "vodRecorded" }),
        ],
      }),
    );

    expect(markup).toContain("Ana Pérez");
    expect(markup).toContain("Plan de juego personalizado");
    expect(markup).toContain("12/10/2026");
    expect(markup).toContain("$ 180.000,00");
    expect(markup).toContain("USD 120,00");
    expect(markup).toContain("octubre de 2026");
    expect(markup).toContain("septiembre de 2026");
    // Una casilla por venta, una por mes y una para elegirlas todas.
    expect(markup.match(/type="checkbox"/g)).toHaveLength(5);
    expect(markup).toMatch(/aria-label="Elegir la venta de Ana Pérez[^"]*"/);
    expect(markup).toMatch(/aria-label="Elegir todas las ventas de octubre de 2026"/);
    expect(markup).toContain('aria-label="Elegir todas las ventas sin facturar"');
    expect(markup).toContain('name="ids"');
  });

  test("shows the total to invoice in pesos and dollars", () => {
    const markup = render(
      build({
        rows: [
          saleRow({ amountArsMinor: 6_000_000, amountUsdMinor: 4000 }),
          saleRow({ amountArsMinor: 3_000_000, amountUsdMinor: 2000 }),
        ],
      }),
    );

    expect(markup).toContain("2 ventas sin facturar");
    expect(markup).toContain("$ 90.000,00");
    expect(markup).toContain("USD 60,00");
  });

  test("a single sale is written in the singular", () => {
    expect(render(build({ rows: [saleRow()] }))).toContain("1 venta sin facturar");
  });

  test("offers both actions with the invoice fields", () => {
    const markup = render(build({ rows: [saleRow()] }));

    expect(markup).toContain("Marcar como facturadas");
    expect(markup).toContain("No requiere factura");
    expect(markup).toContain('name="type"');
    expect(markup).toContain('name="number"');
    expect(markup).toContain('name="issuedOn"');
    expect(markup).toContain('value="2026-10-13"');
    expect(markup).toContain('name="intent"');
  });

  test("asks to confirm before marking many sales as not requiring an invoice, with a native dialog", () => {
    const markup = render(build({ rows: [saleRow()] }));

    expect(CONFIRM_NOT_REQUIRED_ABOVE).toBe(5);
    expect(markup).toContain("<dialog");
    expect(markup).toContain('aria-labelledby="bulk-confirm-title"');
    expect(markup).toContain("Sí, marcar");
    expect(markup).toContain("Cancelar");
    expect(markup).toContain("volver a pendiente");
  });

  test("warns when the list was cut", () => {
    const markup = render(build({ rows: [saleRow()], truncated: true }));

    expect(markup).toContain("Hay más ventas sin facturar de las que se muestran");
  });

  test("shows the 12-month table with a line per month and the total", () => {
    const markup = render(
      build({
        sales: [
          sale({ paidOn: "2026-10-02", dollars: 100, invoiceStatus: "issued" }),
          sale({ paidOn: "2026-08-02", dollars: 40, invoiceStatus: "pending" }),
        ],
      }),
    );

    expect(markup).toContain("octubre de 2026");
    expect(markup).toContain("noviembre de 2025");
    expect(markup).toContain("Total de 12 meses");
    // Total cobrado: 140 dólares a 1.500 pesos, y su valor en dólares debajo.
    expect(markup).toContain("$ 210.000,00");
    expect(markup).toContain("USD 140,00");
  });

  test("includes the monotributo card, with a prompt when nothing was loaded", () => {
    const withSettings = render(build({ sales: [sale()] }));
    const without = render(build({ sales: [sale()], settings: null }));

    expect(withSettings).toContain('role="meter"');
    expect(withSettings).toContain("Tope, categoría C");
    expect(without).toContain("Cargar categoría y tope");
    expect(without).toContain('href="/admin/configuracion"');
  });

  test("the export form downloads from the billing endpoint with the window as default", () => {
    const markup = render(build({ sales: [sale()] }));

    expect(markup).toContain('action="/admin/facturacion/exportar"');
    expect(markup).toContain('method="get"');
    expect(markup).toContain('name="desde"');
    expect(markup).toContain('value="2025-10-14"');
    expect(markup).toContain('name="hasta"');
    expect(markup).toContain('name="factura"');
    expect(markup).toContain("Descargar CSV");
    // Dice qué dos cotizaciones trae el archivo.
    expect(markup).toContain("el tipo de cambio de la moneda cobrada, la");
    expect(markup).toContain("cotización del dólar (con su fuente y su fecha)");
  });
});

describe("the count at the top of the list", () => {
  /** Lo que lee la lista (la página la corta en 1.000) y el total que cuenta la base aparte. */
  function withTotals(totals: { count: number; arsMinor: number; usdMinor: number }, truncated = true) {
    return buildBilling({
      uninvoiced: { rows: [saleRow(), saleRow()], truncated, totals },
      sales: [],
      settings: SETTINGS,
      now: NOW,
    });
  }

  test("comes from the separate count, not from the length of the list that was cut", () => {
    const data = withTotals({ count: 1500, arsMinor: 90_000_000, usdMinor: 60_000 });

    expect(data.uninvoiced.count).toBe(1500);
    expect(data.uninvoiced).toMatchObject({ arsMinor: 90_000_000, usdMinor: 60_000, truncated: true });
    // Las filas que se muestran son las que llegaron: la lista sigue siendo la cortada.
    expect(data.uninvoiced.groups.flatMap((group) => group.rows)).toHaveLength(2);
    const markup = render(data);
    expect(markup).toContain("1500 ventas sin facturar");
    expect(markup).toContain("$ 900.000,00");
    expect(markup).toContain("USD 600,00");
  });

  test("without a separate count it is what the listed rows add up to", () => {
    const data = build({ rows: [saleRow(), saleRow(), saleRow()] });

    expect(data.uninvoiced.count).toBe(3);
  });
});

describe("the scope of the list against the 12-month table", () => {
  const NOTE = "Esta lista trae todo lo cobrado sin facturar, de cualquier fecha";

  test("says so when something to invoice was collected before the 12 months of the table", () => {
    const markup = render(build({ rows: [saleRow({ paidOn: "2025-06-10" }), saleRow({ paidOn: "2026-10-05" })] }));

    expect(markup).toContain(NOTE);
    expect(markup).toContain("de los últimos 12 meses");
  });

  test("says nothing when everything is inside those 12 months", () => {
    // La tabla empieza en noviembre de 2025: octubre de 2026 y noviembre de 2025 entran.
    const markup = render(build({ rows: [saleRow({ paidOn: "2025-11-02" }), saleRow({ paidOn: "2026-10-05" })] }));

    expect(markup).not.toContain(NOTE);
  });

  test("with the list cut it still says it: the older sales may be the ones left out", () => {
    const markup = render(build({ rows: [saleRow({ paidOn: "2026-10-05" })], truncated: true }));

    expect(markup).toContain(NOTE);
  });
});
