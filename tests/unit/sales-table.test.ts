import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { SaleRow } from "@/admin/sales/repository";
import { SalesTable } from "@/admin/sales/sales-table";

const ROW: SaleRow = {
  id: "8f4f3f64-7c5c-4a43-9d4c-3f6a3a2f1b10",
  customerId: "11111111-7c5c-4a43-9d4c-3f6a3a2f1b10",
  customerName: "Ana Pérez",
  customerDiscord: "ana.fn",
  customerCountry: "AR",
  item: "gamePlan",
  description: null,
  currency: "USD",
  amountMinor: 12000,
  arsPerUnit: "1500.0000",
  arsPerUsd: "1500.0000",
  rateSource: "bcra",
  rateQuotedOn: "2026-10-09",
  amountArsMinor: 18_000_000,
  amountUsdMinor: 12000,
  paymentMethod: "mercadopago",
  status: "paid",
  paidOn: "2026-10-12",
  dueAt: null,
  deliveredAt: null,
  invoiceStatus: "pending",
  invoiceType: null,
  invoiceNumber: null,
  invoicedOn: null,
  source: "manual",
  notes: null,
  createdAt: new Date("2026-10-12T15:00:00Z"),
  updatedAt: new Date("2026-10-12T15:00:00Z"),
};

function render(rows: SaleRow[], hasFilters = false): string {
  return renderToStaticMarkup(createElement(SalesTable, { rows, hasFilters }));
}

describe("SalesTable", () => {
  test("empty sales table invites to add the first sale", () => {
    const markup = render([]);

    expect(markup).toContain("Cargá tu primera venta");
    expect(markup).toContain('href="/admin/ventas/nueva"');
    expect(markup).not.toContain("<table");
  });

  test("with filters on, an empty result offers to clear them instead", () => {
    const markup = render([], true);

    expect(markup).toContain("Ninguna venta coincide con los filtros");
    expect(markup).toContain('href="/admin/ventas"');
    expect(markup).not.toContain("Cargá tu primera venta");
  });

  test("shows each sale with its student, item and the three amounts", () => {
    const markup = render([ROW]);

    expect(markup).toContain("Ana Pérez");
    expect(markup).toContain("ana.fn");
    expect(markup).toContain("Plan de juego personalizado");
    expect(markup).toContain("Mercado Pago");
    // Cobrado en dólares: el monto, los pesos y los dólares guardados.
    expect(markup).toContain("USD 120,00");
    expect(markup).toContain("$ 180.000,00");
    expect(markup).toContain("12/10/2026");
    expect(markup).toContain("Cobrada");
    expect(markup).toContain("Sin facturar");
  });

  test("each row opens the sale", () => {
    const markup = render([ROW]);

    expect(markup).toContain(`href="/admin/ventas/${ROW.id}"`);
  });

  test("a sale not collected yet has no payment date, and 'Otro' shows its description", () => {
    const markup = render([
      { ...ROW, status: "pending", paidOn: null, item: "other", description: "Revisión de clip" },
    ]);

    expect(markup).toContain("Pendiente");
    expect(markup).toContain("Revisión de clip");
    expect(markup).not.toContain("12/10/2026");
    expect(markup).toContain("Sin fecha");
  });

  test("keeps the charged currency's own symbol", () => {
    const markup = render([
      { ...ROW, currency: "BRL", amountMinor: 10000, amountArsMinor: 2_800_000, amountUsdMinor: 1867 },
    ]);

    expect(markup).toContain("R$ 100,00");
    expect(markup).toContain("$ 28.000,00");
    expect(markup).toContain("USD 18,67");
  });

  test("never turns a name or a description into markup", () => {
    const markup = render([
      { ...ROW, customerName: "<img src=x onerror=alert(1)>", customerDiscord: "<b>d</b>" },
    ]);

    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(markup).toContain("&lt;b&gt;d&lt;/b&gt;");
    expect(markup).not.toContain("<img src=x");
  });

  test("the table scrolls inside its own region that a keyboard can reach", () => {
    const markup = render([ROW]);

    expect(markup).toMatch(/<div[^>]*role="region"[^>]*aria-label="Ventas"[^>]*tabindex="0"/);
    expect(markup).toContain("overflow-x-auto");
  });
});
