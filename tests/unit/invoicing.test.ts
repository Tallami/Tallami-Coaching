import { describe, expect, test } from "vitest";
import {
  InvalidInvoiceError,
  InvoiceNotAllowedError,
  MAX_INVOICE_BATCH,
  listUninvoicedSales,
  markInvoiceNotRequired,
  markInvoiced,
} from "@/admin/billing/invoicing";
import { sumMinor } from "@/admin/metrics/math";
import { loadMetricSales } from "@/admin/metrics/load";
import { pendingWork } from "@/admin/metrics/pending";
import { getSale } from "@/admin/sales/repository";
import type { Db } from "@/db/client";
import { createTestDb } from "../helpers/db";
import { seedSale } from "../helpers/sales-db";

/** Martes 13/10/2026, 15:00 en Argentina. */
const NOW = new Date("2026-10-13T18:00:00.000Z");
const INVOICE = { type: "C", number: "00003-00000045", issuedOn: "2026-10-13" } as const;
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

async function invoiceOf(db: Db, id: string) {
  const sale = await getSale(db, id);
  return {
    status: sale?.invoiceStatus,
    type: sale?.invoiceType,
    number: sale?.invoiceNumber,
    on: sale?.invoicedOn,
  };
}

const PENDING_INVOICE = { status: "pending", type: null, number: null, on: null };

