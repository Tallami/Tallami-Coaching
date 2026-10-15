import { describe, expect, test } from "vitest";
import { SALE_ITEMS, isDollarCurrency } from "@/admin/catalog";
import { DEMO_MONOTRIBUTO_SETTINGS, buildDemoData } from "@/admin/demo-data";
import { computeKpis } from "@/admin/metrics/kpis";
import { monotributoStatus } from "@/admin/metrics/monotributo";
import { pendingWork } from "@/admin/metrics/pending";
import { addDays, addMonths, firstOfMonth } from "@/admin/metrics/period";
import { itemsWithoutSales, monthlyIncome } from "@/admin/metrics/series";
import { isUuid } from "@/db/uuid";
import { arsToUsdMinor, convertToArsMinor } from "@/lib/money";
import { demoMetricSales } from "../helpers/demo";

/** Hoy en Argentina para los tests: mediodía, así el día no depende de la zona del runner. */
const TODAYS = ["2026-10-14", "2026-10-01", "2026-10-31", "2026-01-31", "2027-03-01", "2028-02-29"];
const noonOf = (today: string) => new Date(`${today}T15:00:00.000Z`);

describe("buildDemoData", () => {
  test("demo data is deterministic and leaves one item without recent sales", () => {
    for (const today of TODAYS) {
      const first = buildDemoData(today);
      const second = buildDemoData(today);
      expect(second, today).toEqual(first);
      expect(JSON.stringify(second), today).toBe(JSON.stringify(first));

      const metric = demoMetricSales(first);
      expect(itemsWithoutSales(metric, 90, noonOf(today)), today).toEqual(["proSeason"]);
    }
    expect(buildDemoData("2026-10-14")).not.toEqual(buildDemoData("2026-11-14"));
  });

  test("has about 25 clearly fictitious students and about 120 sales over 14 months", () => {
    for (const today of TODAYS) {
      const { customers, sales } = buildDemoData(today);
      expect(customers, today).toHaveLength(25);
      customers.forEach((customer, index) => {
        expect(customer.name).toBe(`Alumno de prueba ${index + 1}`);
      });
      expect(sales.length, today).toBeGreaterThanOrEqual(100);
      expect(sales.length, today).toBeLessThanOrEqual(135);

      const oldest = addMonths(firstOfMonth(today), -13);
      const days = sales.map((sale) => sale.paidOn).filter((day): day is string => Boolean(day));
      expect(days.every((day) => day >= oldest && day <= today), today).toBe(true);
      expect(days.sort()[0] <= addDays(oldest, 14), today).toBe(true);
    }
  });

  test("every sale points to a student that exists, with unique valid ids", () => {
    const { customers, sales } = buildDemoData("2026-10-14");
    const customerIds = new Set(customers.map((customer) => customer.id));
    expect(customerIds.size).toBe(customers.length);
    expect(new Set(sales.map((sale) => sale.id)).size).toBe(sales.length);
    for (const id of [...customerIds, ...sales.map((sale) => sale.id as string)]) {
      expect(isUuid(id), id).toBe(true);
    }
    expect(sales.every((sale) => customerIds.has(sale.customerId))).toBe(true);
  });

  test("covers every item, some cancelled, refunded and pending sales, and some without invoice", () => {
    for (const today of TODAYS) {
      const { sales } = buildDemoData(today);
      expect(new Set(sales.map((sale) => sale.item)), today).toEqual(new Set(SALE_ITEMS));
      for (const status of ["paid", "delivered", "pending", "cancelled", "refunded"]) {
        expect(
          sales.some((sale) => sale.status === status),
          `${today} ${status}`,
        ).toBe(true);
      }
      for (const invoiceStatus of ["pending", "issued", "not_required"]) {
        expect(
          sales.some((sale) => sale.invoiceStatus === invoiceStatus),
          `${today} ${invoiceStatus}`,
        ).toBe(true);
      }
      const work = pendingWork(demoMetricSales(buildDemoData(today)), noonOf(today));
      expect(work.uninvoiced.count, today).toBeGreaterThan(3);
    }
  });

  test("every row respects the rules the database enforces", () => {
    for (const today of TODAYS) {
      for (const sale of buildDemoData(today).sales) {
        const label = `${today} ${sale.id}`;
        if (["paid", "delivered", "refunded"].includes(sale.status)) {
          expect(sale.paidOn, label).toBeTruthy();
        }
        if (sale.item === "other") expect(sale.description?.trim(), label).toBeTruthy();
        if (sale.invoiceStatus === "issued") {
          expect(sale.invoiceType, label).toBeTruthy();
          expect(sale.invoiceNumber, label).toBeTruthy();
          expect(sale.invoicedOn, label).toBeTruthy();
        }
        expect(Number.isSafeInteger(sale.amountMinor) && sale.amountMinor > 0, label).toBe(true);
        expect(sale.arsPerUnit, label).toMatch(/^\d+\.\d{4}$/);
        expect(sale.arsPerUsd, label).toMatch(/^\d+\.\d{4}$/);
        expect(sale.rateSource, label).toBe("fixed");
      }
    }
  });

  test("the pesos and dollars of each sale agree with its amount and rates", () => {
    for (const sale of buildDemoData("2026-10-14").sales) {
      const ars = convertToArsMinor(sale.amountMinor, sale.arsPerUnit);
      expect(sale.amountArsMinor, sale.id).toBe(ars);
      const usd = isDollarCurrency(sale.currency as "USD") ? sale.amountMinor : arsToUsdMinor(ars, sale.arsPerUsd);
      expect(sale.amountUsdMinor, sale.id).toBe(usd);
    }
  });

  test("a pending sale never has a collection day, and a delivered one has its delivery", () => {
    for (const sale of buildDemoData("2026-10-14").sales) {
      if (sale.status === "pending") expect(sale.paidOn ?? null, sale.id).toBeNull();
      if (sale.status === "delivered") expect(sale.deliveredAt, sale.id).toBeInstanceOf(Date);
      if (sale.deliveredAt) expect(sale.dueAt, sale.id).toBeInstanceOf(Date);
    }
  });

  test("leaves work for every pending list: overdue deliveries, sessions, many sessions to mark", () => {
    for (const today of TODAYS) {
      const now = noonOf(today);
      const work = pendingWork(demoMetricSales(buildDemoData(today)), now);
      expect(work.deliveries.length, today).toBeGreaterThanOrEqual(3);
      expect(work.deliveries.some((delivery) => delivery.overdue), today).toBe(true);
      expect(work.deliveries.some((delivery) => !delivery.overdue && delivery.dueAt), today).toBe(true);
      expect(work.sessions.length, today).toBeGreaterThanOrEqual(3);
      expect(work.sessions.some((session) => session.unpaid), today).toBe(true);
      expect(work.sessions.some((session) => !session.unpaid), today).toBe(true);
      // Más de cinco, para ver "las primeras cinco y el resto".
      expect(work.toMark.length, today).toBeGreaterThan(5);
      expect(work.toMark.some((entry) => entry.unpaid), today).toBe(true);
      expect(work.toMark.some((entry) => !entry.unpaid), today).toBe(true);
      expect(work.toMark.some((entry) => entry.item === "lessonPack" || entry.item === "proSeason"), today).toBe(false);
    }
  });

  test("this month and the months before have income, new students and repeat ones", () => {
    for (const today of TODAYS) {
      const now = noonOf(today);
      const metric = demoMetricSales(buildDemoData(today));
      const months = monthlyIncome(metric, 12, now);
      expect(months).toHaveLength(12);
      expect(months.filter((month) => month.usdMinor > 0).length, today).toBeGreaterThanOrEqual(11);
      const last12 = computeKpis(metric, "last12", now);
      expect(last12.salesCount, today).toBeGreaterThan(80);
      expect(last12.newCustomers, today).toBeGreaterThan(10);
      expect(last12.repeatRatePct, today).toBeGreaterThan(0);
      expect(computeKpis(metric, "lastMonth", now).salesCount, today).toBeGreaterThan(3);
    }
  });

  test("the sample monotributo setting leaves the meter somewhere in the middle", () => {
    expect(DEMO_MONOTRIBUTO_SETTINGS.category).toMatch(/^[A-K]$/);
    for (const today of TODAYS) {
      const status = monotributoStatus(
        demoMetricSales(buildDemoData(today)),
        DEMO_MONOTRIBUTO_SETTINGS,
        noonOf(today),
      );
      expect(status.usedPct, today).toBeGreaterThan(30);
      expect(status.usedPct, today).toBeLessThan(85);
    }
  });
});
