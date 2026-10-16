import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { InvoicePanel } from "@/admin/billing/invoice-panel";
import type { SaleRow } from "@/admin/sales/repository";
import { saleRow } from "../helpers/sale-rows";

async function noop() {}

/** Martes 16/10/2026 en Argentina: la venta de prueba (cobrada el 5/10) ya se puede facturar. */
const TODAY = "2026-10-16";

function render(overrides: Partial<SaleRow> = {}, today: string = TODAY): string {
  return renderToStaticMarkup(createElement(InvoicePanel, { sale: saleRow(overrides), undoAction: noop, today }));
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

  test.each(["paid", "delivered"] as const)("a %s sale with an invoice can be returned to pending", (status) => {
    const markup = render({ ...ISSUED, status });

    expect(markup).toContain("Volver a pendiente");
    expect(markup).toContain("<form");
    expect(markup).not.toContain("nota de crédito");
  });

  describe("a cancelled or refunded sale", () => {
    test.each([
      ["cancelled", "cancelada"],
      ["refunded", "reembolsada"],
    ] as const)("%s: shows the invoice data, no undo button, and says the credit note is made in ARCA", (status, word) => {
      const markup = render({ ...ISSUED, status });

      expect(markup).toContain("Facturada");
      expect(markup).toContain("Factura E");
      expect(markup).toContain("00003-00000045");
      expect(markup).toContain("13/10/2026");
      expect(markup).not.toContain("Volver a pendiente");
      expect(markup).not.toContain("<form");
      expect(markup).not.toContain("<button");
      expect(markup).toContain(`la venta está ${word}`);
      expect(markup).toContain("nota de crédito");
      expect(markup).toContain("ARCA");
    });

    test("one marked as not requiring an invoice has no button either, and no credit note to talk about", () => {
      const markup = render({ invoiceStatus: "not_required", status: "cancelled" });

      expect(markup).toContain("No requiere");
      expect(markup).not.toContain("Volver a pendiente");
      expect(markup).not.toContain("<form");
      expect(markup).not.toContain("nota de crédito");
      expect(markup).toContain("la venta está cancelada");
    });
  });

  test("an invoiced sale that is not collected yet cannot be returned to pending either", () => {
    const markup = render({ ...ISSUED, status: "pending", paidOn: null });

    expect(markup).toContain("Factura E");
    expect(markup).not.toContain("Volver a pendiente");
    expect(markup).not.toContain("<form");
    expect(markup).toContain("cobrada o entregada");
  });

  describe("a collected sale whose payment date is in the future", () => {
    test("says from which day it can be invoiced, with no link to Facturación (it is not in that list yet)", () => {
      const markup = render({ invoiceStatus: "pending", paidOn: "2026-10-20" });

      expect(markup).toContain("La vas a poder facturar desde el 20/10/2026.");
      expect(markup).not.toContain('href="/admin/facturacion"');
      expect(markup).not.toContain("Todavía no la marcaste");
      expect(markup).not.toContain("Volver a pendiente");
    });

    test("is a normal pending sale on the payment day itself and after it", () => {
      for (const paidOn of ["2026-10-16", "2026-10-15"]) {
        const markup = render({ invoiceStatus: "pending", paidOn });

        expect(markup, paidOn).toContain("Todavía no la marcaste");
        expect(markup, paidOn).toContain('href="/admin/facturacion"');
        expect(markup, paidOn).not.toContain("La vas a poder facturar");
      }
    });

    test("only changes the text of pending invoices: an invoiced one keeps its data and button", () => {
      const markup = render({ ...ISSUED, paidOn: "2026-10-20" });

      expect(markup).toContain("Volver a pendiente");
      expect(markup).not.toContain("La vas a poder facturar");
    });
  });

  test("text written by hand in the number is escaped, not run", () => {
    const markup = render({ ...ISSUED, invoiceNumber: '<img src=x onerror="alert(1)">' });

    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img");
  });
});
