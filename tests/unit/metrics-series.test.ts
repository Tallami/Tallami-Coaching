import { describe, expect, test } from "vitest";
import { SALE_ITEMS } from "@/admin/catalog";
import {
  NO_COUNTRY_LABEL,
  incomeByCountry,
  incomeByItem,
  incomeByPaymentMethod,
  itemsWithoutSales,
  monthlyIncome,
} from "@/admin/metrics/series";
import { NOW, THIS_MONTH, sale } from "../helpers/metric-sales";

describe("monthly series", () => {
  test("monthly series has 12 months including empty ones", () => {
    const sales = [
      sale({ paidOn: "2025-11-30", dollars: 10 }),
      sale({ paidOn: "2026-03-15", dollars: 20 }),
      sale({ paidOn: "2026-03-02", dollars: 5 }),
      sale({ paidOn: "2026-10-13", dollars: 40 }),
      sale({ paidOn: "2025-10-31", dollars: 999 }), // hace 13 meses: afuera
      sale({ paidOn: "2026-11-01", dollars: 999 }), // el mes que viene: afuera
      sale({ paidOn: "2026-10-14", dollars: 999 }), // mañana: no cuenta hasta ese día
    ];

    const series = monthlyIncome(sales, 12, NOW);

    expect(series).toHaveLength(12);
    expect(series.map((month) => month.month)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(series[0]).toEqual({ month: "2025-11", usdMinor: 1000, arsMinor: 1_500_000 });
    expect(series[4]).toEqual({ month: "2026-03", usdMinor: 2500, arsMinor: 3_750_000 });
    expect(series[11]).toEqual({ month: "2026-10", usdMinor: 4000, arsMinor: 6_000_000 });
    expect(series[1]).toEqual({ month: "2025-12", usdMinor: 0, arsMinor: 0 });
  });

  test("any number of months, oldest first, ending in the current one", () => {
    expect(monthlyIncome([], 3, NOW).map((month) => month.month)).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
    expect(monthlyIncome([], 6, new Date("2026-02-10T15:00:00.000Z")).map((m) => m.month)).toEqual([
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(monthlyIncome([], 0, NOW)).toEqual([]);
  });

  test.each([-1, 1.5, Number.NaN])("rejects %s months", (months) => {
    expect(() => monthlyIncome([], months, NOW)).toThrow(RangeError);
  });
});

describe("income by service, payment method and country", () => {
  test("income by item is sorted and shares add up to 100", () => {
    const sales = [
      sale({ item: "gamePlan", dollars: 120 }),
      sale({ item: "vodRecorded", dollars: 30 }),
      sale({ item: "vodRecorded", dollars: 30 }),
      sale({ item: "other", dollars: 40 }),
      sale({ item: "lesson", dollars: 40 }),
      sale({ item: "tournament", dollars: 999, paidOn: "2026-09-30" }), // fuera del rango
    ];

    const rows = incomeByItem(sales, THIS_MONTH);

    // A igual ingreso y cantidad, manda el orden del catálogo ("lesson" antes que "other").
    expect(rows.map((row) => [row.item, row.count, row.usdMinor])).toEqual([
      ["gamePlan", 1, 12_000],
      ["vodRecorded", 2, 6000],
      ["lesson", 1, 4000],
      ["other", 1, 4000],
    ]);
    // 46,15 / 23,08 / 15,38 / 15,38 redondeados uno por uno sumarían 100,1.
    expect(rows.map((row) => row.sharePct)).toEqual([46.1, 23.1, 15.4, 15.4]);
    expect(Math.round(rows.reduce((total, row) => total + row.sharePct, 0) * 10)).toBe(1000);
  });

  test("shares add up to 100 even when the thirds do not", () => {
    const sales = [
      sale({ item: "lesson", dollars: 100 }),
      sale({ item: "gamePlan", dollars: 100 }),
      sale({ item: "tournament", dollars: 100 }),
    ];
    const rows = incomeByItem(sales, THIS_MONTH);
    expect(rows.map((row) => row.sharePct)).toEqual([33.4, 33.3, 33.3]);
    expect(rows.map((row) => row.item)).toEqual(["lesson", "gamePlan", "tournament"]);
  });

  test("a single service has the whole share", () => {
    expect(incomeByItem([sale({ item: "lesson" })], THIS_MONTH)).toEqual([
      { item: "lesson", count: 1, usdMinor: 4000, sharePct: 100 },
    ]);
  });

  test("with no income in the range there is nothing to list", () => {
    expect(incomeByItem([], THIS_MONTH)).toEqual([]);
    expect(incomeByItem([sale({ paidOn: "2026-09-01" })], THIS_MONTH)).toEqual([]);
  });

  test("sales worth zero dollars still count and share nothing", () => {
    const sales = [
      sale({ item: "lesson", amountUsdMinor: 0, amountArsMinor: 100 }),
      sale({ item: "gamePlan", amountUsdMinor: 0, amountArsMinor: 100 }),
      sale({ item: "gamePlan", amountUsdMinor: 0, amountArsMinor: 100 }),
    ];
    expect(incomeByItem(sales, THIS_MONTH)).toEqual([
      { item: "gamePlan", count: 2, usdMinor: 0, sharePct: 0 },
      { item: "lesson", count: 1, usdMinor: 0, sharePct: 0 },
    ]);
  });

  test("the range is inclusive on both ends", () => {
    const sales = [
      sale({ paidOn: "2026-09-30", dollars: 1 }),
      sale({ paidOn: "2026-10-01", dollars: 2 }),
      sale({ paidOn: "2026-10-31", dollars: 4 }),
      sale({ paidOn: "2026-11-01", dollars: 8 }),
    ];
    expect(incomeByItem(sales, THIS_MONTH)[0].usdMinor).toBe(600);
  });

  test("income by payment method groups, sorts (ties in catalog order) and shares", () => {
    const sales = [
      sale({ paymentMethod: "transfer", dollars: 40 }),
      sale({ paymentMethod: "mercadopago", dollars: 100 }),
      sale({ paymentMethod: "mercadopago", dollars: 20 }),
      sale({ paymentMethod: "paypal", dollars: 40 }),
    ];
    expect(incomeByPaymentMethod(sales, THIS_MONTH)).toEqual([
      { paymentMethod: "mercadopago", count: 2, usdMinor: 12_000, sharePct: 60 },
      { paymentMethod: "paypal", count: 1, usdMinor: 4000, sharePct: 20 },
      { paymentMethod: "transfer", count: 1, usdMinor: 4000, sharePct: 20 },
    ]);
  });

  test("income by country puts students without a country under 'Sin país'", () => {
    expect(NO_COUNTRY_LABEL).toBe("Sin país");
    const sales = [
      sale({ country: "AR", dollars: 100 }),
      sale({ country: "BR", dollars: 50 }),
      sale({ country: null, dollars: 25 }),
      sale({ country: "  ", dollars: 25 }),
      sale({ country: "mx", dollars: 25 }),
      sale({ country: "MX", dollars: 25 }),
    ];
    // México y "Sin país" empatan en 50 dólares y en 2 ventas, y Brasil en 50
    // dólares pero con una: el empate se resuelve por cantidad y, al final, por
    // código, con "Sin país" último.
    expect(incomeByCountry(sales, THIS_MONTH)).toEqual([
      { country: "AR", count: 1, usdMinor: 10_000, sharePct: 40 },
      { country: "MX", count: 2, usdMinor: 5000, sharePct: 20 },
      { country: "Sin país", count: 2, usdMinor: 5000, sharePct: 20 },
      { country: "BR", count: 1, usdMinor: 5000, sharePct: 20 },
    ]);
  });

  test("items without sales in 90 days excludes other", () => {
    const sales = [
      sale({ item: "lesson", paidOn: "2026-10-03" }),
      sale({ item: "other", paidOn: "2026-10-05" }),
      // El día 90 contando hoy (13/10 - 89 días = 16/7) todavía entra; el 15/7, no.
      sale({ item: "vodRecorded", paidOn: "2026-07-16" }),
      sale({ item: "vodLive", paidOn: "2026-07-15" }),
    ];

    expect(itemsWithoutSales(sales, 90, NOW)).toEqual([
      "vodLive",
      "lessonPack",
      "gamePlan",
      "tournament",
      "proSeason",
    ]);
    expect(itemsWithoutSales(sales, undefined, NOW)).toEqual(itemsWithoutSales(sales, 90, NOW));
  });

  test("with no sales at all every service but other is without sales", () => {
    expect(itemsWithoutSales([], 90, NOW)).toEqual(SALE_ITEMS.filter((item) => item !== "other"));
  });

  test("the window of items without sales follows the days asked", () => {
    const sales = [
      sale({ item: "lesson", paidOn: "2026-10-04" }),
      sale({ item: "gamePlan", paidOn: "2026-09-20" }),
    ];
    // 10 días: del 4/10 al 13/10.
    expect(itemsWithoutSales(sales, 10, NOW)).not.toContain("lesson");
    expect(itemsWithoutSales(sales, 9, NOW)).toContain("lesson");
    // 24 días: del 20/9 al 13/10.
    expect(itemsWithoutSales(sales, 24, NOW)).not.toContain("gamePlan");
    expect(itemsWithoutSales(sales, 23, NOW)).toContain("gamePlan");
  });

  test("a sale dated in the future does not count as a sale of that service yet", () => {
    const sales = [sale({ item: "tournament", paidOn: "2026-10-14" })];
    expect(itemsWithoutSales(sales, 90, NOW)).toContain("tournament");
    // Mañana ya es una venta del servicio.
    expect(itemsWithoutSales(sales, 90, new Date("2026-10-14T15:00:00.000Z"))).not.toContain(
      "tournament",
    );
  });

  test.each([0, -5, 2.5])("rejects %s days", (days) => {
    expect(() => itemsWithoutSales([], days, NOW)).toThrow(RangeError);
  });
});
