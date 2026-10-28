import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { customers, portalAccounts, portalInvites } from "@/db/schema";
import { SITE_URL } from "@/lib/site-url";
import { accountForCustomer } from "@/portal/accounts";
import { createInvite, inviteUrl, redeemInvite } from "@/portal/invites";
import { PORTAL_INVITE_MS } from "@/portal/policy";
import { createTestDb } from "../helpers/db";
import { insertTestAccount, insertTestCustomer } from "../helpers/portal";

const START = new Date("2026-10-28T10:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const URL_SAFE_32_BYTES = /^[A-Za-z0-9_-]{43}$/;

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(portalAccounts);
  await db.delete(customers); // las invitaciones se van con su alumno (on delete cascade)
});

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("createInvite", () => {
  test("returns a token of 32 random bytes in base64url, different every time", async () => {
    const customerId = await insertTestCustomer(db);

    const first = await createInvite(db, customerId, START);
    const second = await createInvite(db, customerId, START);

    expect(first).toMatch(URL_SAFE_32_BYTES);
    expect(second).toMatch(URL_SAFE_32_BYTES);
    expect(second).not.toBe(first);
  });

  test("expires 14 days after it was created and is unused", async () => {
    const customerId = await insertTestCustomer(db);

    await createInvite(db, customerId, START);

    const [invite] = await db.select().from(portalInvites);
    expect(PORTAL_INVITE_MS).toBe(14 * DAY_MS);
    expect(invite).toMatchObject({ customerId, usedAt: null, usedByAccountId: null });
    expect(invite.createdAt).toEqual(START);
    expect(invite.expiresAt).toEqual(new Date(START.getTime() + 14 * DAY_MS));
  });

  test("does not keep the token in the clear: only its SHA-256 is in the database", async () => {
    const customerId = await insertTestCustomer(db);

    const token = await createInvite(db, customerId, START);

    const rows = await db.select().from(portalInvites);
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(sha256Hex(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test("a new invite voids the unused one of the same student, and leaves other students alone", async () => {
    const ana = await insertTestCustomer(db, "Ana");
    const beto = await insertTestCustomer(db, "Beto");
    const anaOld = await createInvite(db, ana, START);
    const betoToken = await createInvite(db, beto, START);

    const anaNew = await createInvite(db, ana, START);

    expect(await db.select().from(portalInvites).where(eq(portalInvites.customerId, ana))).toHaveLength(1);
    expect(await redeemInvite(db, anaOld, await insertTestAccount(db), START)).toBe("invalid");
    expect(await redeemInvite(db, anaNew, await insertTestAccount(db), START)).toBe("linked");
    expect(await redeemInvite(db, betoToken, await insertTestAccount(db), START)).toBe("linked");
  });

  test("a new invite keeps the record of one that was already used", async () => {
    const customerId = await insertTestCustomer(db);
    const accountId = await insertTestAccount(db);
    const used = await createInvite(db, customerId, START);
    await redeemInvite(db, used, accountId, START);

    await createInvite(db, customerId, START);

    const rows = await db.select().from(portalInvites).where(eq(portalInvites.customerId, customerId));
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.usedAt !== null)).toHaveLength(1);
  });

  test("fails for a student that does not exist, without leaving anything behind", async () => {
    await expect(createInvite(db, "00000000-0000-4000-8000-000000000000", START)).rejects.toThrow();

    expect(await db.select().from(portalInvites)).toEqual([]);
  });
});

describe("redeemInvite", () => {
  test("links the account to the student of the invite and marks the invite as used by that account", async () => {
    const customerId = await insertTestCustomer(db);
    const accountId = await insertTestAccount(db);
    const token = await createInvite(db, customerId, START);
    const later = new Date(START.getTime() + 60_000);

    const result = await redeemInvite(db, token, accountId, later);

    expect(result).toBe("linked");
    expect((await accountForCustomer(db, customerId))?.id).toBe(accountId);
    const [invite] = await db.select().from(portalInvites);
    expect(invite.usedAt).toEqual(later);
    expect(invite.usedByAccountId).toBe(accountId);
  });

  test("works only once: the second time is invalid, even for the same account", async () => {
    const customerId = await insertTestCustomer(db);
    const accountId = await insertTestAccount(db);
    const token = await createInvite(db, customerId, START);

    expect(await redeemInvite(db, token, accountId, START)).toBe("linked");
    expect(await redeemInvite(db, token, accountId, START)).toBe("invalid");
    expect(await redeemInvite(db, token, await insertTestAccount(db), START)).toBe("invalid");

    expect((await accountForCustomer(db, customerId))?.id).toBe(accountId);
  });

  test("two accounts redeeming the same invite at the same time: one links, the other is invalid", async () => {
    const customerId = await insertTestCustomer(db);
    const first = await insertTestAccount(db);
    const second = await insertTestAccount(db);
    const token = await createInvite(db, customerId, START);

    const results = await Promise.all([
      redeemInvite(db, token, first, START),
      redeemInvite(db, token, second, START),
    ]);

    expect([...results].sort()).toEqual(["invalid", "linked"]);
    const [invite] = await db.select().from(portalInvites);
    expect(invite.usedByAccountId).toBe((await accountForCustomer(db, customerId))?.id);
  });

  test("is invalid at the 14 days (the expiry hour) and valid one millisecond before", async () => {
    const customerId = await insertTestCustomer(db);
    const token = await createInvite(db, customerId, START);
    const expiry = START.getTime() + PORTAL_INVITE_MS;

    expect(await redeemInvite(db, token, await insertTestAccount(db), new Date(expiry))).toBe("invalid");
    expect(await redeemInvite(db, token, await insertTestAccount(db), new Date(expiry + DAY_MS))).toBe("invalid");
    expect(await accountForCustomer(db, customerId)).toBeNull();

    expect(await redeemInvite(db, token, await insertTestAccount(db), new Date(expiry - 1))).toBe("linked");
  });

  test("is invalid for a token nobody created, for a malformed one and for an empty one", async () => {
    const accountId = await insertTestAccount(db);
    await createInvite(db, await insertTestCustomer(db), START);

    for (const token of ["i".repeat(43), "corta", "", "' or 1=1 --"]) {
      expect(await redeemInvite(db, token, accountId, START), token).toBe("invalid");
    }
  });

  test("a student that already has an account answers customer-has-account and the invite stays unused", async () => {
    const customerId = await insertTestCustomer(db);
    const owner = await insertTestAccount(db, { customerId });
    const newcomer = await insertTestAccount(db);
    const token = await createInvite(db, customerId, START);

    const result = await redeemInvite(db, token, newcomer, START);

    expect(result).toBe("customer-has-account");
    expect((await accountForCustomer(db, customerId))?.id).toBe(owner);
    const [invite] = await db.select().from(portalInvites);
    expect(invite).toMatchObject({ usedAt: null, usedByAccountId: null });
    // La invitación sigue sirviendo: si Tallami desvincula a la dueña, otra cuenta puede usarla.
    await db.update(portalAccounts).set({ customerId: null }).where(eq(portalAccounts.id, owner));
    expect(await redeemInvite(db, token, newcomer, START)).toBe("linked");
  });

  test("an account already linked to another student answers account-linked-elsewhere and nothing changes", async () => {
    const otherCustomer = await insertTestCustomer(db, "Otro");
    const customerId = await insertTestCustomer(db, "Este");
    const accountId = await insertTestAccount(db, { customerId: otherCustomer });
    const token = await createInvite(db, customerId, START);

    const result = await redeemInvite(db, token, accountId, START);

    expect(result).toBe("account-linked-elsewhere");
    expect((await accountForCustomer(db, otherCustomer))?.id).toBe(accountId);
    expect(await accountForCustomer(db, customerId)).toBeNull();
    const [invite] = await db.select().from(portalInvites);
    expect(invite).toMatchObject({ usedAt: null, usedByAccountId: null });
  });

  test("an account already linked to this same student is linked, and the invite is used", async () => {
    const customerId = await insertTestCustomer(db);
    const accountId = await insertTestAccount(db, { customerId });
    const token = await createInvite(db, customerId, START);

    expect(await redeemInvite(db, token, accountId, START)).toBe("linked");

    const [invite] = await db.select().from(portalInvites);
    expect(invite.usedByAccountId).toBe(accountId);
  });

  test("fails for an account that does not exist, and the invite stays unused", async () => {
    const customerId = await insertTestCustomer(db);
    const token = await createInvite(db, customerId, START);

    await expect(redeemInvite(db, token, "00000000-0000-4000-8000-000000000000", START)).rejects.toThrow();

    const [invite] = await db.select().from(portalInvites);
    expect(invite.usedAt).toBeNull();
  });
});

describe("inviteUrl", () => {
  test("is the portal of the site in the language, with the token in `invitacion`", () => {
    const token = "t".repeat(43);

    expect(inviteUrl(token)).toBe(`${SITE_URL}/es/portal?invitacion=${token}`);
    expect(inviteUrl(token, "pt")).toBe(`${SITE_URL}/pt/portal?invitacion=${token}`);
    expect(inviteUrl(token, "en")).toBe(`${SITE_URL}/en/portal?invitacion=${token}`);
  });
});
