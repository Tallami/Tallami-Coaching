import { describe, expect, test } from "vitest";
import {
  groupUninvoicedByMonth,
  monthlyBilling,
  sumBilling,
  type MonthBilling,
} from "@/admin/billing/summary";
import { monthlyIncome } from "@/admin/metrics/series";
import { NOW, sale } from "../helpers/metric-sales";
import { saleRow } from "../helpers/sale-rows";

const EMPTY = { count: 0, arsMinor: 0, usdMinor: 0 };

function pesos(dollars: number): number {
  return dollars * 100 * 1500;
}

describe("monthlyBilling", () => {
  test("gives the last 12 months, oldest first, with empty months at zero", () => {
    const months = monthlyBilling([], 12, NOW);

    expect(months).toHaveLength(12);
    expect(months[0].month).toBe("2025-11");
    expect(months[11].month).toBe("2026-10");
    for (const month of months) {
      expect(month.collected).toEqual(EMPTY);
      expect(month.invoiced).toEqual(EMPTY);
      expect(month.notRequired).toEqual(EMPTY);
      expect(month.pending).toEqual(EMPTY);
    }
  });

  test("splits what was collected in a month into invoiced, not required and pending", () => {
    const months = monthlyBilling(
      [
        sale({ paidOn: "2026-10-02", dollars: 100, invoiceStatus: "issued" }),
        sale({ paidOn: "2026-10-03", dollars: 50, invoiceStatus: "issued" }),
        sale({ paidOn: "2026-10-04", dollars: 20, invoiceStatus: "not_required" }),
        sale({ paidOn: "2026-10-05", dollars: 40, invoiceStatus: "pending" }),
        sale({ paidOn: "2026-09-30", dollars: 10, invoiceStatus: "pending" }),
      ],
      12,
      NOW,
    );

    const october = months.find((month) => month.month === "2026-10") as MonthBilling;
    expect(october.collected).toEqual({ count: 4, arsMinor: pesos(210), usdMinor: 21000 });
    expect(october.invoiced).toEqual({ count: 2, arsMinor: pesos(150), usdMinor: 15000 });
    expect(october.notRequired).toEqual({ count: 1, arsMinor: pesos(20), usdMinor: 2000 });
    expect(october.pending).toEqual({ count: 1, arsMinor: pesos(40), usdMinor: 4000 });
    const september = months.find((month) => month.month === "2026-09") as MonthBilling;
    expect(september.collected).toEqual({ count: 1, arsMinor: pesos(10), usdMinor: 1000 });
    expect(september.pending.count).toBe(1);
  });

  test("assigns a sale to the month of its payment date, not the month it was invoiced", () => {
    const months = monthlyBilling(
      [sale({ paidOn: "2026-09-30", dollars: 30, invoiceStatus: "issued" })],
      12,
      NOW,
    );

    expect(months.find((month) => month.month === "2026-09")?.invoiced.count).toBe(1);
    expect(months.find((month) => month.month === "2026-10")?.invoiced.count).toBe(0);
  });

  test("a sale collected on the 31st stays in its month", () => {
    const months = monthlyBilling(
      [sale({ paidOn: "2026-08-31", dollars: 30 }), sale({ paidOn: "2026-09-01", dollars: 5 })],
      12,
      NOW,
    );

    expect(months.find((month) => month.month === "2026-08")?.collected.usdMinor).toBe(3000);
    expect(months.find((month) => month.month === "2026-09")?.collected.usdMinor).toBe(500);
  });

  test("leaves out sales that are not income, not dated yet or older than the window", () => {
    const months = monthlyBilling(
      [
        sale({ status: "pending", paidOn: null, invoiceStatus: "pending" }),
        sale({ status: "cancelled", paidOn: "2026-10-02" }),
        sale({ status: "refunded", paidOn: "2026-10-02" }),
        sale({ paidOn: "2026-10-14", invoiceStatus: "pending" }), // mañana: todavía no se cobró
        sale({ paidOn: "2026-11-02", invoiceStatus: "pending" }),
        sale({ paidOn: "2025-10-31", invoiceStatus: "pending" }), // antes de la ventana de 12 meses
      ],
      12,
      NOW,
    );

    for (const month of months) expect(month.collected).toEqual(EMPTY);
  });

  test("counts delivered sales as collected", () => {
    const months = monthlyBilling([sale({ status: "delivered", paidOn: "2026-10-05" })], 12, NOW);

    expect(months[11].collected.count).toBe(1);
  });

  test("its collected column is the monthly income of the overview", () => {
    const sales = [
      sale({ paidOn: "2026-10-02", dollars: 100, invoiceStatus: "issued" }),
      sale({ paidOn: "2026-10-04", dollars: 20, invoiceStatus: "not_required" }),
      sale({ paidOn: "2026-10-14", dollars: 77 }),
      sale({ paidOn: "2026-07-20", dollars: 45, invoiceStatus: "pending" }),
      sale({ status: "cancelled", paidOn: "2026-07-21", dollars: 99 }),
    ];

    const billing = monthlyBilling(sales, 12, NOW);
    const income = monthlyIncome(sales, 12, NOW);

    expect(billing.map((month) => [month.month, month.collected.arsMinor, month.collected.usdMinor])).toEqual(
      income.map((month) => [month.month, month.arsMinor, month.usdMinor]),
    );
  });

  test("every month adds up: collected = invoiced + not required + pending", () => {
    const sales = Array.from({ length: 40 }, (_, index) =>
      sale({
        paidOn: `2026-${String((index % 10) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
        dollars: index + 1,
        invoiceStatus: (["issued", "not_required", "pending"] as const)[index % 3],
      }),
    );

    for (const month of monthlyBilling(sales, 12, NOW)) {
      for (const key of ["count", "arsMinor", "usdMinor"] as const) {
        expect(month.collected[key]).toBe(
          month.invoiced[key] + month.notRequired[key] + month.pending[key],
        );
      }
    }
  });
});

describe("sumBilling", () => {
  test("adds the months up", () => {
    const months = monthlyBilling(
      [
        sale({ paidOn: "2026-10-02", dollars: 100, invoiceStatus: "issued" }),
        sale({ paidOn: "2026-08-04", dollars: 20, invoiceStatus: "pending" }),
      ],
      12,
      NOW,
    );

    const total = sumBilling(months);

    expect(total.collected).toEqual({ count: 2, arsMinor: pesos(120), usdMinor: 12000 });
    expect(total.invoiced).toEqual({ count: 1, arsMinor: pesos(100), usdMinor: 10000 });
    expect(total.notRequired).toEqual(EMPTY);
    expect(total.pending).toEqual({ count: 1, arsMinor: pesos(20), usdMinor: 2000 });
  });

  test("is zero without months", () => {
    expect(sumBilling([]).collected).toEqual(EMPTY);
  });
});

describe("groupUninvoicedByMonth", () => {
  test("groups by payment month, newest month first and newest sale first inside it", () => {
    const groups = groupUninvoicedByMonth([
      saleRow({ id: "a", paidOn: "2026-09-10" }),
      saleRow({ id: "b", paidOn: "2026-10-03" }),
      saleRow({ id: "c", paidOn: "2026-10-12" }),
      saleRow({ id: "d", paidOn: "2026-08-31" }),
    ]);

    expect(groups.map((group) => group.month)).toEqual(["2026-10", "2026-09", "2026-08"]);
    expect(groups[0].rows.map((row) => row.id)).toEqual(["c", "b"]);
  });

  test("totals each month in pesos and dollars and counts its sales", () => {
    const groups = groupUninvoicedByMonth([
      saleRow({ paidOn: "2026-10-03", amountArsMinor: 6_000_000, amountUsdMinor: 4000 }),
      saleRow({ paidOn: "2026-10-04", amountArsMinor: 1_234_567, amountUsdMinor: 823 }),
      saleRow({ paidOn: "2026-09-04", amountArsMinor: 100, amountUsdMinor: 1 }),
    ]);

    expect(groups[0]).toMatchObject({ count: 2, arsMinor: 7_234_567, usdMinor: 4823 });
    expect(groups[1]).toMatchObject({ count: 1, arsMinor: 100, usdMinor: 1 });
  });

  test("a sale collected at the end of the month stays in that month", () => {
    const groups = groupUninvoicedByMonth([saleRow({ paidOn: "2026-09-30" }), saleRow({ paidOn: "2026-10-01" })]);

    expect(groups.map((group) => [group.month, group.count])).toEqual([
      ["2026-10", 1],
      ["2026-09", 1],
    ]);
  });

  test("ignores sales without a payment date", () => {
    expect(groupUninvoicedByMonth([saleRow({ paidOn: null })])).toEqual([]);
  });

  test("is empty without sales", () => {
    expect(groupUninvoicedByMonth([])).toEqual([]);
  });
});
