import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { customers, deliveries, sales } from "@/db/schema";
import { REPLAY_CODES_MAX_LENGTH } from "@/payments/policy";
import { replayState, submitReplayCodes } from "@/payments/replay-codes";
import { addLinkDelivery } from "@/portal/deliveries";
import { createTestDb } from "../helpers/db";
import { insertTestCustomer, insertTestSale } from "../helpers/portal";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const NOW = new Date("2026-10-20T15:00:00.000Z");
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(deliveries);
  await db.delete(sales);
  await db.delete(customers);
});

async function saleRow(id: string) {
  const [row] = await db.select().from(sales).where(eq(sales.id, id));
  return row;
}

async function vodSale(overrides: Partial<typeof sales.$inferInsert> = {}) {
  const customerId = await insertTestCustomer(db, "Ana");
  const saleId = await insertTestSale(db, customerId, { item: "vodRecorded", paidOn: "2026-10-19", ...overrides });
  return { customerId, saleId };
}

describe("submitReplayCodes", () => {
  test("the first submission of a 3-game VOD saves the trimmed text and the time, and the delivery is due 72 hours later", async () => {
    const { customerId, saleId } = await vodSale();

    const result = await submitReplayCodes(db, { customerId, saleId, codes: "  ABC-123\nDEF-456  " }, NOW);

    const row = await saleRow(saleId);
    expect(result).toBe("saved");
    expect(row.replayCodes).toBe("ABC-123\nDEF-456");
    expect(row.replayCodesSentAt).toEqual(NOW);
    expect(row.dueAt).toEqual(new Date(NOW.getTime() + 72 * HOUR_MS));
  });

  test("a full tournament review is due 96 hours after the codes", async () => {
    const { customerId, saleId } = await vodSale({ item: "tournamentReview" });

    await submitReplayCodes(db, { customerId, saleId, codes: "ABC-123" }, NOW);

    expect((await saleRow(saleId)).dueAt).toEqual(new Date(NOW.getTime() + 96 * HOUR_MS));
  });

  test("correcting the codes keeps the due date and the time of the first submission", async () => {
    const { customerId, saleId } = await vodSale();
    await submitReplayCodes(db, { customerId, saleId, codes: "ABC-123" }, NOW);
    const first = await saleRow(saleId);

    const later = new Date(NOW.getTime() + 5 * HOUR_MS);
    const result = await submitReplayCodes(db, { customerId, saleId, codes: "XYZ-999" }, later);

    const row = await saleRow(saleId);
    expect(result).toBe("corrected");
    expect(row.replayCodes).toBe("XYZ-999");
    expect(row.dueAt).toEqual(first.dueAt);
    expect(row.replayCodesSentAt).toEqual(first.replayCodesSentAt);
  });

  test("is closed once a delivery was uploaded", async () => {
    const { customerId, saleId } = await vodSale();
    await addLinkDelivery(db, saleId, "Tu review", "https://example.com/review", NOW);

    expect(await submitReplayCodes(db, { customerId, saleId, codes: "ABC-123" }, NOW)).toBe("closed");
    expect((await saleRow(saleId)).replayCodes).toBeNull();
  });

  test("cannot be corrected once a delivery was uploaded", async () => {
    const { customerId, saleId } = await vodSale();
    await submitReplayCodes(db, { customerId, saleId, codes: "ABC-123" }, NOW);
    await addLinkDelivery(db, saleId, "Tu review", "https://example.com/review", NOW);

    expect(await submitReplayCodes(db, { customerId, saleId, codes: "XYZ-999" }, NOW)).toBe("closed");
    expect((await saleRow(saleId)).replayCodes).toBe("ABC-123");
  });

  test("another service, another student's sale and something that is not an id do not exist", async () => {
    const { customerId, saleId } = await vodSale();
    const gamePlan = await insertTestSale(db, customerId, { item: "gamePlan" });
    const other = await insertTestCustomer(db, "Beto");

    expect(await submitReplayCodes(db, { customerId, saleId: gamePlan, codes: "ABC" }, NOW)).toBe("not-found");
    expect(await submitReplayCodes(db, { customerId: other, saleId, codes: "ABC" }, NOW)).toBe("not-found");
    expect(await submitReplayCodes(db, { customerId, saleId: "no-es-un-id", codes: "ABC" }, NOW)).toBe("not-found");
    expect(await submitReplayCodes(db, { customerId: "no-es-un-id", saleId, codes: "ABC" }, NOW)).toBe("not-found");
    expect(await submitReplayCodes(db, { customerId, saleId: UNKNOWN_ID, codes: "ABC" }, NOW)).toBe("not-found");
    expect((await saleRow(saleId)).replayCodes).toBeNull();
  });

  test.each(["pending", "cancelled", "refunded", "delivered"] as const)("a %s sale is closed", async (status) => {
    const { customerId, saleId } = await vodSale({ status, paidOn: status === "pending" ? null : "2026-10-19" });

    expect(await submitReplayCodes(db, { customerId, saleId, codes: "ABC-123" }, NOW)).toBe("closed");
    expect((await saleRow(saleId)).replayCodes).toBeNull();
  });

  test("empty text, only spaces and more than the limit are invalid; the limit itself is fine", async () => {
    const { customerId, saleId } = await vodSale();

    expect(await submitReplayCodes(db, { customerId, saleId, codes: "" }, NOW)).toBe("invalid");
    expect(await submitReplayCodes(db, { customerId, saleId, codes: " \n\t " }, NOW)).toBe("invalid");
    expect(await submitReplayCodes(db, { customerId, saleId, codes: "a".repeat(REPLAY_CODES_MAX_LENGTH + 1) }, NOW)).toBe(
      "invalid",
    );
    expect((await saleRow(saleId)).replayCodes).toBeNull();
    expect(await submitReplayCodes(db, { customerId, saleId, codes: "a".repeat(REPLAY_CODES_MAX_LENGTH) }, NOW)).toBe(
      "saved",
    );
  });

  test("exactly 150 days after the payment day, without codes, it is closed; at 149 days it is open", async () => {
    const paidOn = "2026-05-01";
    const start = new Date("2026-05-01T03:00:00.000Z"); // 00:00 del 1/5 en Argentina
    const { customerId, saleId } = await vodSale({ paidOn });

    const closed = await submitReplayCodes(db, { customerId, saleId, codes: "ABC" }, new Date(start.getTime() + 150 * DAY_MS));
    const open = await submitReplayCodes(db, { customerId, saleId, codes: "ABC" }, new Date(start.getTime() + 149 * DAY_MS));

    expect(closed).toBe("closed");
    expect(open).toBe("saved");
  });

  test("two first submissions at once leave a single due date", async () => {
    const { customerId, saleId } = await vodSale();
    const later = new Date(NOW.getTime() + 2 * HOUR_MS);

    const results = await Promise.all([
      submitReplayCodes(db, { customerId, saleId, codes: "PRIMERO" }, NOW),
      submitReplayCodes(db, { customerId, saleId, codes: "SEGUNDO" }, later),
    ]);

    const row = await saleRow(saleId);
    expect([...results].sort()).toEqual(["corrected", "saved"]);
    const winner = results[0] === "saved" ? NOW : later;
    expect(row.replayCodesSentAt).toEqual(winner);
    expect(row.dueAt).toEqual(new Date(winner.getTime() + 72 * HOUR_MS));
  });
});

