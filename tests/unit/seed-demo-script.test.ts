import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { INTEREST_ITEMS } from "@/admin/catalog";
import { dateToArgentinaLocal } from "@/admin/dates";
import { DEMO_MONOTRIBUTO_SETTINGS, buildDemoData } from "@/admin/demo-data";
import { interestByItem } from "@/admin/interest/query";
import { computeKpis } from "@/admin/metrics/kpis";
import { loadMetricSales } from "@/admin/metrics/load";
import { monotributoStatus } from "@/admin/metrics/monotributo";
import { pendingWork } from "@/admin/metrics/pending";
import { PERIODS, periodRange } from "@/admin/metrics/period";
import { incomeByCountry, incomeByItem, incomeByPaymentMethod, itemsWithoutSales, monthlyIncome } from "@/admin/metrics/series";
import { getMonotributoSettings } from "@/admin/settings/read";
import { customers, interestEvents, sales, settings } from "@/db/schema";
import { DemoSeedRefusedError, assertLocalDatabase, seedDemo } from "../../scripts/seed-demo";
import { createTestDb } from "../helpers/db";
import { demoMetricSales } from "../helpers/demo";

const SCRIPT = fileURLToPath(new URL("../../scripts/seed-demo.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url));
const TODAY = "2026-10-14";
/** Las 15:00 de Argentina de ese día. */
const NOW = new Date(`${TODAY}T18:00:00.000Z`);

describe("assertLocalDatabase", () => {
  test("refuses to run when DATABASE_URL is set", () => {
    expect(() => assertLocalDatabase({ DATABASE_URL: "postgres://user:clave@db.example.com:6543/postgres" })).toThrow(
      DemoSeedRefusedError,
    );
    expect(() => assertLocalDatabase({ DATABASE_URL: "  postgres://x  " })).toThrow(DemoSeedRefusedError);
  });

  test("allows a local database: no DATABASE_URL, or an empty one", () => {
    expect(() => assertLocalDatabase({})).not.toThrow();
    expect(() => assertLocalDatabase({ DATABASE_URL: "" })).not.toThrow();
    expect(() => assertLocalDatabase({ DATABASE_URL: "   " })).not.toThrow();
  });

  test("the script itself exits with an error before touching any database", () => {
    const result = spawnSync(process.execPath, [TSX, SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "postgres://user:clave@127.0.0.1:1/none" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stdout).toBe("");
  });
});

describe("seedDemo", () => {
  test("inserts the students, the sales and the monotributo setting", async () => {
    const db = await createTestDb();
    const expected = buildDemoData(TODAY);

    const inserted = await seedDemo(db, TODAY);

    expect(inserted).toEqual({
      customers: expected.customers.length,
      sales: expected.sales.length,
      interest: expected.interest.length,
    });
    expect(await db.select().from(customers)).toHaveLength(expected.customers.length);
    expect(await db.select().from(sales)).toHaveLength(expected.sales.length);
    expect(await db.select().from(interestEvents)).toHaveLength(expected.interest.length);
    expect(await getMonotributoSettings(db)).toEqual(DEMO_MONOTRIBUTO_SETTINGS);
  });

  test("running it again refreshes the demo rows instead of duplicating them", async () => {
    const db = await createTestDb();
    await seedDemo(db, TODAY);
    await seedDemo(db, "2026-10-20");

    const expected = buildDemoData("2026-10-20");
    expect(await db.select().from(customers)).toHaveLength(expected.customers.length);
    expect(await db.select().from(sales)).toHaveLength(expected.sales.length);
    expect(await db.select().from(interestEvents)).toHaveLength(expected.interest.length);
  });

  test("leaves what the owner loaded by hand, and a monotributo setting already there", async () => {
    const db = await createTestDb();
    const [mine] = await db.insert(customers).values({ name: "Una alumna real" }).returning({ id: customers.id });
    await db.insert(settings).values({
      key: "monotributo",
      value: { category: "A", annualCapArsMinor: 1_000_000_000, validFrom: "2026-02-01" },
    });

    const [realClick] = await db
      .insert(interestEvents)
      .values({ item: "lesson", locale: "es", ipHash: "hash-real" })
      .returning({ id: interestEvents.id });

    await seedDemo(db, TODAY);
    await seedDemo(db, TODAY);

    expect(await db.select().from(customers).where(eq(customers.id, mine.id))).toHaveLength(1);
    expect((await getMonotributoSettings(db))?.category).toBe("A");
    expect(await db.select().from(interestEvents).where(eq(interestEvents.id, realClick.id))).toHaveLength(1);
  });

  test("the panel reads the same numbers from the database as from the demo data", async () => {
    const db = await createTestDb();
    await seedDemo(db, TODAY);
    const loaded = await loadMetricSales(db, NOW);
    const expected = demoMetricSales(buildDemoData(TODAY));

    for (const period of PERIODS) {
      const range = periodRange(period, NOW);
      expect(computeKpis(loaded, period, NOW), period).toEqual(computeKpis(expected, period, NOW));
      expect(incomeByItem(loaded, range), period).toEqual(incomeByItem(expected, range));
      expect(incomeByPaymentMethod(loaded, range), period).toEqual(incomeByPaymentMethod(expected, range));
      expect(incomeByCountry(loaded, range), period).toEqual(incomeByCountry(expected, range));
    }
    expect(monthlyIncome(loaded, 12, NOW)).toEqual(monthlyIncome(expected, 12, NOW));
    expect(itemsWithoutSales(loaded, 90, NOW)).toEqual(itemsWithoutSales(expected, 90, NOW));
    expect(monotributoStatus(loaded, DEMO_MONOTRIBUTO_SETTINGS, NOW)).toEqual(
      monotributoStatus(expected, DEMO_MONOTRIBUTO_SETTINGS, NOW),
    );
    expect(pendingWork(loaded, NOW)).toEqual(pendingWork(expected, NOW));
  });

  test("the clicks read from the database match the demo events, period by period", async () => {
    const db = await createTestDb();
    await seedDemo(db, TODAY);
    const { interest } = buildDemoData(TODAY);

    for (const period of PERIODS) {
      const range = periodRange(period, NOW);
      const expected = INTEREST_ITEMS.map((item) => ({
        item,
        clicks: interest.filter((event) => {
          const day = dateToArgentinaLocal(event.createdAt as Date).slice(0, 10);
          return event.item === item && day >= range.from && day <= range.to;
        }).length,
      }));

      expect(await interestByItem(db, range), period).toEqual(expected);
    }
  });
});
