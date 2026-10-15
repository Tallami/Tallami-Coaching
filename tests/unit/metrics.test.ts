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

  test("period ranges are inclusive Argentine days and end today", () => {
    expect(periodRange("thisMonth", NOW)).toEqual({ from: "2026-10-01", to: "2026-10-13" });
    // El único que termina antes de hoy: el mes pasado entero.
    expect(periodRange("lastMonth", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    // 30 días contando hoy: del 14/9 al 13/10.
    expect(periodRange("last30", NOW)).toEqual({ from: "2026-09-14", to: "2026-10-13" });
    // 12 meses de calendario con el actual: los mismos 12 meses del gráfico, hasta hoy.
    expect(periodRange("last12", NOW)).toEqual({ from: "2025-11-01", to: "2026-10-13" });
    expect(periodRange("thisYear", NOW)).toEqual({ from: "2026-01-01", to: "2026-10-13" });
  });

  test("the first day of the month and of the year are one-day ranges", () => {
    const january1 = new Date("2026-01-01T15:00:00.000Z");
    expect(periodRange("thisMonth", january1)).toEqual({ from: "2026-01-01", to: "2026-01-01" });
    expect(periodRange("thisYear", january1)).toEqual({ from: "2026-01-01", to: "2026-01-01" });
    expect(periodRange("last12", january1)).toEqual({ from: "2025-02-01", to: "2026-01-01" });
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

  test("previousPeriodRange compares the same stretch of the previous period", () => {
    // El 13/10 se compara contra el 1 al 13 de septiembre, no contra septiembre entero.
    expect(previousPeriodRange("thisMonth", NOW)).toEqual({ from: "2026-09-01", to: "2026-09-13" });
    expect(previousPeriodRange("thisYear", NOW)).toEqual({ from: "2025-01-01", to: "2025-10-13" });
    expect(previousPeriodRange("last12", NOW)).toEqual({ from: "2024-11-01", to: "2025-10-13" });
    expect(previousPeriodRange("lastMonth", NOW)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(previousPeriodRange("last30", NOW)).toEqual({ from: "2026-08-15", to: "2026-09-13" });
  });

  test("the same day of the previous month is clamped to its last day", () => {
    const at = (iso: string) => previousPeriodRange("thisMonth", new Date(iso));
    // 31/3 contra el 1 al 28/2 (29/2 en año bisiesto).
    expect(at("2026-03-31T15:00:00.000Z")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(at("2028-03-31T15:00:00.000Z")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(at("2028-03-30T15:00:00.000Z")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(at("2028-03-29T15:00:00.000Z")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(at("2027-03-29T15:00:00.000Z")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(at("2026-03-28T15:00:00.000Z")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // 31/5 contra el 1 al 30/4, y 31/12 contra el 1 al 30/11.
    expect(at("2026-05-31T15:00:00.000Z")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
    expect(at("2026-12-31T15:00:00.000Z")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    // Enero se compara contra diciembre del año anterior.
    expect(at("2026-01-15T15:00:00.000Z")).toEqual({ from: "2025-12-01", to: "2025-12-15" });
  });

  test("this year compares with the same date of the previous year, 29/2 included", () => {
    const at = (iso: string) => previousPeriodRange("thisYear", new Date(iso));
    expect(at("2026-01-15T15:00:00.000Z")).toEqual({ from: "2025-01-01", to: "2025-01-15" });
    expect(at("2026-01-01T15:00:00.000Z")).toEqual({ from: "2025-01-01", to: "2025-01-01" });
    expect(at("2028-02-29T15:00:00.000Z")).toEqual({ from: "2027-01-01", to: "2027-02-28" });
    expect(at("2028-03-01T15:00:00.000Z")).toEqual({ from: "2027-01-01", to: "2027-03-01" });
    expect(at("2026-12-31T15:00:00.000Z")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
  });

  test("the last 12 months compare with the 12 months ending a year ago", () => {
    const at = (iso: string) => previousPeriodRange("last12", new Date(iso));
    expect(periodRange("last12", new Date("2028-02-29T15:00:00.000Z"))).toEqual({
      from: "2027-03-01",
      to: "2028-02-29",
    });
    expect(at("2028-02-29T15:00:00.000Z")).toEqual({ from: "2026-03-01", to: "2027-02-28" });
    expect(at("2026-01-15T15:00:00.000Z")).toEqual({ from: "2024-02-01", to: "2025-01-15" });
  });

  test("last month compares with the month before it, whole", () => {
    const at = (iso: string) => previousPeriodRange("lastMonth", new Date(iso));
    expect(at("2026-01-15T15:00:00.000Z")).toEqual({ from: "2025-11-01", to: "2025-11-30" });
    expect(at("2028-03-10T15:00:00.000Z")).toEqual({ from: "2028-01-01", to: "2028-01-31" });
    expect(at("2026-03-10T15:00:00.000Z")).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  test("previousPeriodRange keeps 30 days for the last 30 even if they match a calendar month", () => {
    const november30 = new Date("2026-11-30T15:00:00.000Z");
    expect(periodRange("last30", november30)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(previousPeriodRange("last30", november30)).toEqual({
      from: "2026-10-02",
      to: "2026-10-31",
    });
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
    // Del 1 al 13 de octubre contra el 1 al 13 de septiembre: 300 contra 200.
    const sales = [
      sale({ paidOn: "2026-09-02", dollars: 120 }),
      sale({ paidOn: "2026-09-13", dollars: 80 }),
      sale({ paidOn: "2026-10-01", dollars: 100 }),
      sale({ paidOn: "2026-10-13", dollars: 200 }),
      // Lo que queda afuera de los dos tramos.
      sale({ paidOn: "2026-09-14", dollars: 500 }), // septiembre, después del día 13
      sale({ paidOn: "2026-08-31", dollars: 999 }),
      sale({ paidOn: "2026-10-14", dollars: 400 }), // mañana: no cuenta hasta ese día
    ];

    const kpis = computeKpis(sales, "thisMonth", NOW);

    expect(kpis.incomeUsdMinor).toBe(30_000);
    expect(kpis.incomeArsMinor).toBe(45_000_000);
    expect(kpis.salesCount).toBe(2);
    expect(kpis.incomeUsdDeltaPct).toBe(50);
  });

  test("a steady business does not read as a drop in the middle of the month", () => {
    // 100 dólares por semana: el 13/10 el mes va igual que septiembre a esa altura.
    const sales = [
      sale({ paidOn: "2026-09-03", dollars: 100 }),
      sale({ paidOn: "2026-09-10", dollars: 100 }),
      sale({ paidOn: "2026-09-17", dollars: 100 }),
      sale({ paidOn: "2026-09-24", dollars: 100 }),
      sale({ paidOn: "2026-10-01", dollars: 100 }),
      sale({ paidOn: "2026-10-08", dollars: 100 }),
    ];
    expect(computeKpis(sales, "thisMonth", NOW).incomeUsdDeltaPct).toBe(0);
  });

  test("last month compares against the whole month before it", () => {
    const sales = [
      sale({ paidOn: "2026-08-20", dollars: 100 }),
      sale({ paidOn: "2026-09-30", dollars: 150 }),
    ];
    expect(computeKpis(sales, "lastMonth", NOW).incomeUsdDeltaPct).toBe(50);
  });

  test("this year compares the same stretch of the previous year", () => {
    const sales = [
      sale({ paidOn: "2025-02-10", dollars: 100 }),
      sale({ paidOn: "2025-10-13", dollars: 100 }),
      sale({ paidOn: "2025-10-14", dollars: 999 }), // después del 13/10 del año anterior
      sale({ paidOn: "2026-03-01", dollars: 150 }),
      sale({ paidOn: "2026-10-13", dollars: 150 }),
    ];
    expect(computeKpis(sales, "thisYear", NOW).incomeUsdDeltaPct).toBe(50);
  });

  test("the last 12 months compare against the 12 months that ended a year ago", () => {
    const sales = [
      sale({ paidOn: "2024-11-01", dollars: 100 }),
      sale({ paidOn: "2025-10-13", dollars: 100 }),
      sale({ paidOn: "2025-10-14", dollars: 999 }), // entre los dos tramos: no es de ninguno
      sale({ paidOn: "2024-10-31", dollars: 999 }), // antes del tramo anterior
      sale({ paidOn: "2025-11-01", dollars: 300 }),
    ];
    // Del 1/11/2025 al 13/10/2026 (300) contra del 1/11/2024 al 13/10/2025 (200).
    expect(computeKpis(sales, "last12", NOW).incomeUsdDeltaPct).toBe(50);
  });

  test("the same stretch is compared in January", () => {
    const january15 = new Date("2026-01-15T15:00:00.000Z");
    const sales = [
      sale({ paidOn: "2025-12-05", dollars: 100 }),
      sale({ paidOn: "2025-12-16", dollars: 999 }), // diciembre, después del día 15
      sale({ paidOn: "2026-01-10", dollars: 120 }),
    ];
    expect(computeKpis(sales, "thisMonth", january15).incomeUsdDeltaPct).toBe(20);
    // El 1 de enero del año anterior no tuvo ventas hasta el 15/1.
    expect(computeKpis(sales, "thisYear", january15).incomeUsdDeltaPct).toBeNull();
  });

  test("the same stretch is compared on a clamped day, leap years included", () => {
    const march31 = new Date("2026-03-31T15:00:00.000Z");
    const common = [
      sale({ paidOn: "2026-02-28", dollars: 100 }),
      sale({ paidOn: "2026-03-31", dollars: 150 }),
    ];
    expect(computeKpis(common, "thisMonth", march31).incomeUsdDeltaPct).toBe(50);

    // En 2028 febrero tiene 29 días: el 29/2 es del tramo anterior.
    const leap31 = new Date("2028-03-31T15:00:00.000Z");
    const leap = [
      sale({ paidOn: "2028-02-29", dollars: 100 }),
      sale({ paidOn: "2028-03-31", dollars: 300 }),
    ];
    expect(computeKpis(leap, "thisMonth", leap31).incomeUsdDeltaPct).toBe(200);

    // El 29/2/2028 contra el 1/1 al 28/2/2027.
    const leapDay = new Date("2028-02-29T15:00:00.000Z");
    const year = [
      sale({ paidOn: "2027-02-28", dollars: 100 }),
      sale({ paidOn: "2027-03-01", dollars: 999 }),
      sale({ paidOn: "2028-02-29", dollars: 200 }),
    ];
    expect(computeKpis(year, "thisYear", leapDay).incomeUsdDeltaPct).toBe(100);
  });

  test("a drop is a negative delta with one decimal", () => {
    const sales = [
      sale({ paidOn: "2026-09-10", dollars: 300 }),
      sale({ paidOn: "2026-10-02", dollars: 100 }),
    ];
    expect(computeKpis(sales, "thisMonth", NOW).incomeUsdDeltaPct).toBe(-66.7);

    const growth = [
      sale({ paidOn: "2026-09-10", dollars: 300 }),
      sale({ paidOn: "2026-10-02", dollars: 400 }),
    ];
    expect(computeKpis(growth, "thisMonth", NOW).incomeUsdDeltaPct).toBe(33.3);
  });

  test("the delta rounds half away from zero at one decimal", () => {
    const up = [
      sale({ paidOn: "2026-09-10", amountUsdMinor: 2000 }),
      sale({ paidOn: "2026-10-02", amountUsdMinor: 2001 }),
    ];
    const down = [
      sale({ paidOn: "2026-09-10", amountUsdMinor: 2000 }),
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
      sale({ paidOn: "2026-10-14", dollars: 640 }), // mañana: no cuenta en ningún período todavía
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
      sale({ paidOn: "2026-10-30", dollars: 80 }), // todavía no llegó: ni en la barra ni en la tarjeta
      sale({ paidOn: "2025-10-31", dollars: 160 }),
    ];
    const bars = monthlyIncome(sales, 12, NOW).reduce((total, month) => total + month.usdMinor, 0);
    expect(bars).toBe(7000);
    expect(computeKpis(sales, "last12", NOW).incomeUsdMinor).toBe(bars);
  });

  test("a sale dated in the future counts nowhere until that day", () => {
    const sales = [
      sale({ id: "today", paidOn: "2026-10-13", dollars: 10, item: "lesson", invoiceStatus: "pending" }),
      sale({ id: "tomorrow", paidOn: "2026-10-14", dollars: 640, item: "tournament", invoiceStatus: "pending" }),
      sale({ id: "next-month", paidOn: "2026-11-02", dollars: 640, item: "proSeason", invoiceStatus: "pending" }),
    ];
    const settings = { category: "A", annualCapArsMinor: 100_000_000, validFrom: "2026-08-01" };

    for (const period of ["thisMonth", "last30", "last12", "thisYear"] as const) {
      const kpis = computeKpis(sales, period, NOW);
      expect(kpis.incomeUsdMinor, period).toBe(1000);
      expect(kpis.salesCount, period).toBe(1);
      expect(incomeByItem(sales, periodRange(period, NOW)).map((row) => row.item), period).toEqual([
        "lesson",
      ]);
    }
    expect(monthlyIncome(sales, 12, NOW).at(-1)).toEqual({
      month: "2026-10",
      usdMinor: 1000,
      arsMinor: 1_500_000,
    });
    expect(itemsWithoutSales(sales, 90, NOW)).toEqual([
      "vodRecorded",
      "vodLive",
      "lessonPack",
      "gamePlan",
      "tournament",
      "proSeason",
    ]);
    expect(monotributoStatus(sales, settings, NOW).last12ArsMinor).toBe(1_500_000);
    expect(pendingWork(sales, NOW).uninvoiced).toEqual({
      count: 1,
      arsMinor: 1_500_000,
      usdMinor: 1000,
    });

    // Al día siguiente la venta de mañana ya es de hoy.
    const tomorrow = new Date("2026-10-14T15:00:00.000Z");
    expect(computeKpis(sales, "thisMonth", tomorrow).incomeUsdMinor).toBe(65_000);
    expect(itemsWithoutSales(sales, 90, tomorrow)).not.toContain("tournament");
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
