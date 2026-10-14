import { count, eq } from "drizzle-orm";
import { beforeAll, describe, expect, test } from "vitest";
import { createCustomer } from "@/admin/customers/repository";
import type { SaleRates } from "@/admin/sales/rates";
import {
  CustomerNotFoundError,
  createSale,
  getSale,
  listSales,
  SaleNotFoundError,
  updateSale,
} from "@/admin/sales/repository";
import { saleInputSchema, type SaleInput } from "@/admin/sales/schema";
import type { Db } from "@/db/client";
import { customers, sales } from "@/db/schema";
import { createTestDb } from "../helpers/db";

type RawSale = Record<string, unknown>;

const RATES_1500: SaleRates = {
  arsPerUnit: "1500.0000",
  arsPerUsd: "1500.0000",
  source: "fixed",
  quotedOn: "2026-10-12",
};
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

/** Una venta de un alumno nuevo ya validada; cada test cambia solo lo que prueba. */
function input(overrides: RawSale = {}): SaleInput {
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

async function customerCount(db: Db): Promise<number> {
  const [row] = await db.select({ total: count() }).from(customers);
  return row.total;
}

describe("createSale", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  test("creates a USD sale with its ARS and USD values", async () => {
    const { id } = await createSale(db, input(), RATES_1500);

    expect(await getSale(db, id)).toMatchObject({
      id,
      customerName: "Ana",
      item: "lesson",
      currency: "USD",
      amountMinor: 4000,
      arsPerUnit: "1500.0000",
      arsPerUsd: "1500.0000",
      rateSource: "fixed",
      rateQuotedOn: "2026-10-12",
      amountArsMinor: 6_000_000,
      amountUsdMinor: 4000,
      paymentMethod: "transfer",
      status: "paid",
      paidOn: "2026-10-12",
      invoiceStatus: "pending",
      source: "manual",
    });
  });

  test("creates an ARS sale converting to USD", async () => {
    const rates: SaleRates = { ...RATES_1500, arsPerUnit: "1.0000" };

    const { id } = await createSale(db, input({ currency: "ARS", amount: "150.000,50" }), rates);

    expect(await getSale(db, id)).toMatchObject({
      currency: "ARS",
      amountMinor: 15_000_050,
      amountArsMinor: 15_000_050,
      // 150.000,50 / 1500 = 100,0003 -> USD 100,00
      amountUsdMinor: 10_000,
    });
  });

  test("converts a BRL sale through pesos, rounding half-up to the cent", async () => {
    const rates: SaleRates = { ...RATES_1500, arsPerUnit: "280.0000" };

    const { id } = await createSale(db, input({ currency: "BRL", amount: "100" }), rates);

    // R$ 100 x 280 = $ 28.000,00; / 1500 = USD 18,6666… -> 18,67
    expect(await getSale(db, id)).toMatchObject({
      amountMinor: 10_000,
      amountArsMinor: 2_800_000,
      amountUsdMinor: 1867,
    });
  });

  test("a USDT sale is worth its own amount in USD", async () => {
    const rates: SaleRates = { ...RATES_1500, arsPerUsd: "1517.3300", arsPerUnit: "1517.3300" };

    const { id } = await createSale(db, input({ currency: "USDT", amount: "45,10" }), rates);

    expect(await getSale(db, id)).toMatchObject({ amountUsdMinor: 4510, amountArsMinor: 6_843_158 });
  });

  test("keeps the manual source and the quote day exactly as given", async () => {
    const manual: SaleRates = {
      arsPerUnit: "1400.0000",
      arsPerUsd: "1400.0000",
      source: "manual",
      quotedOn: null,
    };

    const { id } = await createSale(db, input(), manual);

    expect(await getSale(db, id)).toMatchObject({ rateSource: "manual", rateQuotedOn: null });
  });

  test("creates the new student together with the sale", async () => {
    const before = await customerCount(db);

    const { id } = await createSale(
      db,
      input({ customer: { mode: "new", name: "Bea", discord: "bea#1", country: "br" } }),
      RATES_1500,
    );

    expect(await customerCount(db)).toBe(before + 1);
    expect(await getSale(db, id)).toMatchObject({
      customerName: "Bea",
      customerDiscord: "bea#1",
      customerCountry: "BR",
    });
  });

  test("links an existing student without creating another one", async () => {
    const { id: customerId } = await createCustomer(db, { name: "Caro", country: "MX" });
    const before = await customerCount(db);

    const { id } = await createSale(
      db,
      input({ customer: { mode: "existing", id: customerId } }),
      RATES_1500,
    );

    expect(await customerCount(db)).toBe(before);
    expect(await getSale(db, id)).toMatchObject({ customerId, customerName: "Caro" });
  });

  test("an unknown student is refused and nothing is saved", async () => {
    const before = await db.select({ total: count() }).from(sales);

    await expect(
      createSale(db, input({ customer: { mode: "existing", id: UNKNOWN_ID } }), RATES_1500),
    ).rejects.toBeInstanceOf(CustomerNotFoundError);

    expect((await db.select({ total: count() }).from(sales))[0].total).toBe(before[0].total);
  });

  test("a sale the database refuses leaves no orphan student behind", async () => {
    const before = await customerCount(db);
    // Cobrada sin fecha de cobro: la restricción de la base la rechaza.
    const refused: SaleInput = {
      ...input({ customer: { mode: "new", name: "Huérfano" } }),
      status: "paid",
      paidOn: undefined,
    };

    await expect(createSale(db, refused, RATES_1500)).rejects.toThrow();

    expect(await customerCount(db)).toBe(before);
  });

  test("a delivered sale gets its delivery time when none is given", async () => {
    const before = Date.now();

    const { id } = await createSale(db, input({ status: "delivered" }), RATES_1500);

    const sale = await getSale(db, id);
    expect(sale?.deliveredAt).toBeInstanceOf(Date);
    expect(sale?.deliveredAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(sale?.deliveredAt?.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test("keeps the delivery and due times that were typed, and none for an undelivered sale", async () => {
    const typed = await createSale(
      db,
      input({ status: "delivered", deliveredAt: "2026-10-13T10:00", dueAt: "2026-10-14T18:30" }),
      RATES_1500,
    );
    const undelivered = await createSale(db, input({ status: "paid" }), RATES_1500);

    expect(await getSale(db, typed.id)).toMatchObject({
      deliveredAt: new Date("2026-10-13T13:00:00Z"),
      dueAt: new Date("2026-10-14T21:30:00Z"),
    });
    expect((await getSale(db, undelivered.id))?.deliveredAt).toBeNull();
  });
});

describe("updateSale", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  test("recalculates the values and replaces the rate", async () => {
    const { id } = await createSale(db, input({ status: "pending", paidOn: "" }), RATES_1500);
    const manual: SaleRates = {
      arsPerUnit: "1400.0000",
      arsPerUsd: "1400.0000",
      source: "manual",
      quotedOn: null,
    };

    await updateSale(
      db,
      id,
      input({ amount: "50", status: "paid", paidOn: "2026-10-13", item: "gamePlan", notes: "ok" }),
      manual,
    );

    expect(await getSale(db, id)).toMatchObject({
      item: "gamePlan",
      amountMinor: 5000,
      amountArsMinor: 7_000_000,
      amountUsdMinor: 5000,
      arsPerUsd: "1400.0000",
      rateSource: "manual",
      rateQuotedOn: null,
      status: "paid",
      paidOn: "2026-10-13",
      notes: "ok",
    });
  });

  test("marks a sale as delivered and stamps the delivery time", async () => {
    const { id } = await createSale(db, input({ customer: { mode: "new", name: "Dani" } }), RATES_1500);

    await updateSale(db, id, input({ status: "delivered" }), RATES_1500);

    const sale = await getSale(db, id);
    expect(sale?.status).toBe("delivered");
    expect(sale?.deliveredAt).toBeInstanceOf(Date);
  });

  test("never touches the invoice data, the source or the creation time", async () => {
    const { id } = await createSale(db, input(), RATES_1500);
    await db
      .update(sales)
      .set({
        invoiceStatus: "issued",
        invoiceType: "C",
        invoiceNumber: "0001-00000007",
        invoicedOn: "2026-10-14",
        source: "mercadopago",
      })
      .where(eq(sales.id, id));
    const before = await getSale(db, id);

    await updateSale(db, id, input({ notes: "cambió la nota" }), RATES_1500);

    const after = await getSale(db, id);
    expect(after).toMatchObject({
      invoiceStatus: "issued",
      invoiceType: "C",
      invoiceNumber: "0001-00000007",
      invoicedOn: "2026-10-14",
      source: "mercadopago",
      notes: "cambió la nota",
    });
    expect(after?.createdAt).toEqual(before?.createdAt);
    expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime());
  });

  test("moves the sale to another or to a new student", async () => {
    const { id: other } = await createCustomer(db, { name: "Eli" });
    const { id } = await createSale(db, input({ customer: { mode: "new", name: "Fer" } }), RATES_1500);

    await updateSale(db, id, input({ customer: { mode: "existing", id: other } }), RATES_1500);
    expect(await getSale(db, id)).toMatchObject({ customerId: other, customerName: "Eli" });

    await updateSale(db, id, input({ customer: { mode: "new", name: "Gabi", country: "ar" } }), RATES_1500);
    expect(await getSale(db, id)).toMatchObject({ customerName: "Gabi", customerCountry: "AR" });
  });

  test("refuses an unknown sale and creates nothing for it", async () => {
    const before = await customerCount(db);

    await expect(
      updateSale(db, UNKNOWN_ID, input({ customer: { mode: "new", name: "Fantasma" } }), RATES_1500),
    ).rejects.toBeInstanceOf(SaleNotFoundError);

    expect(await customerCount(db)).toBe(before);
  });

  test("an update the database refuses changes nothing, not even the student", async () => {
    const { id } = await createSale(db, input({ customer: { mode: "new", name: "Hugo" } }), RATES_1500);
    const before = await customerCount(db);
    const refused: SaleInput = {
      ...input({ customer: { mode: "new", name: "Nuevo fallido" } }),
      status: "paid",
      paidOn: undefined,
    };

    await expect(updateSale(db, id, refused, RATES_1500)).rejects.toThrow();

    expect(await customerCount(db)).toBe(before);
    expect(await getSale(db, id)).toMatchObject({ customerName: "Hugo", paidOn: "2026-10-12" });
  });
});

describe("getSale", () => {
  test("answers null for an unknown id and for text that is not an id", async () => {
    const db = await createTestDb();

    expect(await getSale(db, UNKNOWN_ID)).toBeNull();
    expect(await getSale(db, "no-es-un-id")).toBeNull();
    expect(await getSale(db, "")).toBeNull();
  });
});

describe("listSales", () => {
  let db: Db;
  const ids: Record<string, string> = {};

  /** Crea una venta de un alumno ya cargado y la anota por nombre en `ids`. */
  async function add(tag: string, customerId: string, overrides: RawSale): Promise<void> {
    const rates: SaleRates = { ...RATES_1500, arsPerUnit: overrides.currency === "BRL" ? "280.0000" : "1500.0000" };
    const { id } = await createSale(
      db,
      input({ customer: { mode: "existing", id: customerId }, notes: tag, ...overrides }),
      rates,
    );
    ids[tag] = id;
  }

  async function tagsOf(filter: Parameters<typeof listSales>[1]): Promise<string[]> {
    const { rows } = await listSales(db, filter, 1, 100);
    return rows.map((row) => row.notes ?? "").sort();
  }

  beforeAll(async () => {
    db = await createTestDb();
    const ana = (await createCustomer(db, { name: "Ana Pérez", discord: "ana.fn", country: "AR" })).id;
    const bruno = (await createCustomer(db, { name: "Bruno Souza", discord: "Bruninho", country: "BR" })).id;
    const carla = (await createCustomer(db, { name: "Carla 100%", country: "MX" })).id;

    await add("s1", ana, { item: "lesson", paymentMethod: "transfer", status: "paid", paidOn: "2026-10-01" });
    await add("s2", ana, { item: "vodRecorded", paymentMethod: "paypal", status: "delivered", paidOn: "2026-10-05" });
    await add("s3", bruno, { item: "gamePlan", currency: "BRL", paymentMethod: "pix", status: "paid", paidOn: "2026-10-10" });
    await add("s4", carla, { item: "tournament", paymentMethod: "mercadopago", status: "pending", paidOn: "" });
    await add("s5", bruno, { item: "vodLive", paymentMethod: "transfer", status: "cancelled", paidOn: "2026-09-20" });
    await db
      .update(sales)
      .set({ invoiceStatus: "issued", invoiceType: "C", invoiceNumber: "0001-00000001", invoicedOn: "2026-10-06" })
      .where(eq(sales.id, ids.s2));
    await db.update(sales).set({ invoiceStatus: "not_required" }).where(eq(sales.id, ids.s3));
  });

  test("lists every sale with its student when there is no filter", async () => {
    const { rows, total } = await listSales(db, {}, 1);

    expect(total).toBe(5);
    expect(rows).toHaveLength(5);
    expect(rows.find((row) => row.notes === "s3")).toMatchObject({
      customerName: "Bruno Souza",
      customerDiscord: "Bruninho",
      customerCountry: "BR",
      currency: "BRL",
    });
  });

  test("filters by payment date, both ends included", async () => {
    expect(await tagsOf({ from: "2026-10-05" })).toEqual(["s2", "s3"]);
    expect(await tagsOf({ to: "2026-10-05" })).toEqual(["s1", "s2", "s5"]);
    expect(await tagsOf({ from: "2026-10-01", to: "2026-10-05" })).toEqual(["s1", "s2"]);
    expect(await tagsOf({ from: "2027-01-01" })).toEqual([]);
  });

  test("filters by item, status, payment method and invoice status", async () => {
    expect(await tagsOf({ item: "lesson" })).toEqual(["s1"]);
    expect(await tagsOf({ status: "pending" })).toEqual(["s4"]);
    expect(await tagsOf({ status: "delivered" })).toEqual(["s2"]);
    expect(await tagsOf({ paymentMethod: "pix" })).toEqual(["s3"]);
    expect(await tagsOf({ paymentMethod: "transfer" })).toEqual(["s1", "s5"]);
    expect(await tagsOf({ invoiceStatus: "issued" })).toEqual(["s2"]);
    expect(await tagsOf({ invoiceStatus: "not_required" })).toEqual(["s3"]);
    expect(await tagsOf({ invoiceStatus: "pending" })).toEqual(["s1", "s4", "s5"]);
  });

  test("searches the student's name or discord without caring about case", async () => {
    expect(await tagsOf({ q: "ANA" })).toEqual(["s1", "s2"]);
    expect(await tagsOf({ q: "pérez" })).toEqual(["s1", "s2"]);
    expect(await tagsOf({ q: "BRUNINHO" })).toEqual(["s3", "s5"]);
    expect(await tagsOf({ q: "  souza " })).toEqual(["s3", "s5"]);
    expect(await tagsOf({ q: "nadie" })).toEqual([]);
  });

  test("the search text is plain text: % and _ are not wildcards", async () => {
    expect(await tagsOf({ q: "100%" })).toEqual(["s4"]);
    expect(await tagsOf({ q: "%" })).toEqual(["s4"]);
    expect(await tagsOf({ q: "_" })).toEqual([]);
    expect(await tagsOf({ q: "a_a" })).toEqual([]);
  });

  test("combines every filter", async () => {
    expect(await tagsOf({ q: "ana", status: "paid", paymentMethod: "transfer", from: "2026-09-01" })).toEqual(["s1"]);
    expect(await tagsOf({ q: "bruno", item: "vodLive", invoiceStatus: "pending" })).toEqual(["s5"]);
    expect(await tagsOf({ q: "bruno", item: "lesson" })).toEqual([]);
  });

  test("the total counts the filtered sales, not just the page", async () => {
    const { rows, total } = await listSales(db, { q: "ana" }, 1, 1);

    expect(rows).toHaveLength(1);
    expect(total).toBe(2);
  });
});

describe("listSales ordering and paging", () => {
  let db: Db;

  async function addAt(tag: string, customerId: string, paidOn: string, createdAt: string): Promise<void> {
    const pending = paidOn === "";
    const { id } = await createSale(
      db,
      input({
        customer: { mode: "existing", id: customerId },
        notes: tag,
        status: pending ? "pending" : "paid",
        paidOn,
      }),
      RATES_1500,
    );
    await db.update(sales).set({ createdAt: new Date(createdAt) }).where(eq(sales.id, id));
  }

  beforeAll(async () => {
    db = await createTestDb();
    const { id } = await createCustomer(db, { name: "Ana" });
    await addAt("P1", id, "2026-10-12", "2026-10-12T10:00:00Z");
    await addAt("P2", id, "2026-10-11", "2026-10-11T10:00:00Z");
    await addAt("P3", id, "2026-10-11", "2026-10-11T11:00:00Z");
    await addAt("P4", id, "2026-10-01", "2026-10-01T10:00:00Z");
    await addAt("P5", id, "", "2026-10-14T10:00:00Z");
  });

  test("paginates newest first by paid_on then created_at", async () => {
    const page = async (number: number) =>
      (await listSales(db, {}, number, 2)).rows.map((row) => row.notes);

    // Sin fecha de cobro (todavía no cobrada) arriba; después, por fecha de cobro
    // y, a igual fecha, la cargada más tarde primero.
    expect(await page(1)).toEqual(["P5", "P1"]);
    expect(await page(2)).toEqual(["P3", "P2"]);
    expect(await page(3)).toEqual(["P4"]);
    expect(await page(4)).toEqual([]);
    expect((await listSales(db, {}, 4, 2)).total).toBe(5);
  });

  test("shows 25 sales per page by default", async () => {
    const [{ id: customerId }] = await db
      .select({ id: customers.id })
      .from(customers)
      .limit(1);
    const template = (await listSales(db, {}, 1, 1)).rows[0];
    const extra = Array.from({ length: 22 }, (_, index) => ({
      customerId,
      item: template.item,
      currency: template.currency,
      amountMinor: template.amountMinor,
      arsPerUnit: template.arsPerUnit,
      arsPerUsd: template.arsPerUsd,
      rateSource: template.rateSource,
      amountArsMinor: template.amountArsMinor,
      amountUsdMinor: template.amountUsdMinor,
      paymentMethod: template.paymentMethod,
      status: "paid",
      paidOn: "2026-09-15",
      notes: `extra ${index}`,
    }));
    await db.insert(sales).values(extra);

    const first = await listSales(db, {}, 1);
    const second = await listSales(db, {}, 2);

    expect(first.total).toBe(27);
    expect(first.rows).toHaveLength(25);
    expect(second.rows).toHaveLength(2);
  });

  test("a page below one is the first page", async () => {
    const zero = await listSales(db, {}, 0, 2);
    const negative = await listSales(db, {}, -3, 2);

    expect(zero.rows.map((row) => row.notes)).toEqual(["P5", "P1"]);
    expect(negative.rows.map((row) => row.notes)).toEqual(["P5", "P1"]);
  });
});
