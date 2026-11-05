import type { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { customers, orders, portalAccounts, sales } from "@/db/schema";
import { applyProviderPayment, type ApplyOutcome } from "@/payments/apply";
import type { PaymentStatus } from "@/payments/provider";
import { createTestDb } from "../helpers/db";
import { ORDER_ARS_MINOR, PAYMENT_ID, insertTestOrder, testPayment, type TestOrder } from "../helpers/orders";
import { insertTestAccount, insertTestCustomer } from "../helpers/portal";

/** La hora del aviso: el 5 de noviembre a las 22:00 en Argentina, ya el 6 en UTC. */
const NOW = new Date("2026-11-05T22:00:00.000-03:00");
const UNKNOWN_ORDER = "00000000-0000-4000-8000-000000000000";
const OTHER_PAYMENT_ID = "987654321";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

function apply(order: TestOrder, status: PaymentStatus = "approved", overrides: Parameters<typeof testPayment>[1] = {}) {
  return applyProviderPayment(db, "mercadopago", testPayment(order.id, { status, ...overrides }), NOW);
}

async function orderRow(id: string): Promise<TestOrder> {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row;
}

/** Un pedido ya aprobado, con su venta. */
async function approvedOrder(overrides: Parameters<typeof insertTestOrder>[1] = {}) {
  const order = await insertTestOrder(db, overrides);
  const outcome = await apply(order);
  if (outcome.kind !== "sale-created") throw new Error("El pedido de prueba no creó su venta.");
  return { order, saleId: outcome.saleId };
}

async function saleRow(id: string) {
  const [row] = await db.select().from(sales).where(eq(sales.id, id));
  return row;
}

describe("applyProviderPayment: an approved payment", () => {
  test("creates the student from an account without one, links the account and creates the sale", async () => {
    const accountId = await insertTestAccount(db, {
      provider: "discord",
      displayName: "Ana en Discord",
      email: "ana-cuenta@example.com",
      providerHandle: "ana_discord",
    });
    const order = await insertTestOrder(db, { accountId });

    const outcome = await apply(order);

    const [customer] = await db.select().from(customers);
    expect(customer).toMatchObject({
      name: "Ana en Discord",
      email: "ana-cuenta@example.com",
      discord: "ana_discord",
      country: "AR",
    });
    const [account] = await db.select().from(portalAccounts);
    expect(account.customerId).toBe(customer.id);

    const [sale] = await db.select().from(sales);
    expect(sale).toMatchObject({
      customerId: customer.id,
      item: "vodRecorded",
      currency: "ARS",
      amountMinor: ORDER_ARS_MINOR,
      amountArsMinor: ORDER_ARS_MINOR,
      arsPerUnit: "1.0000",
      arsPerUsd: "1500.0000",
      rateSource: "manual",
      rateQuotedOn: "2026-11-01",
      amountUsdMinor: 3000,
      paymentMethod: "mercadopago",
      status: "paid",
      paidOn: "2026-11-02",
      source: "mercadopago",
      invoiceStatus: "pending",
      dueAt: null,
    });

    expect(await orderRow(order.id)).toMatchObject({
      status: "approved",
      saleId: sale.id,
      providerPaymentId: PAYMENT_ID,
    });
    expect(outcome).toEqual({ kind: "sale-created", orderId: order.id, saleId: sale.id, status: "paid" });
  });

  test("a Google account has no Discord handle to copy to the student", async () => {
    const accountId = await insertTestAccount(db, { provider: "google", displayName: "Ana", providerHandle: null });

    await apply(await insertTestOrder(db, { accountId, buyerHandle: null }));

    const [customer] = await db.select().from(customers);
    expect(customer.discord).toBeNull();
  });

  test("uses the student of an account that is already linked and creates no other", async () => {
    const customerId = await insertTestCustomer(db, "Alumno de antes");
    const accountId = await insertTestAccount(db, { customerId });

    await apply(await insertTestOrder(db, { accountId }));

    expect(await db.select().from(customers)).toHaveLength(1);
    const [sale] = await db.select().from(sales);
    expect(sale.customerId).toBe(customerId);
  });

  test("creates the student from the copy in the order when the account was deleted", async () => {
    await apply(await insertTestOrder(db, { accountId: null }));

    const [customer] = await db.select().from(customers);
    expect(customer).toMatchObject({
      name: "Ana Compradora",
      email: "ana@example.com",
      discord: "ana_fn",
      country: "AR",
    });
    expect(await db.select().from(sales)).toHaveLength(1);
  });

  test("takes paidOn from the moment of the notice when the payment has no approval date", async () => {
    const order = await insertTestOrder(db);

    await apply(order, "approved", { approvedAt: null });

    const [sale] = await db.select().from(sales);
    expect(sale.paidOn).toBe("2026-11-05");
  });

  test("creates the sale even if the order already expired: the money was charged", async () => {
    const order = await insertTestOrder(db, { expiresAt: new Date("2026-11-02T00:00:00.000Z") });

    expect((await apply(order)).kind).toBe("sale-created");
  });

  test("two calls in a row make one sale, and the second is a no-change", async () => {
    const order = await insertTestOrder(db);

    await apply(order);
    const second = await apply(order);

    expect(second).toEqual({ kind: "no-change", orderId: order.id });
    expect(await db.select().from(sales)).toHaveLength(1);
  });

  test("two calls at once make one sale and one student, and only one of them says it created it", async () => {
    const accountId = await insertTestAccount(db);
    const order = await insertTestOrder(db, { accountId });

    const outcomes = await Promise.all([apply(order), apply(order)]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["no-change", "sale-created"]);
    expect(await db.select().from(sales)).toHaveLength(1);
    expect(await db.select().from(customers)).toHaveLength(1);
  });

  test("two different orders of the same unlinked account at once make one student and two sales", async () => {
    const accountId = await insertTestAccount(db);
    const first = await insertTestOrder(db, { accountId });
    const second = await insertTestOrder(db, { accountId, item: "gamePlan" });

    await Promise.all([
      apply(first, "approved", { providerPaymentId: "1001" }),
      apply(second, "approved", { providerPaymentId: "1002" }),
    ]);

    const students = await db.select().from(customers);
    expect(students).toHaveLength(1);
    const rows = await db.select().from(sales);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.customerId))).toEqual(new Set([students[0].id]));
  });

  test("locks the order and then the account with FOR NO KEY UPDATE, as `createInvite` explains", async () => {
    const queries: string[] = [];
    const logged = drizzle({
      client: (db as unknown as { $client: PGlite }).$client,
      schema,
      logger: { logQuery: (query) => void queries.push(query) },
    });
    const accountId = await insertTestAccount(db);
    const order = await insertTestOrder(db, { accountId });

    await applyProviderPayment(logged, "mercadopago", testPayment(order.id), NOW);

    const locks = queries.filter((query) => /\bfor\b[a-z ]*\bupdate\b/i.test(query));
    expect(locks).toHaveLength(2);
    expect(locks[0]).toMatch(/from "orders"/);
    expect(locks[1]).toMatch(/from "portal_accounts"/);
    for (const lock of locks) expect(lock).toMatch(/ for no key update$/i);
  });

  test("nothing stays half done if the sale cannot be created: no student, no link, the order as it was", async () => {
    const accountId = await insertTestAccount(db);
    // La base rechaza una venta de "otro" sin descripción: un fallo en el medio de la transacción.
    const order = await insertTestOrder(db, { accountId, item: "other" });

    await expect(apply(order)).rejects.toThrow();

    expect(await db.select().from(customers)).toEqual([]);
    const [account] = await db.select().from(portalAccounts);
    expect(account.customerId).toBeNull();
    expect(await orderRow(order.id)).toMatchObject({ status: "created", saleId: null, providerPaymentId: null });
  });
});