describe("replayState", () => {
  const base = {
    item: "vodRecorded",
    status: "paid",
    paidOn: "2026-10-19",
    dueAt: null,
    replayCodes: null,
    replayCodesSentAt: null,
  } as const;

  test("a paid VOD review without codes is open", () => {
    expect(replayState(base, 0, NOW)).toEqual({ state: "open" });
  });

  test("a service that has no replay codes has none", () => {
    expect(replayState({ ...base, item: "gamePlan" }, 0, NOW)).toEqual({ state: "none" });
    expect(replayState({ ...base, item: "vodLive" }, 0, NOW)).toEqual({ state: "none" });
  });

  test("a sale that is not paid and has no codes has none", () => {
    expect(replayState({ ...base, status: "pending", paidOn: null }, 0, NOW)).toEqual({ state: "none" });
    expect(replayState({ ...base, status: "refunded" }, 0, NOW)).toEqual({ state: "none" });
  });

  test("with codes it shows them, when the delivery is due, and lets the student correct them until a delivery is uploaded", () => {
    const sent = { ...base, replayCodes: "ABC-123", replayCodesSentAt: NOW, dueAt: new Date(NOW.getTime() + 72 * HOUR_MS) };

    expect(replayState(sent, 0, NOW)).toEqual({
      state: "sent",
      codes: "ABC-123",
      dueAt: "2026-10-23T15:00:00.000Z",
      editable: true,
    });
    expect(replayState(sent, 1, NOW)).toMatchObject({ state: "sent", editable: false });
    expect(replayState({ ...sent, status: "delivered" }, 0, NOW)).toMatchObject({ state: "sent", editable: false });
  });

  test("without codes and with a delivery already uploaded, there is nothing to ask for", () => {
    expect(replayState(base, 1, NOW)).toEqual({ state: "none" });
  });

  test("at exactly 150 days without codes it is expired; at 149 days it is open", () => {
    const start = new Date("2026-05-01T03:00:00.000Z");
    const old = { ...base, paidOn: "2026-05-01" };

    expect(replayState(old, 0, new Date(start.getTime() + 150 * DAY_MS))).toEqual({ state: "expired" });
    expect(replayState(old, 0, new Date(start.getTime() + 149 * DAY_MS))).toEqual({ state: "open" });
  });
});
