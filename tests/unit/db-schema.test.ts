import { count, eq, getTableName } from "drizzle-orm";
import { beforeAll, describe, expect, test } from "vitest";
import { suggestedPriceUsd, type SaleItem } from "@/admin/catalog";
import type { Db } from "@/db/client";
import {
  customers,
  exchangeRates,
  loginAttempts,
  sales,
  settings,
} from "@/db/schema";
import { createTestDb } from "../helpers/db";

type NewSale = typeof sales.$inferInsert;

/** Una venta válida de un alumno; cada test cambia solo lo que prueba. */
function saleFor(customerId: string, overrides: Partial<NewSale> = {}): NewSale {
  return {
    customerId,
    item: "lesson",
    currency: "USD",
    amountMinor: 4000,
    arsPerUnit: "1500.0000",
    arsPerUsd: "1500.0000",
    rateSource: "manual",
    amountArsMinor: 6_000_000,
    amountUsdMinor: 4000,
    paymentMethod: "transfer",
    status: "pending",
    ...overrides,
  };
}

/** Nombre de la restricción que rechazó la consulta (la lleva el error de Postgres). */
async function violatedConstraint(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const pgError = (error as { cause?: { constraint?: string } }).cause ?? error;
    const { constraint } = pgError as { constraint?: string };
    if (constraint) return constraint;
    throw error;
  }
  throw new Error("La consulta no fue rechazada");
}

describe("database schema", () => {
  let db: Db;
  let customerId: string;

  beforeAll(async () => {
    db = await createTestDb();
    const [customer] = await db
      .insert(customers)
      .values({ name: "Alumno de prueba" })
      .returning({ id: customers.id });
    customerId = customer.id;
  });

  test("migrations create every table", async () => {
    // Si la migración no creó una tabla, su consulta falla con "no existe".
    const tables = [customers, sales, settings, exchangeRates, loginAttempts];

    for (const table of tables) {
      await expect(
        db.select({ rows: count() }).from(table),
        getTableName(table),
      ).resolves.toHaveLength(1);
    }
  });

  test("a valid sale can be stored and read back as numbers", async () => {
    const [stored] = await db
      .insert(sales)
      .values(saleFor(customerId, { status: "paid", paidOn: "2026-10-13" }))
      .returning();

    expect(stored.amountMinor).toBe(4000);
    expect(stored.amountArsMinor).toBe(6_000_000);
    expect(stored.arsPerUnit).toBe("1500.0000");
    expect(stored.paidOn).toBe("2026-10-13");
    expect(stored.invoiceStatus).toBe("pending");
    expect(stored.source).toBe("manual");
  });

  test("a sale needs a positive amount", async () => {
    const constraint = await violatedConstraint(
      db.insert(sales).values(saleFor(customerId, { amountMinor: 0 })),
    );

    expect(constraint).toBe("sales_amount_positive");
  });

  test("an 'other' sale needs a description", async () => {
    const withoutDescription = await violatedConstraint(
      db.insert(sales).values(saleFor(customerId, { item: "other" })),
    );
    const blankDescription = await violatedConstraint(
      db
        .insert(sales)
        .values(saleFor(customerId, { item: "other", description: "   " })),
    );

    expect(withoutDescription).toBe("sales_other_needs_description");
    expect(blankDescription).toBe("sales_other_needs_description");

    await expect(
      db
        .insert(sales)
        .values(saleFor(customerId, { item: "other", description: "Revisión de clip" })),
    ).resolves.toBeDefined();
  });

  test("a paid sale needs paid_on", async () => {
    for (const status of ["paid", "delivered", "refunded"] as const) {
      const constraint = await violatedConstraint(
        db.insert(sales).values(saleFor(customerId, { status })),
      );
      expect(constraint).toBe("sales_paid_needs_paid_on");
    }

    // Pendiente y cancelada todavía no tienen fecha de cobro.
    for (const status of ["pending", "cancelled"] as const) {
      await expect(
        db.insert(sales).values(saleFor(customerId, { status })),
      ).resolves.toBeDefined();
    }
  });

  test("an issued invoice needs type, number and date", async () => {
    const issued = { invoiceStatus: "issued" } as const;
    const complete = {
      invoiceType: "C",
      invoiceNumber: "0001-00000042",
      invoicedOn: "2026-10-13",
    } as const;

    for (const missing of ["invoiceType", "invoiceNumber", "invoicedOn"] as const) {
      const constraint = await violatedConstraint(
        db
          .insert(sales)
          .values(saleFor(customerId, { ...issued, ...complete, [missing]: null })),
      );
      expect(constraint).toBe("sales_issued_invoice_needs_data");
    }

    await expect(
      db.insert(sales).values(saleFor(customerId, { ...issued, ...complete })),
    ).resolves.toBeDefined();
  });

  test("the catalog columns reject values outside their lists", async () => {
    const badItem = await violatedConstraint(
      db.insert(sales).values(saleFor(customerId, { item: "nope" })),
    );
    const badCurrency = await violatedConstraint(
      db.insert(sales).values(saleFor(customerId, { currency: "EUR" })),
    );
    const badMethod = await violatedConstraint(
      db.insert(sales).values(saleFor(customerId, { paymentMethod: "barter" })),
    );
    const badStatus = await violatedConstraint(
      db.insert(sales).values(saleFor(customerId, { status: "lost" })),
    );
    const badRateSource = await violatedConstraint(
      db.insert(sales).values(saleFor(customerId, { rateSource: "guess" })),
    );
    const badInvoiceStatus = await violatedConstraint(
      db.insert(sales).values(saleFor(customerId, { invoiceStatus: "maybe" })),
    );
    const badInvoiceType = await violatedConstraint(
      db.insert(sales).values(saleFor(customerId, { invoiceType: "B" })),
    );

    expect([
      badItem,
      badCurrency,
      badMethod,
      badStatus,
      badRateSource,
      badInvoiceStatus,
      badInvoiceType,
    ]).toEqual([
      "sales_item_valid",
      "sales_currency_valid",
      "sales_payment_method_valid",
      "sales_status_valid",
      "sales_rate_source_valid",
      "sales_invoice_status_valid",
      "sales_invoice_type_valid",
    ]);
  });

  test("a customer with sales cannot be deleted", async () => {
    const [buyer] = await db
      .insert(customers)
      .values({ name: "Alumno con compras" })
      .returning({ id: customers.id });
    await db.insert(sales).values(saleFor(buyer.id));

    const constraint = await violatedConstraint(
      db.delete(customers).where(eq(customers.id, buyer.id)),
    );

    expect(constraint).toBe("sales_customer_id_customers_id_fk");
  });

  test("suggested prices come from the site catalog", () => {
    const expected: Record<SaleItem, number | null> = {
      vodRecorded: 30,
      vodLive: 45,
      lesson: 40,
      lessonPack: 140,
      gamePlan: 120,
      tournament: 150,
      proSeason: 2500,
      other: null,
    };

    for (const [item, price] of Object.entries(expected)) {
      expect(suggestedPriceUsd(item as SaleItem), item).toBe(price);
    }
  });
});