describe("markInvoiced", () => {
  test("markInvoiced requires paid sales with a pending invoice", async () => {
    const db = await createTestDb();
    const paid = await seedSale(db, { status: "paid" });
    const delivered = await seedSale(db, { status: "delivered" });

    const result = await markInvoiced(db, [paid, delivered], INVOICE, NOW);

    expect(result).toEqual({ updated: 2 });
    for (const id of [paid, delivered]) {
      expect(await invoiceOf(db, id)).toEqual({
        status: "issued",
        type: "C",
        number: "00003-00000045",
        on: "2026-10-13",
      });
    }
  });

  test.each([
    ["a sale that was never collected", { status: "pending", paidOn: "" }],
    ["a cancelled sale", { status: "cancelled", paidOn: "" }],
    ["a cancelled sale that has a payment date", { status: "cancelled", paidOn: "2026-10-05" }],
    ["a refunded sale", { status: "refunded", paidOn: "2026-10-05" }],
    ["a sale whose payment date is tomorrow", { status: "paid", paidOn: "2026-10-14" }],
    ["a sale collected next year", { status: "delivered", paidOn: "2027-01-02" }],
  ])("rejects %s and changes nothing", async (_label, overrides) => {
    const db = await createTestDb();
    const id = await seedSale(db, overrides);

    const attempt = markInvoiced(db, [id], INVOICE, NOW);

    await expect(attempt).rejects.toBeInstanceOf(InvoiceNotAllowedError);
    expect(await invoiceOf(db, id)).toEqual(PENDING_INVOICE);
  });

  test("a sale collected today is allowed", async () => {
    const db = await createTestDb();
    const id = await seedSale(db, { paidOn: "2026-10-13" });

    await expect(markInvoiced(db, [id], INVOICE, NOW)).resolves.toEqual({ updated: 1 });
  });

  test("rejects a sale that already has an invoice, or that was marked as not required", async () => {
    const db = await createTestDb();
    const invoiced = await seedSale(db);
    await markInvoiced(db, [invoiced], { ...INVOICE, number: "00003-00000001" }, NOW);
    const notRequired = await seedSale(db);
    await markInvoiceNotRequired(db, [notRequired], NOW);

    for (const id of [invoiced, notRequired]) {
      await expect(markInvoiced(db, [id], INVOICE, NOW)).rejects.toBeInstanceOf(InvoiceNotAllowedError);
    }
    // Lo que ya estaba facturado no se pisa con otro número.
    expect((await invoiceOf(db, invoiced)).number).toBe("00003-00000001");
  });

  test("rejects an id that does not exist", async () => {
    const db = await createTestDb();

    await expect(markInvoiced(db, [UNKNOWN_ID], INVOICE, NOW)).rejects.toBeInstanceOf(
      InvoiceNotAllowedError,
    );
  });

  test("the whole batch is all-or-nothing: one wrong sale leaves the valid ones untouched", async () => {
    const db = await createTestDb();
    const good = await seedSale(db);
    const alsoGood = await seedSale(db, { status: "delivered" });
    const cancelled = await seedSale(db, { status: "cancelled", paidOn: "" });

    const attempt = markInvoiced(db, [good, cancelled, alsoGood], INVOICE, NOW);

    await expect(attempt).rejects.toBeInstanceOf(InvoiceNotAllowedError);
    await expect(attempt).rejects.toMatchObject({
      message: expect.stringContaining("No se cambió ninguna"),
    });
    for (const id of [good, alsoGood, cancelled]) {
      expect(await invoiceOf(db, id)).toEqual(PENDING_INVOICE);
    }
  });

  test("a batch with an unknown id also leaves the valid ones untouched", async () => {
    const db = await createTestDb();
    const good = await seedSale(db);

    await expect(markInvoiced(db, [good, UNKNOWN_ID], INVOICE, NOW)).rejects.toBeInstanceOf(
      InvoiceNotAllowedError,
    );
    expect(await invoiceOf(db, good)).toEqual(PENDING_INVOICE);
  });

  test("trims the number, drops NUL characters and counts a repeated id once", async () => {
    const db = await createTestDb();
    const id = await seedSale(db);

    const result = await markInvoiced(
      db,
      [id, id],
      { type: "E", number: "  0001-0000002\u0000  ", issuedOn: "2026-10-12" },
      NOW,
    );

    expect(result).toEqual({ updated: 1 });
    expect(await invoiceOf(db, id)).toEqual({
      status: "issued",
      type: "E",
      number: "0001-0000002",
      on: "2026-10-12",
    });
  });

  test("one invoice can cover several sales: the number is not unique", async () => {
    const db = await createTestDb();
    const first = await seedSale(db);
    const second = await seedSale(db);

    await markInvoiced(db, [first], INVOICE, NOW);
    await markInvoiced(db, [second], INVOICE, NOW);

    expect((await invoiceOf(db, first)).number).toBe((await invoiceOf(db, second)).number);
  });

  test("the invoice date is only checked for being a real, plausible day: it may come before the payment", async () => {
    const db = await createTestDb();
    const id = await seedSale(db, { paidOn: "2026-10-12" });

    await expect(
      markInvoiced(db, [id], { ...INVOICE, issuedOn: "2026-10-01" }, NOW),
    ).resolves.toEqual({ updated: 1 });
    expect((await invoiceOf(db, id)).on).toBe("2026-10-01");
  });

  test.each([
    ["a blank number", { number: "   " }, "number"],
    ["a number that is only a NUL character", { number: "\u0000" }, "number"],
    ["a number that is too long", { number: "1".repeat(31) }, "number"],
    ["an unknown invoice type", { type: "A" }, "type"],
    ["a missing invoice type", { type: undefined }, "type"],
    ["a date that does not exist", { issuedOn: "2026-02-30" }, "issuedOn"],
    ["a date from the year 26", { issuedOn: "0026-10-13" }, "issuedOn"],
    ["a date before 2000", { issuedOn: "1999-12-31" }, "issuedOn"],
    ["a date after 2100", { issuedOn: "2101-01-01" }, "issuedOn"],
    ["a blank date", { issuedOn: "" }, "issuedOn"],
    ["a date in another format", { issuedOn: "13/10/2026" }, "issuedOn"],
  ])("rejects %s with a message for that field and changes nothing", async (_label, change, field) => {
    const db = await createTestDb();
    const id = await seedSale(db);

    const attempt = markInvoiced(db, [id], { ...INVOICE, ...change } as never, NOW);

    await expect(attempt).rejects.toBeInstanceOf(InvalidInvoiceError);
    await expect(attempt).rejects.toMatchObject({ fieldErrors: { [field]: expect.any(String) } });
    expect(await invoiceOf(db, id)).toEqual(PENDING_INVOICE);
  });

  test("asks to choose at least one sale", async () => {
    const db = await createTestDb();

    const attempt = markInvoiced(db, [], INVOICE, NOW);

    await expect(attempt).rejects.toBeInstanceOf(InvalidInvoiceError);
    await expect(attempt).rejects.toMatchObject({
      fieldErrors: { ids: "Elegí al menos una venta." },
    });
  });

  test.each([
    ["an id that is not a uuid", ["no-es-un-id"]],
    ["an id with SQL in it", ["x'; drop table sales; --"]],
    ["an empty id", [""]],
    ["an id with a NUL character", ["00000000-0000-4000-8000-00000000000\u0000"]],
  ])("rejects %s before it reaches the database", async (_label, ids) => {
    const db = await createTestDb();
    const good = await seedSale(db);

    const attempt = markInvoiced(db, [good, ...ids], INVOICE, NOW);

    await expect(attempt).rejects.toBeInstanceOf(InvalidInvoiceError);
    await expect(attempt).rejects.toMatchObject({ fieldErrors: { ids: expect.any(String) } });
    expect(await invoiceOf(db, good)).toEqual(PENDING_INVOICE);
  });

  test("rejects a batch bigger than the screen can show", async () => {
    const db = await createTestDb();
    const ids = Array.from({ length: MAX_INVOICE_BATCH + 1 }, (_, index) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );

    await expect(markInvoiced(db, ids, INVOICE, NOW)).rejects.toBeInstanceOf(InvalidInvoiceError);
  });

  test("does not touch the payment or the amounts", async () => {
    const db = await createTestDb();
    const id = await seedSale(db);
    const before = await getSale(db, id);

    await markInvoiced(db, [id], INVOICE, NOW);

    const after = await getSale(db, id);
    expect(after).toMatchObject({
      status: before?.status,
      paidOn: before?.paidOn,
      amountMinor: before?.amountMinor,
      amountArsMinor: before?.amountArsMinor,
      amountUsdMinor: before?.amountUsdMinor,
    });
  });
});