describe("applyProviderPayment: a payment that is not paid yet", () => {
  test.each(["pending", "rejected", "cancelled"] as const)("%s creates no sale and updates the order", async (status) => {
    const order = await insertTestOrder(db);

    const outcome = await apply(order, status, { approvedAt: null });

    expect(outcome).toEqual({ kind: "order-updated", orderId: order.id, status });
    expect(await db.select().from(sales)).toEqual([]);
    expect(await db.select().from(customers)).toEqual([]);
    expect(await orderRow(order.id)).toMatchObject({ status, saleId: null, providerPaymentId: PAYMENT_ID });
  });

  test("the same state twice is a no-change", async () => {
    const order = await insertTestOrder(db);

    await apply(order, "pending");

    expect(await apply(order, "pending")).toEqual({ kind: "no-change", orderId: order.id });
  });

  test("a pending payment that gets approved creates the sale", async () => {
    const order = await insertTestOrder(db);

    await apply(order, "pending");

    expect((await apply(order)).kind).toBe("sale-created");
    expect((await orderRow(order.id)).status).toBe("approved");
  });

  test.each(["pending", "rejected", "cancelled"] as const)(
    "%s read late never takes back an approved order",
    async (status) => {
      const { order, saleId } = await approvedOrder();

      expect(await apply(order, status)).toEqual({ kind: "no-change", orderId: order.id });

      expect((await orderRow(order.id)).status).toBe("approved");
      expect((await saleRow(saleId)).status).toBe("paid");
    },
  );
});

