import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { resolveSaleRates, type StoredRates } from "@/admin/sales/rates";
import { saleInputSchema } from "@/admin/sales/schema";
import type { Db } from "@/db/client";
import { createTestDb } from "../helpers/db";

type RawSale = Record<string, unknown>;

function input(overrides: RawSale = {}) {
  return saleInputSchema.parse({
    customer: { mode: "new", name: "Ana" },
    item: "lesson",
    currency: "USD",
    amount: "40",
    paymentMethod: "transfer",
    status: "paid",
    paidOn: "2026-10-12",
    rateMode: "auto",
    ...overrides,
  });
}

const STORED: StoredRates = {
  currency: "USD",
  paidOn: "2026-10-12",
  arsPerUnit: "1490.0000",
  arsPerUsd: "1490.0000",
  rateSource: "bcra",
  rateQuotedOn: "2026-10-09",
};

describe("resolveSaleRates", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("automatic", () => {
    test("asks the official source for the dollar on the payment day", async () => {
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");

      const result = await resolveSaleRates(db, input());

      expect(result).toEqual({
        ok: true,
        rates: {
          arsPerUnit: "1500.0000",
          arsPerUsd: "1500.0000",
          source: "fixed",
          quotedOn: "2026-10-12",
        },
      });
    });

    test("USDT is the dollar, and pesos are one peso per peso", async () => {
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");

      const usdt = await resolveSaleRates(db, input({ currency: "USDT" }));
      const ars = await resolveSaleRates(db, input({ currency: "ARS" }));

      expect(usdt).toMatchObject({ ok: true, rates: { arsPerUnit: "1500.0000", arsPerUsd: "1500.0000" } });
      expect(ars).toMatchObject({ ok: true, rates: { arsPerUnit: "1.0000", arsPerUsd: "1500.0000" } });
    });

    test("a real needs its own quote and the dollar's", async () => {
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");

      const result = await resolveSaleRates(db, input({ currency: "BRL" }));

      expect(result).toMatchObject({ ok: true, rates: { arsPerUnit: "280.0000", arsPerUsd: "1500.0000" } });
    });

    test("uses today when the sale has no payment date yet", async () => {
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");
      const pending = input({ status: "pending", paidOn: "" });

      const ok = await resolveSaleRates(db, pending, { today: "2026-10-14" });
      const tooOld = await resolveSaleRates(db, pending, { today: "2019-12-31" });

      expect(ok).toMatchObject({ ok: true, rates: { quotedOn: "2026-10-14" } });
      expect(tooOld).toEqual({ ok: false });
    });

    test("says it is unavailable when there is no quote, instead of guessing", async () => {
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");

      expect(await resolveSaleRates(db, input({ paidOn: "2019-12-31" }))).toEqual({ ok: false });
      expect(await resolveSaleRates(db, input({ currency: "BRL", paidOn: "2019-12-31" }))).toEqual({
        ok: false,
      });
    });

    test("an ARS sale still needs the dollar to know its value in USD", async () => {
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");

      expect(await resolveSaleRates(db, input({ currency: "ARS", paidOn: "2019-12-31" }))).toEqual({
        ok: false,
      });
    });
  });

  describe("manual", () => {
    test("takes the typed rates and never asks the source", async () => {
      // Sin la fuente fija la consulta iría al BCRA: falla si se la llama.
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const result = await resolveSaleRates(
        db,
        input({ paidOn: "2019-12-31", rateMode: "manual", arsPerUsd: "1.400,5" }),
      );

      expect(result).toEqual({
        ok: true,
        rates: { arsPerUnit: "1400.5000", arsPerUsd: "1400.5000", source: "manual", quotedOn: null },
      });
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    test("pesos are one per peso, and a real keeps its own rate", async () => {
      const ars = await resolveSaleRates(
        db,
        input({ currency: "ARS", rateMode: "manual", arsPerUsd: "1400" }),
      );
      const brl = await resolveSaleRates(
        db,
        input({ currency: "BRL", rateMode: "manual", arsPerUnit: "250", arsPerUsd: "1400" }),
      );

      expect(ars).toMatchObject({ ok: true, rates: { arsPerUnit: "1.0000", arsPerUsd: "1400.0000" } });
      expect(brl).toMatchObject({ ok: true, rates: { arsPerUnit: "250.0000", arsPerUsd: "1400.0000" } });
    });
  });

  describe("editing", () => {
    test("keeps the saved rates when the currency and the payment day did not change", async () => {
      // Con la fuente fija y una fecha vieja sería "no disponible": si da ok, reutilizó lo guardado.
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");
      const stored = { ...STORED, paidOn: "2019-12-31" };

      const result = await resolveSaleRates(db, input({ paidOn: "2019-12-31", status: "delivered" }), {
        previous: stored,
      });

      expect(result).toEqual({
        ok: true,
        rates: {
          arsPerUnit: "1490.0000",
          arsPerUsd: "1490.0000",
          source: "bcra",
          quotedOn: "2026-10-09",
        },
      });
    });

    test("asks again when the currency or the payment day changed", async () => {
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");

      const otherDay = await resolveSaleRates(db, input({ paidOn: "2026-10-13" }), { previous: STORED });
      const otherCurrency = await resolveSaleRates(db, input({ currency: "ARS" }), { previous: STORED });

      expect(otherDay).toMatchObject({ ok: true, rates: { arsPerUsd: "1500.0000", source: "fixed" } });
      expect(otherCurrency).toMatchObject({ ok: true, rates: { arsPerUnit: "1.0000" } });
    });

    test("a saved manual rate is not kept when the user asks for the automatic one", async () => {
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");
      const manual = { ...STORED, rateSource: "manual", rateQuotedOn: null } as const;

      const result = await resolveSaleRates(db, input(), { previous: manual });

      expect(result).toMatchObject({ ok: true, rates: { arsPerUsd: "1500.0000", source: "fixed" } });
    });

    test("typed manual rates replace the saved ones", async () => {
      const result = await resolveSaleRates(db, input({ rateMode: "manual", arsPerUsd: "1600" }), {
        previous: STORED,
      });

      expect(result).toMatchObject({ ok: true, rates: { arsPerUsd: "1600.0000", source: "manual" } });
    });
  });
});
