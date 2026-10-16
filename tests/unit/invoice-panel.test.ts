import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { InvoicePanel } from "@/admin/billing/invoice-panel";
import type { SaleRow } from "@/admin/sales/repository";
import { saleRow } from "../helpers/sale-rows";

async function noop() {}

function render(overrides: Partial<SaleRow> = {}): string {
  return renderToStaticMarkup(createElement(InvoicePanel, { sale: saleRow(overrides), undoAction: noop }));
}

const ISSUED = {
  invoiceStatus: "issued",
  invoiceType: "E",
  invoiceNumber: "00003-00000045",
  invoicedOn: "2026-10-13",
} as const;

describe("InvoicePanel", () => {
  test("is a labelled section titled Factura", () => {
    const markup = render();

    expect(markup).toMatch(/<section[^>]*aria-labelledby="invoice-panel-title"/);
    expect(markup).toMatch(/<h2 id="invoice-panel-title"[^>]*>Factura<\/h2>/);
  });

  test("an invoiced sale shows its state, type, number and date, and offers to undo it", () => {
    const markup = render(ISSUED);

    expect(markup).toContain("Facturada");
    expect(markup).toContain("Factura E");
    expect(markup).toContain("00003-00000045");
    expect(markup).toContain("13/10/2026");
    expect(markup).toContain("Volver a pendiente");
    expect(markup).toContain("<form");
  });

  test("tells how to fix a typo: undo and mark again in Facturación", () => {
    const markup = render(ISSUED);

    expect(markup).toContain("volvela a pendiente y marcala de nuevo en");
    expect(markup).toMatch(/<a [^>]*href="\/admin\/facturacion"[^>]*>Facturación<\/a>/);
  });

  test("a sale marked as not requiring an invoice says so, has no invoice data and offers to undo it", () => {
    const markup = render({ invoiceStatus: "not_required" });

    expect(markup).toContain("No requiere");
    expect(markup).toContain("Volver a pendiente");
    expect(markup).not.toContain("Número");
  });

  test("a collected sale that is pending points to Facturación and has nothing to undo", () => {
    const markup = render({ invoiceStatus: "pending" });

    expect(markup).toContain("Sin facturar");
    expect(markup).toContain('href="/admin/facturacion"');
    expect(markup).not.toContain("Volver a pendiente");
    expect(markup).not.toContain("<form");
  });

  test("a sale that was not collected yet says it can be invoiced once it is, without a link", () => {
    const markup = render({ invoiceStatus: "pending", status: "pending", paidOn: null });

    expect(markup).toContain("cobrada");
    expect(markup).not.toContain('href="/admin/facturacion"');
    expect(markup).not.toContain("Volver a pendiente");
  });

  test("text written by hand in the number is escaped, not run", () => {
    const markup = render({ ...ISSUED, invoiceNumber: '<img src=x onerror="alert(1)">' });

    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img");
  });
});
