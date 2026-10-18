import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { buildBilling, type BillingData } from "@/admin/billing/billing-data";
import { BillingView } from "@/admin/billing/billing-view";
import { INITIAL_INVOICING_FORM_STATE } from "@/admin/billing/form-state";
import type { MonotributoSettings } from "@/admin/metrics/monotributo";
import { NOW } from "../helpers/metric-sales";
import { saleRow } from "../helpers/sale-rows";

const SETTINGS: MonotributoSettings = { category: "C", annualCapArsMinor: 1_000_000_000, validFrom: "2026-08-01" };

async function noop() {
  return INITIAL_INVOICING_FORM_STATE;
}

function build(rows: ReturnType<typeof saleRow>[]): BillingData {
  return buildBilling({ uninvoiced: { rows, truncated: false }, sales: [], settings: SETTINGS, now: NOW });
}

function render(data: BillingData): string {
  return renderToStaticMarkup(createElement(BillingView, { data, invoiceAction: noop }));
}

describe("the line for the phone in the list of sales to invoice", () => {
  /** La línea del celular de cada fila, sin etiquetas, y si se esconde de los lectores de pantalla. */
  function lines(markup: string): { text: string; hiddenFromReaders: boolean }[] {
    const pattern = new RegExp('<p (aria-hidden="true" )?data-testid="phone-summary"[^>]*>(.*?)</p>', "g");
    return [...markup.matchAll(pattern)].map(([, hidden, inner]) => ({
      text: inner.replace(/<[^>]+>/g, ""),
      hiddenFromReaders: hidden !== undefined,
    }));
  }

  test("each row says its service and what was charged, in the currency of the sale", () => {
    const markup = render(
      build([
        saleRow({ item: "gamePlan", currency: "USD", amountMinor: 12000 }),
        saleRow({ item: "lesson", currency: "BRL", amountMinor: 10000 }),
      ]),
    );

    expect(lines(markup).map((line) => line.text).sort()).toEqual([
      "Clase 1 a 1 · R$ 100,00",
      "Plan de juego personalizado · USD 120,00",
    ]);
  });

  test("screen readers do not read it: the columns already carry the same data", () => {
    const found = lines(render(build([saleRow(), saleRow()])));

    expect(found).toHaveLength(2);
    expect(found.every((line) => line.hiddenFromReaders)).toBe(true);
  });

  test("the student cell is narrow enough for the checkbox, the date and the student to fit on the phone", () => {
    const markup = render(build([saleRow()]));

    expect(markup).toContain("narrow:w-[8rem]");
  });
});