describe("applyProviderPayment: a payment that does not match its order", () => {
  test.each([
    ["amount", { amountMinor: ORDER_ARS_MINOR + 1 }],
    ["currency", { currency: "USD" }],
  ])("a different %s is a mismatch: no sale, the order stays unapproved", async (_name, overrides) => {
    const order = await insertTestOrder(db);

    const outcome = await apply(order, "approved", overrides);

    expect(outcome).toEqual({ kind: "mismatch", orderId: order.id });
    expect(await db.select().from(sales)).toEqual([]);
    expect(await db.select().from(customers)).toEqual([]);
    expect(await orderRow(order.id)).toMatchObject({ status: "created", saleId: null, providerPaymentId: null });
  });

  test("a refund with a different amount does not touch the sale", async () => {
    const { order, saleId } = await approvedOrder();

    const outcome = await apply(order, "refunded", { amountMinor: 1 });

    expect(outcome).toEqual({ kind: "mismatch", orderId: order.id });
    expect((await saleRow(saleId)).status).toBe("paid");
    expect((await orderRow(order.id)).status).toBe("approved");
  });

  test.each([
    ["null", null],
    ["inexistent", UNKNOWN_ORDER],
    ["not a UUID", "no-es-un-uuid"],
  ])("an order id that is %s is an unknown order", async (_name, orderId) => {
    const outcome = await applyProviderPayment(db, "mercadopago", testPayment(orderId), NOW);

    expect(outcome).toEqual({ kind: "unknown-order" });
    expect(await db.select().from(sales)).toEqual([]);
  });

  test("a payment already taken by another order is a mismatch, not a failure that repeats forever", async () => {
    await approvedOrder();
    const second = await insertTestOrder(db);

    const outcome = await apply(second);

    expect(outcome).toEqual({ kind: "mismatch", orderId: second.id });
    expect(await db.select().from(sales)).toHaveLength(1);
    expect((await orderRow(second.id)).providerPaymentId).toBeNull();
  });
});

