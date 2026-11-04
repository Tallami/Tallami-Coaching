import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { formatArs } from "@/lib/format";
import { settings } from "@/db/schema";
import {
  PESOS_PER_DOLLAR_SETTING_KEY,
  getPesosPerDollar,
  pesosForUsd,
  savePesosPerDollar,
} from "@/payments/pricing";
import { PricePair } from "@/components/home/price-pair";
import { createTestDb } from "../helpers/db";

describe("pesosForUsd", () => {
  test("multiplies dollars by the rate, in cents of pesos", () => {
    expect(pesosForUsd(3000, "1500.0000")).toBe(4_500_000);
    expect(pesosForUsd(250000, "1500.0000")).toBe(375_000_000);
  });

  test("rounds to a whole peso, never to a nicer number", () => {
    // 30 x 1234,56 = 37.036,80 -> 37.037 pesos
    expect(pesosForUsd(3000, "1234.5600")).toBe(3_703_700);
  });
});

describe("formatArs", () => {
  test("groups with dots in es and pt, with commas in en", () => {
    expect(formatArs(4_500_000, "es")).toBe("ARS 45.000");
    expect(formatArs(375_000_000, "es")).toBe("ARS 3.750.000");
    expect(formatArs(4_500_000, "pt")).toBe("ARS 45.000");
    expect(formatArs(4_500_000, "en")).toBe("ARS 45,000");
  });
});

describe("savePesosPerDollar and getPesosPerDollar", () => {
  test("saves what was typed in Argentine format and reads it back", async () => {
    const db = await createTestDb();

    const result = await savePesosPerDollar(db, "1.500,50");

    expect(result).toEqual({ saved: true, rate: "1500.5000" });
    const read = await getPesosPerDollar(db);
    expect(read?.rate).toBe("1500.5000");
    expect(read?.updatedAt).toBeInstanceOf(Date);
  });

  test.each(["0", "abc", ""])("refuses %j and writes nothing", async (input) => {
    const db = await createTestDb();

    const result = await savePesosPerDollar(db, input);

    expect(result.saved).toBe(false);
    if (!result.saved) expect(result.error).not.toBe("");
    expect(await getPesosPerDollar(db)).toBeNull();
  });

  test("saving again replaces the value and moves updatedAt", async () => {
    const db = await createTestDb();
    await savePesosPerDollar(db, "1500");
    const first = await getPesosPerDollar(db);
    await new Promise((resolve) => setTimeout(resolve, 10));

    await savePesosPerDollar(db, "1600");

    const second = await getPesosPerDollar(db);
    expect(second?.rate).toBe("1600.0000");
    expect(second!.updatedAt.getTime()).toBeGreaterThan(first!.updatedAt.getTime());
  });

  test.each([[{ rate: 1500 }], [{ rate: "0.0000" }], [{ rate: "abc" }], ["1500.0000"], [-5], [[]]])(
    "reads a stored value of another shape (%j) as null",
    async (value) => {
      const db = await createTestDb();
      await db.insert(settings).values({ key: PESOS_PER_DOLLAR_SETTING_KEY, value });

      expect(await getPesosPerDollar(db)).toBeNull();
    },
  );
});

describe("PricePair", () => {
  test("shows dollars and pesos when there is a rate", () => {
    const html = renderToStaticMarkup(
      createElement(PricePair, { priceUsd: 30, rate: "1500.0000", locale: "es", className: "a" }),
    );

    expect(html).toContain('data-testid="price"');
    expect(html).toContain("USD 30");
    expect(html).toContain('data-testid="price-ars"');
    expect(html).toContain("ARS 45.000");
  });

  test("shows only dollars when there is no rate", () => {
    const html = renderToStaticMarkup(
      createElement(PricePair, { priceUsd: 30, rate: null, locale: "es", className: "a" }),
    );

    expect(html).toContain("USD 30");
    expect(html).not.toContain("price-ars");
    expect(html).not.toContain("ARS");
  });
});
