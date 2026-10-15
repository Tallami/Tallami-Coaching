import { describe, expect, test } from "vitest";
import { computeKpis, isIncome } from "@/admin/metrics/kpis";
import { monotributoStatus } from "@/admin/metrics/monotributo";
import { pendingWork } from "@/admin/metrics/pending";
import {
  addDays,
  addMonths,
  isPeriod,
  periodRange,
  previousPeriodRange,
  previousRange,
  todayInArgentina,
  type Period,
} from "@/admin/metrics/period";
import {
  incomeByCountry,
  incomeByItem,
  incomeByPaymentMethod,
  itemsWithoutSales,
  monthlyIncome,
} from "@/admin/metrics/series";
import { NOW, THIS_MONTH, ids, sale } from "../helpers/metric-sales";

describe("only paid and delivered sales are income", () => {
  const sales = [
    sale({
      id: "paid",
      customerId: "ana",
      dollars: 40,
      item: "lesson",
      paymentMethod: "mercadopago",
      country: "AR",
      invoiceStatus: "pending",
    }),
    sale({
      id: "delivered",
      customerId: "bruno",
      status: "delivered",
      deliveredAt: "2026-10-08T15:00:00.000Z",
      dollars: 50,
      item: "vodLive",
      paymentMethod: "paypal",
      country: "BR",
      invoiceStatus: "pending",
    }),
    // Las que no son ingreso llevan fecha de cobro a propósito: el estado manda.
    sale({
      id: "pending",
      customerId: "carla",
      status: "pending",
      paidOn: "2026-10-04",
      dollars: 60,
      item: "gamePlan",
      paymentMethod: "cash",
      country: "MX",
      invoiceStatus: "pending",
    }),
    sale({
      id: "cancelled",
      customerId: "carla",
      status: "cancelled",
      paidOn: "2026-10-06",
      dollars: 70,
      item: "tournament",
      paymentMethod: "crypto",
      country: "MX",
      invoiceStatus: "pending",
    }),
    sale({
      id: "refunded",
      customerId: "carla",
      status: "refunded",
      paidOn: "2026-10-07",
      dollars: 80,
      item: "proSeason",
      paymentMethod: "pix",
      country: "MX",
      invoiceStatus: "pending",
    }),
  ];

  test("isIncome keeps exactly the paid and delivered ones", () => {
    expect(ids(sales.filter(isIncome))).toEqual(["paid", "delivered"]);
  });

  test("a paid sale without a payment day is not income (it fits in no period)", () => {
    expect(isIncome(sale({ status: "paid", paidOn: null }))).toBe(false);
  });

  test("they do not add to the cards", () => {
    expect(computeKpis(sales, "thisMonth", NOW)).toEqual({
      incomeUsdMinor: 9000,
      incomeArsMinor: 13_500_000,
      incomeUsdDeltaPct: null,
      salesCount: 2,
      avgTicketUsdMinor: 4500,
      newCustomers: 2,
      repeatRatePct: 0,
    });
  });

  test("they do not add to the monthly series", () => {
    const series = monthlyIncome(sales, 12, NOW);
    expect(series.at(-1)).toEqual({ month: "2026-10", usdMinor: 9000, arsMinor: 13_500_000 });
    expect(series.reduce((total, month) => total + month.usdMinor, 0)).toBe(9000);
  });

  test("they do not add to services, payment methods or countries", () => {
    expect(incomeByItem(sales, THIS_MONTH).map((row) => [row.item, row.usdMinor])).toEqual([
      ["vodLive", 5000],
      ["lesson", 4000],
    ]);
    expect(incomeByPaymentMethod(sales, THIS_MONTH).map((row) => row.paymentMethod)).toEqual([
      "paypal",
      "mercadopago",
    ]);
    expect(incomeByCountry(sales, THIS_MONTH).map((row) => row.country)).toEqual(["BR", "AR"]);
  });

  test("a cancelled sale does not take a service off the list of services without sales", () => {
    expect(itemsWithoutSales(sales, 90, NOW)).toEqual([
      "vodRecorded",
      "lessonPack",
      "gamePlan",
      "tournament",
      "proSeason",
    ]);
  });

  test("they do not add to the monotributo", () => {
    const settings = { category: "A", annualCapArsMinor: 100_000_000, validFrom: "2026-08-01" };
    expect(monotributoStatus(sales, settings, NOW).last12ArsMinor).toBe(13_500_000);
  });

  test("they are not pending invoices", () => {
    expect(pendingWork(sales, NOW).uninvoiced).toEqual({
      count: 2,
      arsMinor: 13_500_000,
      usdMinor: 9000,
    });
  });
});