// Una preferencia de Mercado Pago permite reintentar: un pedido puede tener varios pagos, y sus
// avisos pueden llegar en cualquier orden. `PAYMENT_ID` es el que se aprueba en cada caso.
describe("applyProviderPayment: several attempts on one order", () => {
  test("a rejected attempt and then an approved one: one sale, and the order points to the approved one", async () => {
    const order = await insertTestOrder(db);

    await apply(order, "rejected", { providerPaymentId: OTHER_PAYMENT_ID, approvedAt: null });
    const outcome = await apply(order);

    const rows = await db.select().from(sales);
    expect(rows).toHaveLength(1);
    expect(outcome).toEqual({ kind: "sale-created", orderId: order.id, saleId: rows[0].id, status: "paid" });
    expect(await orderRow(order.id)).toMatchObject({
      status: "approved",
      saleId: rows[0].id,
      providerPaymentId: PAYMENT_ID,
    });
  });

  test("a pending attempt and then an approved one: one sale", async () => {
    const order = await insertTestOrder(db);

    await apply(order, "pending", { providerPaymentId: OTHER_PAYMENT_ID, approvedAt: null });
    const outcome = await apply(order);

    expect(outcome.kind).toBe("sale-created");
    expect(await db.select().from(sales)).toHaveLength(1);
    expect(await orderRow(order.id)).toMatchObject({ status: "approved", providerPaymentId: PAYMENT_ID });
  });

  test.each(["rejected", "cancelled", "pending"] as const)(
    "a late %s from another attempt on an approved order is a no-change, and nothing is written",
    async (status) => {
      const { order, saleId } = await approvedOrder();
      const orderBefore = await orderRow(order.id);
      const saleBefore = await saleRow(saleId);

      const outcome = await apply(order, status, { providerPaymentId: OTHER_PAYMENT_ID, approvedAt: null });

      expect(outcome).toEqual({ kind: "no-change", orderId: order.id });
      // Filas enteras, con `updatedAt`: ni siquiera un `update` que deje lo mismo.
      expect(await orderRow(order.id)).toEqual(orderBefore);
      expect(await saleRow(saleId)).toEqual(saleBefore);
      expect(await db.select().from(sales)).toHaveLength(1);
    },
  );

  test("a late rejected attempt is a no-change even with another amount: it charged nothing", async () => {
    const { order, saleId } = await approvedOrder();
    const orderBefore = await orderRow(order.id);

    const outcome = await apply(order, "rejected", {
      providerPaymentId: OTHER_PAYMENT_ID,
      amountMinor: ORDER_ARS_MINOR + 1,
      approvedAt: null,
    });

    expect(outcome).toEqual({ kind: "no-change", orderId: order.id });
    expect(await orderRow(order.id)).toEqual(orderBefore);
    expect((await saleRow(saleId)).status).toBe("paid");
  });

  test.each(["refunded", "charged_back"] as const)(
    "a late rejected attempt is also a no-change on an order already %s",
    async (status) => {
      const { order } = await approvedOrder();
      await apply(order, status);
      const orderBefore = await orderRow(order.id);

      const outcome = await apply(order, "rejected", { providerPaymentId: OTHER_PAYMENT_ID, approvedAt: null });

      expect(outcome).toEqual({ kind: "no-change", orderId: order.id });
      expect(await orderRow(order.id)).toEqual(orderBefore);
    },
  );

  test.each(["approved", "partially_refunded", "refunded", "in_mediation", "charged_back"] as const)(
    "another payment that took money (%s) on an approved order is still a mismatch, without touching anything",
    async (status) => {
      const { order, saleId } = await approvedOrder();
      const orderBefore = await orderRow(order.id);
      const saleBefore = await saleRow(saleId);

      const outcome = await apply(order, status, { providerPaymentId: OTHER_PAYMENT_ID });

      expect(outcome).toEqual({ kind: "mismatch", orderId: order.id });
      expect(await orderRow(order.id)).toEqual(orderBefore);
      expect(await saleRow(saleId)).toEqual(saleBefore);
      expect(await db.select().from(sales)).toHaveLength(1);
    },
  );

  test("an attempt that was pending and then gets approved after another one: charged twice, so a mismatch", async () => {
    const order = await insertTestOrder(db);

    await apply(order, "pending", { providerPaymentId: OTHER_PAYMENT_ID, approvedAt: null });
    await apply(order);
    const outcome = await apply(order, "approved", { providerPaymentId: OTHER_PAYMENT_ID });

    expect(outcome).toEqual({ kind: "mismatch", orderId: order.id });
    expect(await db.select().from(sales)).toHaveLength(1);
    expect((await orderRow(order.id)).providerPaymentId).toBe(PAYMENT_ID);
  });
});

