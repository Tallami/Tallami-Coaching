import { describe, expect, test } from "vitest";
import { invoicingNotice, invoicingResultPath } from "@/admin/billing/saved-notice";

describe("invoicingNotice", () => {
  test.each([
    [{ guardada: "facturadas", cantidad: "1" }, "1 venta marcada como facturada."],
    [{ guardada: "facturadas", cantidad: "2" }, "2 ventas marcadas como facturadas."],
    [{ guardada: "sin-factura", cantidad: "1" }, "1 venta marcada como «No requiere factura»."],
    [{ guardada: "sin-factura", cantidad: "12" }, "12 ventas marcadas como «No requiere factura»."],
  ])("writes the notice for %j", (params, expected) => {
    expect(invoicingNotice(params)).toBe(expected);
  });

  test("without a usable count it still says what happened", () => {
    expect(invoicingNotice({ guardada: "facturadas" })).toBe("Ventas marcadas como facturadas.");
    expect(invoicingNotice({ guardada: "facturadas", cantidad: "0" })).toBe("Ventas marcadas como facturadas.");
    expect(invoicingNotice({ guardada: "sin-factura", cantidad: "<b>9</b>" })).toBe(
      "Ventas marcadas como «No requiere factura».",
    );
    expect(invoicingNotice({ guardada: "facturadas", cantidad: "99999" })).toBe("Ventas marcadas como facturadas.");
  });

  test.each([
    [{}],
    [{ guardada: "nada" }],
    [{ guardada: "__proto__" }],
    [{ guardada: "constructor", cantidad: "3" }],
    [{ guardada: ["x", "facturadas"] }],
    [{ guardada: undefined, cantidad: "3" }],
  ])("shows nothing for %j", (params) => {
    expect(invoicingNotice(params)).toBeNull();
  });

  test("the first value wins when a parameter repeats", () => {
    expect(invoicingNotice({ guardada: ["facturadas", "sin-factura"], cantidad: ["2", "9"] })).toBe(
      "2 ventas marcadas como facturadas.",
    );
  });
});

describe("invoicingResultPath", () => {
  test("goes back to the billing screen with what to say", () => {
    expect(invoicingResultPath("invoiced", 2)).toBe("/admin/facturacion?guardada=facturadas&cantidad=2");
    expect(invoicingResultPath("not_required", 1)).toBe("/admin/facturacion?guardada=sin-factura&cantidad=1");
  });

  test("what it writes is what the notice reads", () => {
    const query = new URLSearchParams(invoicingResultPath("invoiced", 3).split("?")[1]);

    expect(invoicingNotice(Object.fromEntries(query))).toBe("3 ventas marcadas como facturadas.");
  });
});
