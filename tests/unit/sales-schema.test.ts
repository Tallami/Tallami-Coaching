import { describe, expect, test } from "vitest";
import { saleFieldErrors, saleInputSchema } from "@/admin/sales/schema";

type RawSale = Record<string, unknown>;

const CUSTOMER_ID = "8f4f3f64-7c5c-4a43-9d4c-3f6a3a2f1b10";

/** Una venta válida tal como llega del formulario; cada test cambia solo lo que prueba. */
function raw(overrides: RawSale = {}): RawSale {
  return {
    customer: { mode: "new", name: "Ana Pérez" },
    item: "lesson",
    currency: "USD",
    amount: "40",
    paymentMethod: "transfer",
    status: "paid",
    paidOn: "2026-10-12",
    rateMode: "auto",
    ...overrides,
  };
}

function errorsOf(input: RawSale): Record<string, string> {
  const result = saleInputSchema.safeParse(input);
  if (result.success) throw new Error("La venta debía ser inválida");
  return saleFieldErrors(result.error);
}

describe("saleInputSchema", () => {
  test("turns a form sale into typed input with minor-unit amounts", () => {
    const result = saleInputSchema.parse(raw({ amount: "1.234,56", notes: "  pagó por MP  " }));

    expect(result).toEqual({
      customer: { mode: "new", name: "Ana Pérez" },
      item: "lesson",
      currency: "USD",
      amountMinor: 123456,
      paymentMethod: "transfer",
      status: "paid",
      paidOn: "2026-10-12",
      rateMode: "auto",
      notes: "pagó por MP",
    });
  });

  test("an existing student is picked by id", () => {
    const result = saleInputSchema.parse(raw({ customer: { mode: "existing", id: CUSTOMER_ID } }));

    expect(result.customer).toEqual({ mode: "existing", id: CUSTOMER_ID });
    expect(errorsOf(raw({ customer: { mode: "existing", id: "ana" } }))).toEqual({
      customerId: "Elegí un alumno de la lista.",
    });
    expect(errorsOf(raw({ customer: { mode: "existing" } }))).toEqual({
      customerId: "Elegí un alumno de la lista.",
    });
  });

  test("a new student needs a name and trims every field", () => {
    const result = saleInputSchema.parse(
      raw({ customer: { mode: "new", name: "  Ana  ", discord: " ana#1 ", country: "" } }),
    );
    expect(result.customer).toEqual({ mode: "new", name: "Ana", discord: "ana#1" });

    expect(errorsOf(raw({ customer: { mode: "new", name: "   " } }))).toEqual({
      customerName: "Escribí el nombre del alumno.",
    });
  });

  test("trims and uppercases the country, and wants two letters", () => {
    const parsed = saleInputSchema.parse(
      raw({ customer: { mode: "new", name: "Ana", country: " ar " } }),
    );
    expect(parsed.customer).toMatchObject({ country: "AR" });

    for (const country of ["ARG", "A", "A1", "ñn"]) {
      expect(errorsOf(raw({ customer: { mode: "new", name: "Ana", country } }))).toEqual({
        customerCountry: "El país va con 2 letras, como AR, BR o MX.",
      });
    }
  });

  test("rejects an amount that is not a valid number with the parser's message", () => {
    expect(errorsOf(raw({ amount: "abc" })).amount).toMatch(/monto no es válido/);
    expect(errorsOf(raw({ amount: "" })).amount).toBe("Ingresá un monto.");
    expect(errorsOf(raw({ amount: "0" })).amount).toMatch(/mayor a cero/);
    expect(errorsOf(raw({ amount: "1.234" })).amount).toMatch(/ambiguo/);
  });

  test("caps the amount so every conversion stays a safe integer", () => {
    expect(saleInputSchema.parse(raw({ amount: "100000000" })).amountMinor).toBe(10_000_000_000);

    expect(errorsOf(raw({ amount: "100000000,01" })).amount).toMatch(/demasiado grande/);
    expect(errorsOf(raw({ amount: "99999999999999999999" })).amount).toMatch(/demasiado grande/);
  });

  test("'Otro' needs a description, and other items do not", () => {
    expect(errorsOf(raw({ item: "other" })).description).toBe(
      "Contanos qué se vendió: la descripción es obligatoria para «Otro».",
    );
    expect(errorsOf(raw({ item: "other", description: "   " })).description).toMatch(/obligatoria/);

    const withDescription = saleInputSchema.parse(raw({ item: "other", description: " Revisión extra " }));
    expect(withDescription.description).toBe("Revisión extra");
    expect(saleInputSchema.parse(raw({ item: "gamePlan" })).description).toBeUndefined();
  });

  test("reports every problem at once instead of one at a time", () => {
    const errors = errorsOf(raw({ amount: "abc", item: "other", paidOn: undefined }));

    expect(Object.keys(errors).sort()).toEqual(["amount", "description", "paidOn"]);
  });

  test("lists, items and statuses outside the catalog are rejected", () => {
    expect(errorsOf(raw({ item: "cars" })).item).toBe("Elegí qué se vendió.");
    expect(errorsOf(raw({ currency: "EUR" })).currency).toBe("Elegí la moneda.");
    expect(errorsOf(raw({ paymentMethod: "bitcoin" })).paymentMethod).toBe("Elegí el medio de pago.");
    expect(errorsOf(raw({ status: "lost" })).status).toBe("Elegí el estado de la venta.");
    expect(errorsOf(raw({ item: undefined })).item).toBe("Elegí qué se vendió.");
  });

  test("a collected, delivered or refunded sale needs its payment date", () => {
    for (const status of ["paid", "delivered", "refunded"]) {
      expect(errorsOf(raw({ status, paidOn: "" })).paidOn).toBe("Cargá la fecha de cobro.");
    }
    for (const status of ["pending", "cancelled"]) {
      expect(saleInputSchema.parse(raw({ status, paidOn: "" })).paidOn).toBeUndefined();
    }
  });

  test("dates must be real calendar days in a sane range", () => {
    expect(saleInputSchema.parse(raw({ paidOn: "2019-12-31" })).paidOn).toBe("2019-12-31");
    for (const paidOn of ["2026-02-30", "12/10/2026", "2026-13-01", "1999-12-31", "2101-01-01"]) {
      expect(errorsOf(raw({ paidOn })).paidOn).toBe("La fecha no es válida.");
    }
  });

  test("reads the due and delivery times as Argentine time", () => {
    const result = saleInputSchema.parse(
      raw({ dueAt: "2026-10-20T15:00", deliveredAt: "2026-10-21T09:30" }),
    );

    expect(result.dueAt?.toISOString()).toBe("2026-10-20T18:00:00.000Z");
    expect(result.deliveredAt?.toISOString()).toBe("2026-10-21T12:30:00.000Z");
    expect(saleInputSchema.parse(raw({ dueAt: "" })).dueAt).toBeUndefined();
    expect(errorsOf(raw({ dueAt: "mañana" })).dueAt).toBe("La fecha y hora no son válidas.");
    expect(errorsOf(raw({ deliveredAt: "2026-10-21" })).deliveredAt).toBe(
      "La fecha y hora no son válidas.",
    );
  });

  test("keeps notes short", () => {
    expect(errorsOf(raw({ notes: "x".repeat(2001) })).notes).toBe(
      "Las notas son demasiado largas (máximo 2000 caracteres).",
    );
  });

  test("the rate mode defaults to automatic and ignores typed rates then", () => {
    const result = saleInputSchema.parse(raw({ rateMode: undefined, arsPerUsd: "1400" }));

    expect(result.rateMode).toBe("auto");
    expect(result.arsPerUsd).toBeUndefined();
    expect(result.arsPerUnit).toBeUndefined();
    expect(errorsOf(raw({ rateMode: "magic" })).rateMode).toBe("Elegí cómo cargar el tipo de cambio.");
  });

  describe("manual exchange rate", () => {
    test("USD and USDT need the pesos per dollar, only", () => {
      for (const currency of ["USD", "USDT"]) {
        expect(errorsOf(raw({ currency, rateMode: "manual" }))).toEqual({
          arsPerUsd: "Cargá los pesos por dólar.",
        });
      }

      const result = saleInputSchema.parse(
        raw({ rateMode: "manual", arsPerUsd: "1.512,5", arsPerUnit: "99" }),
      );
      expect(result.arsPerUsd).toBe("1512.5000");
      // Para el dólar los pesos por unidad son los mismos: el campo sobrante se descarta.
      expect(result.arsPerUnit).toBeUndefined();
    });

    test("ARS needs the pesos per dollar, only", () => {
      expect(errorsOf(raw({ currency: "ARS", rateMode: "manual" }))).toEqual({
        arsPerUsd: "Cargá los pesos por dólar.",
      });
    });

    test("BRL needs the pesos per real and per dollar", () => {
      expect(errorsOf(raw({ currency: "BRL", rateMode: "manual" }))).toEqual({
        arsPerUnit: "Cargá los pesos por real.",
        arsPerUsd: "Cargá los pesos por dólar.",
      });

      const result = saleInputSchema.parse(
        raw({ currency: "BRL", rateMode: "manual", arsPerUnit: "280,5", arsPerUsd: "1500" }),
      );
      expect(result.arsPerUnit).toBe("280.5000");
      expect(result.arsPerUsd).toBe("1500.0000");
    });

    test("explains a rate that is not a number", () => {
      expect(errorsOf(raw({ rateMode: "manual", arsPerUsd: "mucho" })).arsPerUsd).toMatch(
        /tipo de cambio no es válido/i,
      );
    });
  });
});

describe("saleFieldErrors", () => {
  test("keeps the first message of each field under the form's field names", () => {
    const result = saleInputSchema.safeParse(
      raw({ customer: { mode: "new", name: "", country: "ARG" }, amount: "" }),
    );
    if (result.success) throw new Error("La venta debía ser inválida");

    expect(saleFieldErrors(result.error)).toEqual({
      customerName: "Escribí el nombre del alumno.",
      customerCountry: "El país va con 2 letras, como AR, BR o MX.",
      amount: "Ingresá un monto.",
    });
  });
});

describe("saleInputSchema with several lists left empty", () => {
  test("still tells about the rules that look at two fields", () => {
    const errors = errorsOf(
      raw({
        item: "other",
        paymentMethod: "",
        status: "paid",
        paidOn: "",
        rateMode: "manual",
        currency: "BRL",
      }),
    );

    expect(Object.keys(errors).sort()).toEqual([
      "arsPerUnit",
      "arsPerUsd",
      "description",
      "paidOn",
      "paymentMethod",
    ]);
  });
});
