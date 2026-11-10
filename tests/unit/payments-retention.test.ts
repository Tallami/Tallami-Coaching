import { beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { orders, proApplications, proPaymentLinks, sales, siteRequests } from "@/db/schema";
import { purgeExpiredRecords } from "@/payments/retention";
import { createProPaymentLink } from "@/pro/payment-links";
import { createTestDb } from "../helpers/db";
import { insertTestOrder } from "../helpers/orders";
import { insertTestCustomer, insertTestSale } from "../helpers/portal";

const NOW = new Date("2026-11-05T12:00:00.000-03:00");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function monthsAgo(months: number, extraDays = 0): Date {
  const date = new Date(NOW);
  date.setUTCMonth(date.getUTCMonth() - months);
  return new Date(date.getTime() - extraDays * DAY_MS);
}

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

async function remainingStatuses(): Promise<string[]> {
  return (await db.select({ status: orders.status }).from(orders)).map(({ status }) => status).sort();
}

describe("purgeExpiredRecords: orders", () => {
  test.each(["created", "pending", "rejected", "cancelled"] as const)("deletes a %s order of 91 days and keeps one of 89", async (status) => {
    await insertTestOrder(db, { status, createdAt: daysAgo(91) });
    await insertTestOrder(db, { status, createdAt: daysAgo(89) });

    await purgeExpiredRecords(db, NOW);

    expect(await db.select().from(orders)).toHaveLength(1);
    expect((await db.select().from(orders))[0].createdAt).toEqual(daysAgo(89));
  });

  test.each(["approved", "refunded", "charged_back"] as const)("never deletes a %s order, however old", async (status) => {
    await insertTestOrder(db, { status, createdAt: daysAgo(1000), providerPaymentId: `pay-${status}` });

    await purgeExpiredRecords(db, NOW);

    expect(await remainingStatuses()).toEqual([status]);
  });
});

describe("purgeExpiredRecords: public records", () => {
  test("deletes applications and site requests older than 24 months and keeps newer ones", async () => {
    await db.insert(proApplications).values([
      { name: "vieja", discord: "d", teamMembers: "t", results: "r", locale: "es", createdAt: monthsAgo(24, 1) },
      { name: "nueva", discord: "d", teamMembers: "t", results: "r", locale: "es", createdAt: monthsAgo(24, -1) },
    ]);
    await db.insert(siteRequests).values([
      { kind: "contact", code: "CON-AAAAAA", name: "vieja", email: "a@example.com", locale: "es", createdAt: monthsAgo(24, 1) },
      { kind: "contact", code: "CON-BBBBBB", name: "nueva", email: "b@example.com", locale: "es", createdAt: monthsAgo(24, -1) },
    ]);

    await purgeExpiredRecords(db, NOW);

    expect((await db.select().from(proApplications)).map(({ name }) => name)).toEqual(["nueva"]);
    expect((await db.select().from(siteRequests)).map(({ name }) => name)).toEqual(["nueva"]);
  });

  test("a paid link goes with its application and the sale stays", async () => {
    const [application] = await db
      .insert(proApplications)
      .values({ name: "vieja", discord: "d", teamMembers: "t", results: "r", locale: "es", createdAt: monthsAgo(25) })
      .returning();
    await createProPaymentLink(db, application.id, 250000, monthsAgo(25));
    const saleId = await insertTestSale(db, await insertTestCustomer(db), { item: "proSeason" });
    await insertTestOrder(db, { item: "proSeason", saleId, status: "approved", createdAt: monthsAgo(25) });

    await purgeExpiredRecords(db, NOW);

    expect(await db.select().from(proApplications)).toEqual([]);
    expect(await db.select().from(proPaymentLinks)).toEqual([]);
    expect(await db.select().from(sales)).toHaveLength(1);
    expect(await db.select().from(orders)).toHaveLength(1);
  });
});
