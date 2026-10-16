import { describe, expect, test } from "vitest";
import {
  invoiceUndoNotice,
  invoiceUndoPath,
  invoicingNotice,
  invoicingResultPath,
} from "@/admin/billing/saved-notice";

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

describe("invoiceUndoNotice", () => {
  test("says that the sale is pending again, and that it could not be done", () => {
    expect(invoiceUndoNotice({ factura: "pendiente" })).toEqual({
      tone: "ok",
      text: expect.stringContaining("volvió a pendiente"),
    });
    expect(invoiceUndoNotice({ factura: "no-se-pudo" })).toEqual({
      tone: "error",
      text: expect.stringContaining("no tenía factura"),
    });
  });

  test.each([
    [{}],
    [{ factura: "otra-cosa" }],
    [{ factura: "__proto__" }],
    [{ factura: "constructor" }],
    [{ factura: "toString" }],
    [{ factura: "hasOwnProperty" }],
    [{ factura: "" }],
    [{ factura: undefined }],
  ])("shows nothing for %j", (params) => {
    expect(invoiceUndoNotice(params)).toBeNull();
  });

  test("the first value wins when the parameter repeats", () => {
    expect(invoiceUndoNotice({ factura: ["pendiente", "no-se-pudo"] })?.tone).toBe("ok");
    expect(invoiceUndoNotice({ factura: ["nada", "pendiente"] })).toBeNull();
  });
});

describe("invoiceUndoPath", () => {
  const ID = "8f4f3f64-7c5c-4a43-9d4c-3f6a3a2f1b10";

  test("goes back to the sale with what happened", () => {
    expect(invoiceUndoPath(ID, "done")).toBe(`/admin/ventas/${ID}?factura=pendiente`);
    expect(invoiceUndoPath(ID, "refused")).toBe(`/admin/ventas/${ID}?factura=no-se-pudo`);
  });

  test("what it writes is what the notice reads", () => {
    for (const outcome of ["done", "refused"] as const) {
      const query = new URLSearchParams(invoiceUndoPath(ID, outcome).split("?")[1]);

      expect(invoiceUndoNotice(Object.fromEntries(query))).not.toBeNull();
    }
  });
});