describe("periods and the Argentine calendar", () => {
  test("a sale paid on the 31st at 22:00 in Argentina belongs to that month", () => {
    // 31/10 22:30 en Argentina ya es 1/11 01:30 en UTC.
    const lateOnTheThirtyFirst = new Date("2026-11-01T01:30:00.000Z");
    expect(todayInArgentina(lateOnTheThirtyFirst)).toBe("2026-10-31");
    expect(todayInArgentina(new Date("2026-11-01T03:00:00.000Z"))).toBe("2026-11-01");

    const sales = [
      sale({ id: "late", paidOn: "2026-10-31", dollars: 40 }),
      sale({ id: "november", paidOn: "2026-11-01", dollars: 10 }),
    ];

    expect(periodRange("thisMonth", lateOnTheThirtyFirst)).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(computeKpis(sales, "thisMonth", lateOnTheThirtyFirst).incomeUsdMinor).toBe(4000);
    expect(monthlyIncome(sales, 12, lateOnTheThirtyFirst).at(-1)).toEqual({
      month: "2026-10",
      usdMinor: 4000,
      arsMinor: 6_000_000,
    });

    // Tres horas después ya es noviembre en Argentina: el mes que pasó es el de la venta.
    const firstMinutesOfNovember = new Date("2026-11-01T03:00:00.000Z");
    expect(computeKpis(sales, "thisMonth", firstMinutesOfNovember).incomeUsdMinor).toBe(1000);
    expect(computeKpis(sales, "lastMonth", firstMinutesOfNovember).incomeUsdMinor).toBe(4000);
  });

  test("period ranges are inclusive Argentine days", () => {
    expect(periodRange("thisMonth", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("lastMonth", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    // 30 días contando hoy: del 14/9 al 13/10.
    expect(periodRange("last30", NOW)).toEqual({ from: "2026-09-14", to: "2026-10-13" });
    // 12 meses de calendario con el actual: los mismos 12 meses del gráfico.
    expect(periodRange("last12", NOW)).toEqual({ from: "2025-11-01", to: "2026-10-31" });
    expect(periodRange("thisYear", NOW)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  test("last month crosses the year and knows leap years", () => {
    expect(periodRange("lastMonth", new Date("2026-01-15T15:00:00.000Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(periodRange("lastMonth", new Date("2028-03-10T15:00:00.000Z"))).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(periodRange("lastMonth", new Date("2026-03-10T15:00:00.000Z"))).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  test("the previous range of a calendar month is the whole month before", () => {
    expect(previousRange({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(previousRange({ from: "2026-03-01", to: "2026-03-31" })).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(previousRange({ from: "2026-01-01", to: "2026-01-31" })).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  test("the previous range of whole months is the same number of months before", () => {
    expect(previousRange({ from: "2025-11-01", to: "2026-10-31" })).toEqual({
      from: "2024-11-01",
      to: "2025-10-31",
    });
    expect(previousRange({ from: "2026-01-01", to: "2026-12-31" })).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
    // Un año bisiesto no corre el borde un día.
    expect(previousRange({ from: "2028-01-01", to: "2028-12-31" })).toEqual({
      from: "2027-01-01",
      to: "2027-12-31",
    });
  });

  test("the previous range of any other span has the same length and sits right before", () => {
    expect(previousRange({ from: "2026-09-14", to: "2026-10-13" })).toEqual({
      from: "2026-08-15",
      to: "2026-09-13",
    });
    expect(previousRange({ from: "2026-10-01", to: "2026-10-10" })).toEqual({
      from: "2026-09-21",
      to: "2026-09-30",
    });
    expect(previousRange({ from: "2026-10-13", to: "2026-10-13" })).toEqual({
      from: "2026-10-12",
      to: "2026-10-12",
    });
  });

  test("previousPeriodRange keeps 30 days for the last 30 even if they match a calendar month", () => {
    const november30 = new Date("2026-11-30T15:00:00.000Z");
    expect(periodRange("last30", november30)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(previousPeriodRange("last30", november30)).toEqual({
      from: "2026-10-02",
      to: "2026-10-31",
    });
    expect(previousPeriodRange("thisMonth", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousPeriodRange("lastMonth", NOW)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(previousPeriodRange("last12", NOW)).toEqual({ from: "2024-11-01", to: "2025-10-31" });
    expect(previousPeriodRange("thisYear", NOW)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  test("rejects a range that ends before it starts", () => {
    expect(() => previousRange({ from: "2026-10-13", to: "2026-10-12" })).toThrow(RangeError);
  });

  test("day arithmetic is calendar arithmetic", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2028-03-31", -1)).toBe("2028-02-29");
    expect(addMonths("2026-10-13", -12)).toBe("2025-10-13");
    expect(addMonths("2026-01-15", -2)).toBe("2025-11-15");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
  });

  test("isPeriod accepts only the five periods", () => {
    const periods: Period[] = ["thisMonth", "lastMonth", "last30", "last12", "thisYear"];
    for (const period of periods) expect(isPeriod(period)).toBe(true);
    expect(isPeriod("lastYear")).toBe(false);
    expect(isPeriod(undefined)).toBe(false);
  });
});

describe("cards", () => {
  test("this month vs last month delta", () => {
    const sales = [
      sale({ paidOn: "2026-09-02", dollars: 120 }),
      sale({ paidOn: "2026-09-30", dollars: 80 }),
      sale({ paidOn: "2026-10-01", dollars: 100 }),
      sale({ paidOn: "2026-10-13", dollars: 200 }),
      sale({ paidOn: "2026-08-31", dollars: 999 }),
    ];

    const kpis = computeKpis(sales, "thisMonth", NOW);

    expect(kpis.incomeUsdMinor).toBe(30_000);
    expect(kpis.incomeArsMinor).toBe(45_000_000);
    expect(kpis.salesCount).toBe(2);
    expect(kpis.incomeUsdDeltaPct).toBe(50);
  });

  test("a drop is a negative delta with one decimal", () => {
    const sales = [
      sale({ paidOn: "2026-09-15", dollars: 300 }),
      sale({ paidOn: "2026-10-02", dollars: 100 }),
    ];
    expect(computeKpis(sales, "thisMonth", NOW).incomeUsdDeltaPct).toBe(-66.7);

    const growth = [
      sale({ paidOn: "2026-09-15", dollars: 300 }),
      sale({ paidOn: "2026-10-02", dollars: 400 }),
    ];
    expect(computeKpis(growth, "thisMonth", NOW).incomeUsdDeltaPct).toBe(33.3);
  });

  test("the delta rounds half away from zero at one decimal", () => {
    const up = [
      sale({ paidOn: "2026-09-15", amountUsdMinor: 2000 }),
      sale({ paidOn: "2026-10-02", amountUsdMinor: 2001 }),
    ];
    const down = [
      sale({ paidOn: "2026-09-15", amountUsdMinor: 2000 }),
      sale({ paidOn: "2026-10-02", amountUsdMinor: 1999 }),
    ];
    expect(computeKpis(up, "thisMonth", NOW).incomeUsdDeltaPct).toBe(0.1);
    expect(computeKpis(down, "thisMonth", NOW).incomeUsdDeltaPct).toBe(-0.1);
  });

  test("delta is null when the previous period had no income", () => {
    const onlyThisMonth = [sale({ paidOn: "2026-10-02", dollars: 100 })];
    expect(computeKpis(onlyThisMonth, "thisMonth", NOW).incomeUsdDeltaPct).toBeNull();

    // Una venta reembolsada el mes pasado no es ingreso: sigue siendo cero.
    const refundedLastMonth = [
      ...onlyThisMonth,
      sale({ paidOn: "2026-09-10", dollars: 500, status: "refunded" }),
    ];
    expect(computeKpis(refundedLastMonth, "thisMonth", NOW).incomeUsdDeltaPct).toBeNull();
  });

  test("with no sales every card is zero", () => {
    expect(computeKpis([], "thisMonth", NOW)).toEqual({
      incomeUsdMinor: 0,
      incomeArsMinor: 0,
      incomeUsdDeltaPct: null,
      salesCount: 0,
      avgTicketUsdMinor: 0,
      newCustomers: 0,
      repeatRatePct: 0,
    });
  });

  test("the average ticket is whole cents, rounded half up", () => {
    const sales = [
      sale({ amountUsdMinor: 2, amountArsMinor: 3 }),
      sale({ amountUsdMinor: 3, amountArsMinor: 5 }),
    ];
    // 5 / 2 = 2,5 centavos.
    expect(computeKpis(sales, "thisMonth", NOW).avgTicketUsdMinor).toBe(3);
    const third = [...sales, sale({ amountUsdMinor: 2, amountArsMinor: 3 })];
    // 7 / 3 = 2,33 centavos.
    expect(computeKpis(third, "thisMonth", NOW).avgTicketUsdMinor).toBe(2);
  });

  test("each period reads its own range", () => {
    const sales = [
      sale({ paidOn: "2026-10-13", dollars: 10 }),
      sale({ paidOn: "2026-09-14", dollars: 20 }),
      sale({ paidOn: "2026-09-13", dollars: 40 }),
      sale({ paidOn: "2026-02-01", dollars: 80 }),
      sale({ paidOn: "2025-11-01", dollars: 160 }),
      sale({ paidOn: "2025-10-31", dollars: 320 }),
    ];
    const income = (period: Period) => computeKpis(sales, period, NOW).incomeUsdMinor;

    expect(income("thisMonth")).toBe(1000);
    expect(income("lastMonth")).toBe(6000);
    expect(income("last30")).toBe(3000);
    expect(income("last12")).toBe(31_000);
    expect(income("thisYear")).toBe(15_000);
  });

  test("the last 12 months of the card add up to the 12 bars of the chart", () => {
    const sales = [
      sale({ paidOn: "2025-11-01", dollars: 10 }),
      sale({ paidOn: "2026-03-31", dollars: 20 }),
      sale({ paidOn: "2026-10-13", dollars: 40 }),
      sale({ paidOn: "2026-10-30", dollars: 80 }),
      sale({ paidOn: "2025-10-31", dollars: 160 }),
    ];
    const bars = monthlyIncome(sales, 12, NOW).reduce((total, month) => total + month.usdMinor, 0);
    expect(computeKpis(sales, "last12", NOW).incomeUsdMinor).toBe(bars);
  });

  test("repeat rate counts customers with an earlier purchase", () => {
    const sales = [
      // Ana y Carla ya habían comprado antes de octubre.
      sale({ customerId: "ana", paidOn: "2026-08-10" }),
      sale({ customerId: "ana", paidOn: "2026-10-05" }),
      sale({ customerId: "carla", paidOn: "2026-09-20" }),
      sale({ customerId: "carla", paidOn: "2026-10-10" }),
      // Bruno y Darío compran por primera vez en octubre (Darío, dos veces).
      sale({ customerId: "bruno", paidOn: "2026-10-07" }),
      sale({ customerId: "dario", paidOn: "2026-10-12" }),
      sale({ customerId: "dario", paidOn: "2026-10-13" }),
      // Edu tenía una venta cancelada en enero: eso no es una compra anterior.
      sale({ customerId: "edu", paidOn: "2026-01-10", status: "cancelled" }),
      sale({ customerId: "edu", paidOn: "2026-10-09" }),
      // Fran compró en julio y no volvió: no es alumno del período.
      sale({ customerId: "fran", paidOn: "2026-07-01" }),
    ];

    const kpis = computeKpis(sales, "thisMonth", NOW);

    // Alumnos del período: ana, carla, bruno, dario, edu. Con compra anterior: ana y carla.
    expect(kpis.repeatRatePct).toBe(40);
    expect(kpis.newCustomers).toBe(3);
    expect(kpis.salesCount).toBe(6);
  });

  test("repeat rate is one decimal", () => {
    const sales = [
      sale({ customerId: "ana", paidOn: "2026-08-10" }),
      sale({ customerId: "ana", paidOn: "2026-10-05" }),
      sale({ customerId: "bruno", paidOn: "2026-10-06" }),
      sale({ customerId: "carla", paidOn: "2026-10-07" }),
    ];
    expect(computeKpis(sales, "thisMonth", NOW).repeatRatePct).toBe(33.3);
  });

  test("a customer is new in the period of the first purchase and never again", () => {
    const sales = [
      sale({ customerId: "ana", paidOn: "2026-09-10" }),
      sale({ customerId: "ana", paidOn: "2026-10-10" }),
    ];
    expect(computeKpis(sales, "lastMonth", NOW).newCustomers).toBe(1);
    expect(computeKpis(sales, "thisMonth", NOW).newCustomers).toBe(0);
    expect(computeKpis(sales, "last12", NOW).newCustomers).toBe(1);
  });

  test("a sum that does not fit in a safe integer fails instead of rounding", () => {
    const huge = Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1;
    const sales = [sale({ amountArsMinor: huge }), sale({ amountArsMinor: huge })];
    expect(() => computeKpis(sales, "thisMonth", NOW)).toThrow(RangeError);
  });
});
