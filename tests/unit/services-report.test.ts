import { describe, expect, test } from "vitest";
import { SALE_ITEMS, SITE_BOOKING_ITEMS, type SaleItem } from "@/admin/catalog";
import type { ItemClicks } from "@/admin/interest/query";
import { buildServicesReport, type ServiceRow } from "@/admin/services/report";
import { NOW, sale } from "../helpers/metric-sales";

/** Los clics por servicio como los entrega `interestByItem`: todos los ítems con botón, en cero salvo los que se pasan. */
function clicks(counts: Partial<Record<SaleItem, number>> = {}): ItemClicks[] {
  return SALE_ITEMS.filter((item) => item !== "other").map((item) => ({
    item: item as ItemClicks["item"],
    clicks: counts[item] ?? 0,
  }));
}

function rowOf(rows: readonly ServiceRow[], item: SaleItem): ServiceRow {
  const row = rows.find((candidate) => candidate.item === item);
  if (!row) throw new Error(`Falta la fila de ${item}`);
  return row;
}

describe("buildServicesReport", () => {
  test("has one row per catalog item, in catalog order, even with no data at all", () => {
    const report = buildServicesReport([], clicks(), "thisMonth", NOW);

    expect(report.rows.map((row) => row.item)).toEqual([...SALE_ITEMS]);
    expect(report.hasActivity).toBe(false);
    expect(report.totals).toEqual({ sales: 0, incomeUsdMinor: 0, clicks: 0 });
    for (const row of report.rows) {
      expect(row.sales).toBe(0);
      expect(row.incomeUsdMinor).toBe(0);
      expect(row.avgTicketUsdMinor).toBeNull();
      expect(row.sharePct).toBe(0);
      expect(row.lastSaleOn).toBeNull();
      expect(row.conversionPct).toBeNull();
      expect(row.trend).toHaveLength(6);
    }
  });

  test("uses the range of the period and tells which day today is", () => {
    const report = buildServicesReport([], clicks(), "thisMonth", NOW);

    expect(report.today).toBe("2026-10-13");
    expect(report.range).toEqual({ from: "2026-10-01", to: "2026-10-13" });
    expect(buildServicesReport([], clicks(), "lastMonth", NOW).range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  test("counts only income sales paid inside the range", () => {
    const sales = [
      sale({ item: "lesson", paidOn: "2026-10-05" }),
      sale({ item: "lesson", paidOn: "2026-10-10", status: "delivered" }),
      sale({ item: "lesson", paidOn: null, status: "pending" }),
      sale({ item: "lesson", paidOn: null, status: "cancelled" }),
      sale({ item: "lesson", paidOn: "2026-10-06", status: "refunded" }),
      sale({ item: "lesson", paidOn: "2026-09-30" }),
      sale({ item: "lesson", paidOn: "2026-10-20" }),
    ];

    const row = rowOf(buildServicesReport(sales, clicks(), "thisMonth", NOW).rows, "lesson");

    expect(row.sales).toBe(2);
    expect(row.incomeUsdMinor).toBe(8000);
    expect(row.avgTicketUsdMinor).toBe(4000);
  });

  test("the average ticket rounds half-up to the cent", () => {
    const sales = [
      sale({ item: "vodLive", amountUsdMinor: 3333 }),
      sale({ item: "vodLive", amountUsdMinor: 3333 }),
      sale({ item: "vodLive", amountUsdMinor: 3334 }),
      sale({ item: "gamePlan", amountUsdMinor: 5000 }),
      sale({ item: "gamePlan", amountUsdMinor: 5001 }),
    ];

    const report = buildServicesReport(sales, clicks(), "thisMonth", NOW);

    // 10.000 / 3 = 3.333,33 y 10.001 / 2 = 5.000,5.
    expect(rowOf(report.rows, "vodLive").avgTicketUsdMinor).toBe(3333);
    expect(rowOf(report.rows, "gamePlan").avgTicketUsdMinor).toBe(5001);
  });

  test("shares of the total add up to exactly 100,0", () => {
    const sales = [
      sale({ item: "lesson", dollars: 100 }),
      sale({ item: "gamePlan", dollars: 100 }),
      sale({ item: "vodLive", dollars: 100 }),
    ];

    const report = buildServicesReport(sales, clicks(), "thisMonth", NOW);

    const tenths = report.rows.map((row) => Math.round(row.sharePct * 10)).sort((a, b) => b - a);
    expect(tenths.reduce((total, value) => total + value, 0)).toBe(1000);
    expect(tenths.slice(0, 3)).toEqual([334, 333, 333]);
    expect(rowOf(report.rows, "tournament").sharePct).toBe(0);
  });

  describe("conversion", () => {
    test("is sales divided by clicks of the same period, with one decimal", () => {
      const sales = [sale({ item: "lesson" }), sale({ item: "lesson" })];

      const row = rowOf(buildServicesReport(sales, clicks({ lesson: 8 }), "thisMonth", NOW).rows, "lesson");

      expect(row.clicks).toBe(8);
      expect(row.conversionPct).toBe(25);
      expect(rowOf(buildServicesReport([sale({ item: "lesson" })], clicks({ lesson: 3 }), "thisMonth", NOW).rows, "lesson").conversionPct).toBe(33.3);
    });

    test("is empty (never a division by zero) when nobody clicked", () => {
      const sales = [sale({ item: "lesson" })];

      const row = rowOf(buildServicesReport(sales, clicks({ lesson: 0 }), "thisMonth", NOW).rows, "lesson");

      expect(row.clicks).toBe(0);
      expect(row.sales).toBe(1);
      expect(row.conversionPct).toBeNull();
    });

    test("is 0 with clicks and no sales, and can pass 100 when sales also come from outside the site", () => {
      const none = rowOf(buildServicesReport([], clicks({ vodLive: 5 }), "thisMonth", NOW).rows, "vodLive");
      const outside = rowOf(
        buildServicesReport([sale({ item: "tournament" }), sale({ item: "tournament" }), sale({ item: "tournament" })], clicks({ tournament: 2 }), "thisMonth", NOW).rows,
        "tournament",
      );

      expect(none.conversionPct).toBe(0);
      expect(outside.conversionPct).toBe(150);
    });

    test("items without a button on the site have no clicks and no conversion", () => {
      const sales = [sale({ item: "lessonPack", dollars: 140 }), sale({ item: "other", dollars: 60 })];
      // Aunque la base trajera clics del pack, el sitio no tiene ese botón.
      const report = buildServicesReport(sales, clicks({ lessonPack: 4 }), "thisMonth", NOW);

      for (const item of ["lessonPack", "other"] as const) {
        expect(SITE_BOOKING_ITEMS as readonly string[]).not.toContain(item);
        expect(rowOf(report.rows, item).clicks, item).toBeNull();
        expect(rowOf(report.rows, item).conversionPct, item).toBeNull();
      }
      expect(rowOf(report.rows, "lessonPack").sales).toBe(1);
      expect(report.totals.clicks).toBe(0);
    });

    test("only counts the clicks it is given for the period (the loader filters by date)", () => {
      const march = buildServicesReport([sale({ item: "lesson" })], clicks({ lesson: 2 }), "lastMonth", NOW);

      expect(rowOf(march.rows, "lesson").clicks).toBe(2);
      expect(rowOf(march.rows, "lesson").sales).toBe(0);
      expect(rowOf(march.rows, "lesson").conversionPct).toBe(0);
    });

    test("ignores clicks for items that do not exist", () => {
      const strange = [...clicks(), { item: "coaching-vip", clicks: 99 }] as unknown as ItemClicks[];

      const report = buildServicesReport([], strange, "thisMonth", NOW);

      expect(report.totals.clicks).toBe(0);
    });
  });

  test("the last sale is the latest paid day up to today, whatever the period", () => {
    const sales = [
      sale({ item: "gamePlan", paidOn: "2026-06-03" }),
      sale({ item: "gamePlan", paidOn: "2026-08-21" }),
      sale({ item: "gamePlan", paidOn: "2026-10-30" }),
      sale({ item: "gamePlan", paidOn: "2026-09-29", status: "cancelled" }),
      sale({ item: "gamePlan", paidOn: "2026-09-30", status: "pending" }),
    ];

    const report = buildServicesReport(sales, clicks(), "thisMonth", NOW);

    expect(rowOf(report.rows, "gamePlan").lastSaleOn).toBe("2026-08-21");
    expect(rowOf(report.rows, "gamePlan").sales).toBe(0);
    expect(rowOf(report.rows, "lesson").lastSaleOn).toBeNull();
  });

  test("the six-month trend goes from the oldest month to the current one, in dollars", () => {
    const sales = [
      sale({ item: "lesson", dollars: 40, paidOn: "2026-05-02" }),
      sale({ item: "lesson", dollars: 40, paidOn: "2026-05-31" }),
      sale({ item: "lesson", dollars: 80, paidOn: "2026-07-15" }),
      sale({ item: "lesson", dollars: 40, paidOn: "2026-10-01" }),
      sale({ item: "lesson", dollars: 40, paidOn: "2026-04-30" }),
      sale({ item: "lesson", dollars: 40, paidOn: "2026-10-30" }),
      sale({ item: "lesson", dollars: 40, paidOn: "2026-09-10", status: "cancelled" }),
      sale({ item: "gamePlan", dollars: 120, paidOn: "2026-09-10" }),
    ];

    const report = buildServicesReport(sales, clicks(), "thisMonth", NOW);
    const trend = rowOf(report.rows, "lesson").trend;

    expect(trend.map((month) => month.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(trend.map((month) => month.usdMinor)).toEqual([8000, 0, 8000, 0, 0, 4000]);
    expect(report.trendMonths).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  });

  test("the trend does not change with the selected period", () => {
    const sales = [sale({ item: "lesson", paidOn: "2026-07-15", dollars: 80 })];

    const thisMonth = rowOf(buildServicesReport(sales, clicks(), "thisMonth", NOW).rows, "lesson").trend;
    const thisYear = rowOf(buildServicesReport(sales, clicks(), "thisYear", NOW).rows, "lesson").trend;

    expect(thisYear).toEqual(thisMonth);
  });

  test("a sale paid on the last day of a month stays in that month in the trend", () => {
    // El día de cobro ya es el día de Argentina (cobrar el 31 a las 22:00 es el 31):
    // las métricas no vuelven a convertir zonas.
    const sales = [sale({ item: "lesson", dollars: 40, paidOn: "2026-08-31" })];

    const trend = rowOf(buildServicesReport(sales, clicks(), "thisMonth", NOW).rows, "lesson").trend;

    expect(trend.find((month) => month.month === "2026-08")?.usdMinor).toBe(4000);
    expect(trend.find((month) => month.month === "2026-09")?.usdMinor).toBe(0);
  });

  test("totals add the sales and the income of every row, and the clicks of the buttons", () => {
    const sales = [
      sale({ item: "lesson", dollars: 40 }),
      sale({ item: "gamePlan", dollars: 120 }),
      sale({ item: "other", dollars: 60 }),
    ];

    const report = buildServicesReport(sales, clicks({ lesson: 5, gamePlan: 7, proSeason: 1 }), "thisMonth", NOW);

    expect(report.totals).toEqual({ sales: 3, incomeUsdMinor: 22_000, clicks: 13 });
    expect(report.hasActivity).toBe(true);
  });

  test("clicks alone count as activity", () => {
    expect(buildServicesReport([], clicks({ lesson: 1 }), "thisMonth", NOW).hasActivity).toBe(true);
  });
});