describe("markInvoiceNotRequired", () => {
  test("marks collected sales with a pending invoice as not requiring one", async () => {
    const db = await createTestDb();
    const paid = await seedSale(db);
    const delivered = await seedSale(db, { status: "delivered" });

    const result = await markInvoiceNotRequired(db, [paid, delivered], NOW);

    expect(result).toEqual({ updated: 2 });
    for (const id of [paid, delivered]) {
      expect(await invoiceOf(db, id)).toEqual({
        status: "not_required",
        type: null,
        number: null,
        on: null,
      });
    }
  });

  test.each([
    ["a sale that was never collected", { status: "pending", paidOn: "" }],
    ["a cancelled sale", { status: "cancelled", paidOn: "" }],
    ["a refunded sale", { status: "refunded", paidOn: "2026-10-05" }],
    ["a sale whose payment date is tomorrow", { status: "paid", paidOn: "2026-10-14" }],
  ])("rejects %s and changes nothing", async (_label, overrides) => {
    const db = await createTestDb();
    const id = await seedSale(db, overrides);

    await expect(markInvoiceNotRequired(db, [id], NOW)).rejects.toBeInstanceOf(InvoiceNotAllowedError);
    expect(await invoiceOf(db, id)).toEqual(PENDING_INVOICE);
  });

  test("rejects a sale that is already invoiced and keeps its invoice", async () => {
    const db = await createTestDb();
    const id = await seedSale(db);
    await markInvoiced(db, [id], INVOICE, NOW);

    await expect(markInvoiceNotRequired(db, [id], NOW)).rejects.toBeInstanceOf(InvoiceNotAllowedError);
    expect((await invoiceOf(db, id)).status).toBe("issued");
  });

  test("is all-or-nothing too", async () => {
    const db = await createTestDb();
    const good = await seedSale(db);
    const future = await seedSale(db, { paidOn: "2026-10-20" });

    await expect(markInvoiceNotRequired(db, [good, future], NOW)).rejects.toBeInstanceOf(
      InvoiceNotAllowedError,
    );
    expect(await invoiceOf(db, good)).toEqual(PENDING_INVOICE);
  });

  test("asks to choose at least one sale and rejects ids that are not uuids", async () => {
    const db = await createTestDb();

    await expect(markInvoiceNotRequired(db, [], NOW)).rejects.toMatchObject({
      fieldErrors: { ids: "Elegí al menos una venta." },
    });
    await expect(markInvoiceNotRequired(db, ["__proto__"], NOW)).rejects.toBeInstanceOf(
      InvalidInvoiceError,
    );
  });

});

