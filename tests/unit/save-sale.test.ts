import { count } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { createCustomer } from "@/admin/customers/repository";
import { RATE_UNAVAILABLE_MESSAGE } from "@/admin/sales/form-state";
import { getSale, listSales } from "@/admin/sales/repository";
import { saveSale } from "@/admin/sales/save-sale";
import type { Db } from "@/db/client";
import { customers, sales } from "@/db/schema";
import { createTestDb } from "../helpers/db";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

/** Un formulario de venta de un alumno nuevo, como llega del navegador. */
function form(overrides: Record<string, string | undefined> = {}): FormData {
  const fields: Record<string, string | undefined> = {
    customerMode: "new",
    customerName: "Ana",
    item: "lesson",
    currency: "USD",
    amount: "40",
    paymentMethod: "transfer",
    status: "paid",
    paidOn: "2026-10-12",
    rateMode: "auto",
    ...overrides,
  };
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) data.set(name, value);
  }
  return data;
}

async function totals(db: Db): Promise<{ sales: number; customers: number }> {
  const [saleRow] = await db.select({ total: count() }).from(sales);
  const [customerRow] = await db.select({ total: count() }).from(customers);
  return { sales: saleRow.total, customers: customerRow.total };
}

describe("saveSale", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("saves a valid sale with the official rate", async () => {
    vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");

    const outcome = await saveSale(db, form());

    expect(outcome.saved).toBe(true);
    if (!outcome.saved) return;
    expect(await getSale(db, outcome.id)).toMatchObject({
      customerName: "Ana",
      amountMinor: 4000,
      amountArsMinor: 6_000_000,
      amountUsdMinor: 4000,
      rateSource: "fixed",
    });
  });

  test("returns the field errors and saves nothing for invalid input", async () => {
    const before = await totals(db);

    const outcome = await saveSale(db, form({ amount: "abc", item: "other", customerName: " " }));

    expect(outcome.saved).toBe(false);
    if (outcome.saved) return;
    expect(Object.keys(outcome.state.fieldErrors).sort()).toEqual(["amount", "customerName", "description"]);
    expect(outcome.state.formError).toBe("Revisá los campos marcados.");
    expect(outcome.state.needsManualRate).toBe(false);
    expect(await totals(db)).toEqual(before);
  });

  test("asks for the rate by hand when there is no official one, and saves nothing yet", async () => {
    vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");
    const before = await totals(db);

    const outcome = await saveSale(db, form({ paidOn: "2019-12-31", customerName: "Sin dólar" }));

    expect(outcome.saved).toBe(false);
    if (outcome.saved) return;
    expect(outcome.state.needsManualRate).toBe(true);
    expect(outcome.state.fieldErrors).toEqual({ rateMode: RATE_UNAVAILABLE_MESSAGE });
    expect(RATE_UNAVAILABLE_MESSAGE).toBe("No pudimos traer el dólar oficial; cargalo a mano.");
    // Ni la venta ni el alumno nuevo quedaron a medias.
    expect(await totals(db)).toEqual(before);
  });

  test("with the rate typed by hand, the same sale is saved", async () => {
    vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");

    const outcome = await saveSale(
      db,
      form({ paidOn: "2019-12-31", customerName: "Con dólar a mano", rateMode: "manual", arsPerUsd: "1400,5" }),
    );

    expect(outcome.saved).toBe(true);
    if (!outcome.saved) return;
    expect(await getSale(db, outcome.id)).toMatchObject({
      rateSource: "manual",
      rateQuotedOn: null,
      arsPerUsd: "1400.5000",
      amountArsMinor: 5_602_000,
    });
  });

  test("an unknown student is a field error, not a crash", async () => {
    const before = await totals(db);

    const outcome = await saveSale(db, form({ customerMode: "existing", customerId: UNKNOWN_ID }));

    expect(outcome.saved).toBe(false);
    if (outcome.saved) return;
    expect(outcome.state.fieldErrors.customerId).toMatch(/ya no existe/);
    expect(await totals(db)).toEqual(before);
  });

  describe("editing", () => {
    test("changes the sale and keeps the saved rate when the currency and the day did not change", async () => {
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");
      const created = await saveSale(db, form({ customerName: "Para editar", paidOn: "2019-12-31", rateMode: "manual", arsPerUsd: "1400" }));
      if (!created.saved) throw new Error("La venta debía guardarse");

      // Automático sobre una cotización a mano guardada: se pide la oficial, y para 2019 no hay.
      const refused = await saveSale(
        db,
        form({ customerMode: "existing", customerId: (await getSale(db, created.id))!.customerId, paidOn: "2019-12-31", status: "delivered" }),
        created.id,
      );
      expect(refused.saved).toBe(false);

      // Con la cotización a mano otra vez, cambia el estado y la cotización se queda.
      const edited = await saveSale(
        db,
        form({
          customerMode: "existing",
          customerId: (await getSale(db, created.id))!.customerId,
          paidOn: "2019-12-31",
          status: "delivered",
          rateMode: "manual",
          arsPerUsd: "1400",
        }),
        created.id,
      );

      expect(edited).toEqual({ saved: true, id: created.id });
      expect(await getSale(db, created.id)).toMatchObject({ status: "delivered", arsPerUsd: "1400.0000", rateSource: "manual" });
    });

    test("an official rate already saved is not asked again", async () => {
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");
      const created = await saveSale(db, form({ customerName: "Cotización oficial" }));
      if (!created.saved) throw new Error("La venta debía guardarse");
      const { customerId } = (await getSale(db, created.id))!;

      // Sin fuente fija el pedido iría al BCRA: si la cotización guardada se reutiliza, no hay pedido.
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const edited = await saveSale(
        db,
        form({ customerMode: "existing", customerId, status: "delivered" }),
        created.id,
      );
      vi.unstubAllGlobals();

      expect(edited.saved).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test("an unknown sale is a form error and creates nothing", async () => {
      const before = await totals(db);

      const outcome = await saveSale(db, form({ customerName: "Fantasma" }), UNKNOWN_ID);

      expect(outcome.saved).toBe(false);
      if (outcome.saved) return;
      expect(outcome.state.formError).toBe("No encontramos esa venta.");
      expect(await totals(db)).toEqual(before);
    });

    test("a student picked from the search keeps its sales together", async () => {
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");
      const { id: customerId } = await createCustomer(db, { name: "Recurrente" });

      await saveSale(db, form({ customerMode: "existing", customerId }));
      await saveSale(db, form({ customerMode: "existing", customerId, item: "gamePlan", amount: "120" }));

      const { rows } = await listSales(db, { q: "Recurrente" }, 1);
      expect(rows).toHaveLength(2);
    });
  });
});