describe("applyProviderPayment: a refund", () => {
  test.each(["paid", "delivered"] as const)("turns a %s sale into refunded", async (status) => {
    const { order, saleId } = await approvedOrder();
    await db.update(sales).set({ status }).where(eq(sales.id, saleId));

    const outcome = await apply(order, "refunded");

    expect(outcome).toEqual({ kind: "sale-updated", orderId: order.id, saleId, change: "refunded" });
    const sale = await saleRow(saleId);
    expect(sale.status).toBe("refunded");
    expect(sale.paidOn).toBe("2026-11-02");
    expect((await orderRow(order.id)).status).toBe("refunded");
  });

  test("twice is a no-change", async () => {
    const { order } = await approvedOrder();

    await apply(order, "refunded");

    expect(await apply(order, "refunded")).toEqual({ kind: "no-change", orderId: order.id });
  });

  test.each(["refunded", "cancelled"] as const)(
    "a sale already marked %s by hand stays as it is, and the order is updated",
    async (status) => {
      const { order, saleId } = await approvedOrder();
      await db.update(sales).set({ status }).where(eq(sales.id, saleId));

      const outcome = await apply(order, "refunded");

      expect(outcome).toEqual({ kind: "order-updated", orderId: order.id, status: "refunded" });
      expect((await saleRow(saleId)).status).toBe(status);
      expect((await orderRow(order.id)).status).toBe("refunded");
    },
  );

  test("without a sale (the approval never arrived) creates one single sale, already refunded", async () => {
    const order = await insertTestOrder(db);

    const outcome = await apply(order, "refunded");

    const rows = await db.select().from(sales);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "refunded", paidOn: "2026-11-02" });
    expect(outcome).toEqual({ kind: "sale-created", orderId: order.id, saleId: rows[0].id, status: "refunded" });
    expect(await orderRow(order.id)).toMatchObject({
      status: "refunded",
      saleId: rows[0].id,
      providerPaymentId: PAYMENT_ID,
    });

    expect(await apply(order, "refunded")).toEqual({ kind: "no-change", orderId: order.id });
    expect(await db.select().from(sales)).toHaveLength(1);
  });

  test("without a sale and without an approval date takes paidOn from the moment of the notice", async () => {
    await apply(await insertTestOrder(db), "refunded", { approvedAt: null });

    const [sale] = await db.select().from(sales);
    expect(sale).toMatchObject({ status: "refunded", paidOn: "2026-11-05" });
  });

  test("an approval read late does not bring a refunded sale back", async () => {
    const { order, saleId } = await approvedOrder();
    await apply(order, "refunded");

    expect(await apply(order)).toEqual({ kind: "no-change", orderId: order.id });

    expect((await saleRow(saleId)).status).toBe("refunded");
    expect((await orderRow(order.id)).status).toBe("refunded");
  });
});

describe("applyProviderPayment: a partial refund", () => {
  test("the sale stays paid, with a new line in its notes", async () => {
    const { order, saleId } = await approvedOrder();
    await db.update(sales).set({ notes: "Nota de Tallami" }).where(eq(sales.id, saleId));

    const outcome = await apply(order, "partially_refunded");

    expect(outcome).toEqual({ kind: "sale-updated", orderId: order.id, saleId, change: "partial-refund" });
    const sale = await saleRow(saleId);
    expect(sale.status).toBe("paid");
    const lines = sale.notes?.split("\n") ?? [];
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Nota de Tallami");
    expect(lines[1]).toMatch(/reembolso parcial/i);
    expect(lines[1]).toContain(PAYMENT_ID);
    expect((await orderRow(order.id)).status).toBe("approved");
  });

  test("the same notice twice does not repeat the line", async () => {
    const { order, saleId } = await approvedOrder();

    await apply(order, "partially_refunded");
    const notes = (await saleRow(saleId)).notes;

    expect(await apply(order, "partially_refunded")).toEqual({ kind: "no-change", orderId: order.id });
    expect((await saleRow(saleId)).notes).toBe(notes);
  });

  test("without a sale creates it, paid and noted: that money was charged", async () => {
    const order = await insertTestOrder(db);

    const outcome = await apply(order, "partially_refunded");

    const [sale] = await db.select().from(sales);
    expect(sale.status).toBe("paid");
    expect(sale.notes).toMatch(/reembolso parcial/i);
    expect(outcome).toEqual({ kind: "sale-updated", orderId: order.id, saleId: sale.id, change: "partial-refund" });
    expect(await orderRow(order.id)).toMatchObject({ status: "approved", saleId: sale.id });
  });
});