describe("listUninvoicedSales", () => {
  test("lists only collected sales with a pending invoice that are already dated, newest first", async () => {
    const db = await createTestDb();
    const oldest = await seedSale(db, { paidOn: "2026-08-03" });
    const newest = await seedSale(db, { paidOn: "2026-10-13" });
    const middle = await seedSale(db, { status: "delivered", paidOn: "2026-09-15" });
    await seedSale(db, { paidOn: "2026-10-14" }); // todavía no se cobró
    await seedSale(db, { status: "pending", paidOn: "" });
    await seedSale(db, { status: "cancelled", paidOn: "" });
    await seedSale(db, { status: "refunded", paidOn: "2026-10-01" });
    const invoiced = await seedSale(db, { paidOn: "2026-10-02" });
    await markInvoiced(db, [invoiced], INVOICE, NOW);
    const notRequired = await seedSale(db, { paidOn: "2026-10-03" });
    await markInvoiceNotRequired(db, [notRequired], NOW);

    const { rows, truncated } = await listUninvoicedSales(db, NOW);

    expect(rows.map((row) => row.id)).toEqual([newest, middle, oldest]);
    expect(truncated).toBe(false);
    expect(rows[0]).toMatchObject({ customerName: expect.stringContaining("Alumno de prueba"), item: "lesson" });
  });

  test("its totals are the ones the overview shows as pending to invoice", async () => {
    const db = await createTestDb();
    await seedSale(db, { paidOn: "2026-10-05", amount: "40" });
    await seedSale(db, { paidOn: "2026-09-30", amount: "120.5", currency: "USD" });
    await seedSale(db, { paidOn: "2026-10-14" });
    await seedSale(db, { status: "cancelled", paidOn: "" });
    const invoiced = await seedSale(db, { paidOn: "2026-10-02" });
    await markInvoiced(db, [invoiced], INVOICE, NOW);

    const { rows } = await listUninvoicedSales(db, NOW);
    const overview = pendingWork(await loadMetricSales(db, NOW), NOW).uninvoiced;

    expect({
      count: rows.length,
      arsMinor: sumMinor(rows.map((row) => row.amountArsMinor)),
      usdMinor: sumMinor(rows.map((row) => row.amountUsdMinor)),
    }).toEqual(overview);
    expect(overview.count).toBe(2);
  });

  test("marks the list as cut when there are more sales than the limit, keeping the newest", async () => {
    const db = await createTestDb();
    await seedSale(db, { paidOn: "2026-10-01" });
    const second = await seedSale(db, { paidOn: "2026-10-02" });
    const third = await seedSale(db, { paidOn: "2026-10-03" });

    const { rows, truncated } = await listUninvoicedSales(db, NOW, 2);

    expect(rows.map((row) => row.id)).toEqual([third, second]);
    expect(truncated).toBe(true);
  });

  test("is empty without sales", async () => {
    expect(await listUninvoicedSales(await createTestDb(), NOW)).toEqual({ rows: [], truncated: false });
  });
});
