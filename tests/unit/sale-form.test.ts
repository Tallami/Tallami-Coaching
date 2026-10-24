import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { emptySaleFormValues } from "@/admin/sales/form-values";
import { SaleForm } from "@/admin/sales/sale-form";

const INVOICED_NOTICE =
  "Esta venta ya tiene factura; si cambiás el monto, la moneda o la fecha, revisá la factura.";

async function noop() {
  return { fieldErrors: {}, needsManualRate: false };
}

function render(props: { mode?: "create" | "edit"; invoiced?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(SaleForm, {
      mode: props.mode ?? "edit",
      draftKey: "venta:v1",
      action: noop,
      initialValues: emptySaleFormValues("2026-10-16", true),
      priceListUsd: {},
      ...(props.invoiced === undefined ? {} : { invoiced: props.invoiced }),
    }),
  );
}

describe("SaleForm", () => {
  test("warns, at the top of the form, that an invoiced sale has an invoice to review", () => {
    const markup = render({ invoiced: true });

    expect(markup).toContain(INVOICED_NOTICE);
    // Es un aviso (rol de estado), no un error, y va antes de los campos.
    expect(markup).toMatch(/role="status"[^>]*>[^<]*Esta venta ya tiene factura/);
    expect(markup.indexOf(INVOICED_NOTICE)).toBeLessThan(markup.indexOf("Alumno"));
  });

  test("says nothing about an invoice when the sale has none, and in a new sale", () => {
    expect(render({ invoiced: false })).not.toContain("ya tiene factura");
    expect(render({})).not.toContain("ya tiene factura");
    expect(render({ mode: "create" })).not.toContain("ya tiene factura");
  });

  test("keeps the rest of the form as it was", () => {
    const markup = render({ invoiced: true });

    for (const label of ["Alumno", "Servicio", "Monto", "Moneda", "Fecha de cobro", "Guardar cambios"]) {
      expect(markup, label).toContain(label);
    }
  });
});