describe("applyProviderPayment: a mediation", () => {
  test("leaves the sale as it is and says so", async () => {
    const { order, saleId } = await approvedOrder();
    const before = await saleRow(saleId);

    const outcome = await apply(order, "in_mediation");

    expect(outcome).toEqual({ kind: "sale-updated", orderId: order.id, saleId, change: "mediation" });
    const after = await saleRow(saleId);
    expect(after.status).toBe("paid");
    expect(after.notes).toBe(before.notes);
    expect((await orderRow(order.id)).status).toBe("approved");
  });

  test("without a sale creates it, paid, so that the alert has a sale to link to", async () => {
    const order = await insertTestOrder(db);

    const outcome = await apply(order, "in_mediation");

    const [sale] = await db.select().from(sales);
    expect(sale.status).toBe("paid");
    expect(outcome).toEqual({ kind: "sale-updated", orderId: order.id, saleId: sale.id, change: "mediation" });
  });

  test("read late on a refunded order changes nothing", async () => {
    const { order } = await approvedOrder();
    await apply(order, "refunded");

    expect(await apply(order, "in_mediation")).toEqual({ kind: "no-change", orderId: order.id });
  });
});

describe("applyProviderPayment: a chargeback", () => {
  test("turns the sale into refunded and the order into charged_back", async () => {
    const { order, saleId } = await approvedOrder();

    const outcome = await apply(order, "charged_back");

    expect(outcome).toEqual({ kind: "sale-updated", orderId: order.id, saleId, change: "charged-back" });
    expect((await saleRow(saleId)).status).toBe("refunded");
    expect((await orderRow(order.id)).status).toBe("charged_back");
  });

  test("twice is a no-change", async () => {
    const { order } = await approvedOrder();

    await apply(order, "charged_back");

    expect(await apply(order, "charged_back")).toEqual({ kind: "no-change", orderId: order.id });
  });

  test("on an order already refunded still moves the order and alerts, and a later refund changes nothing", async () => {
    const { order, saleId } = await approvedOrder();
    await apply(order, "refunded");

    const outcome = await apply(order, "charged_back");

    expect(outcome).toEqual({ kind: "sale-updated", orderId: order.id, saleId, change: "charged-back" });
    expect((await orderRow(order.id)).status).toBe("charged_back");
    expect(await apply(order, "refunded")).toEqual({ kind: "no-change", orderId: order.id });
    expect((await orderRow(order.id)).status).toBe("charged_back");
  });

  test("a sale cancelled by hand stays as it is", async () => {
    const { order, saleId } = await approvedOrder();
    await db.update(sales).set({ status: "cancelled" }).where(eq(sales.id, saleId));

    const outcome: ApplyOutcome = await apply(order, "charged_back");

    expect(outcome.kind).toBe("sale-updated");
    expect((await saleRow(saleId)).status).toBe("cancelled");
    expect((await orderRow(order.id)).status).toBe("charged_back");
  });

  test("without a sale and without an approval date creates it refunded, with paidOn from the moment of the notice", async () => {
    const order = await insertTestOrder(db);

    const outcome = await apply(order, "charged_back", { approvedAt: null });

    const rows = await db.select().from(sales);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "refunded", paidOn: "2026-11-05" });
    expect(outcome).toEqual({ kind: "sale-updated", orderId: order.id, saleId: rows[0].id, change: "charged-back" });
    expect(await orderRow(order.id)).toMatchObject({ status: "charged_back", saleId: rows[0].id });
  });
});
