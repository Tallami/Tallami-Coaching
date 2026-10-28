import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { customers, portalAccounts, portalSessions } from "@/db/schema";
import {
  accountForCustomer,
  deleteAccountOfCustomer,
  getAccount,
  linkAccountToCustomer,
  unlinkCustomer,
  upsertAccountFromIdentity,
} from "@/portal/accounts";
import { createPortalSession, readPortalSession } from "@/portal/sessions";
import { createTestDb } from "../helpers/db";
import { insertTestAccount, insertTestCustomer } from "../helpers/portal";

const MINUTE_MS = 60_000;
const START = new Date("2026-10-28T10:00:00.000Z");
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(portalAccounts);
  await db.delete(customers);
});

const ANA = {
  provider: "discord",
  providerUserId: "1234567890",
  displayName: "Ana",
  email: "ana@example.com",
} as const;

describe("upsertAccountFromIdentity", () => {
  test("creates the account of a new identity, unlinked, and returns only what the portal needs", async () => {
    const account = await upsertAccountFromIdentity(db, ANA, START);

    expect(account).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      provider: "discord",
      displayName: "Ana",
      email: "ana@example.com",
      customerId: null,
    });
  });

  test("stores the identity, the creation hour and the first login hour", async () => {
    await upsertAccountFromIdentity(db, ANA, START);

    const [row] = await db.select().from(portalAccounts);

    expect(row).toMatchObject({ provider: "discord", providerUserId: "1234567890" });
    expect(row.createdAt).toEqual(START);
    expect(row.lastLoginAt).toEqual(START);
  });

  test("the same identity twice is the same account, with the new name, email and login hour", async () => {
    const first = await upsertAccountFromIdentity(db, ANA, START);
    const later = new Date(START.getTime() + 10 * MINUTE_MS);

    const second = await upsertAccountFromIdentity(
      db,
      { ...ANA, displayName: "Ana la Pro", email: "ana.nueva@example.com" },
      later,
    );

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({ displayName: "Ana la Pro", email: "ana.nueva@example.com" });
    const rows = await db.select().from(portalAccounts);
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toEqual(START);
    expect(rows[0].lastLoginAt).toEqual(later);
  });

  test("an email the provider no longer gives (or does not verify) is forgotten", async () => {
    await upsertAccountFromIdentity(db, ANA, START);

    const again = await upsertAccountFromIdentity(db, { ...ANA, email: null }, START);

    expect(again.email).toBeNull();
  });

  test("keeps the link to the student when the same identity logs in again", async () => {
    const customerId = await insertTestCustomer(db);
    const first = await upsertAccountFromIdentity(db, ANA, START);
    await linkAccountToCustomer(db, first.id, customerId);

    const again = await upsertAccountFromIdentity(db, ANA, START);

    expect(again.customerId).toBe(customerId);
  });

  test("the same user id at another provider is another account", async () => {
    const discord = await upsertAccountFromIdentity(db, ANA, START);
    const google = await upsertAccountFromIdentity(db, { ...ANA, provider: "google" }, START);

    expect(google.id).not.toBe(discord.id);
    expect(await db.select().from(portalAccounts)).toHaveLength(2);
  });

  test("two logins at once of a new identity end up in one account", async () => {
    const [first, second] = await Promise.all([
      upsertAccountFromIdentity(db, ANA, START),
      upsertAccountFromIdentity(db, ANA, START),
    ]);

    expect(second.id).toBe(first.id);
    expect(await db.select().from(portalAccounts)).toHaveLength(1);
  });
});

describe("getAccount", () => {
  test("returns the account, or null when there is none", async () => {
    const created = await upsertAccountFromIdentity(db, ANA, START);

    expect(await getAccount(db, created.id)).toEqual(created);
    expect(await getAccount(db, UNKNOWN_ID)).toBeNull();
  });
});

describe("linkAccountToCustomer", () => {
  test("links a free account to a student without account", async () => {
    const accountId = await insertTestAccount(db);
    const customerId = await insertTestCustomer(db);

    expect(await linkAccountToCustomer(db, accountId, customerId)).toBe("linked");

    expect((await getAccount(db, accountId))?.customerId).toBe(customerId);
    expect((await accountForCustomer(db, customerId))?.id).toBe(accountId);
  });

  test("linking the account to the student it already has is still 'linked'", async () => {
    const accountId = await insertTestAccount(db);
    const customerId = await insertTestCustomer(db);
    await linkAccountToCustomer(db, accountId, customerId);

    expect(await linkAccountToCustomer(db, accountId, customerId)).toBe("linked");
  });

  test("an account already linked to another student stays there", async () => {
    const accountId = await insertTestAccount(db);
    const firstCustomer = await insertTestCustomer(db, "Primero");
    const secondCustomer = await insertTestCustomer(db, "Segundo");
    await linkAccountToCustomer(db, accountId, firstCustomer);

    expect(await linkAccountToCustomer(db, accountId, secondCustomer)).toBe("account-linked-elsewhere");

    expect((await getAccount(db, accountId))?.customerId).toBe(firstCustomer);
    expect(await accountForCustomer(db, secondCustomer)).toBeNull();
  });

  test("a student that has an account does not get a second one", async () => {
    const customerId = await insertTestCustomer(db);
    const owner = await insertTestAccount(db);
    const latecomer = await insertTestAccount(db);
    await linkAccountToCustomer(db, owner, customerId);

    expect(await linkAccountToCustomer(db, latecomer, customerId)).toBe("customer-has-account");

    expect((await getAccount(db, latecomer))?.customerId).toBeNull();
    expect((await accountForCustomer(db, customerId))?.id).toBe(owner);
  });

  test("two accounts racing for the same student: one wins and the other is told so", async () => {
    const customerId = await insertTestCustomer(db);
    const first = await insertTestAccount(db);
    const second = await insertTestAccount(db);

    const results = await Promise.all([
      linkAccountToCustomer(db, first, customerId),
      linkAccountToCustomer(db, second, customerId),
    ]);

    expect([...results].sort()).toEqual(["customer-has-account", "linked"]);
    const linked = await db.select().from(portalAccounts).where(eq(portalAccounts.customerId, customerId));
    expect(linked).toHaveLength(1);
  });

  test("a conflict inside a transaction does not break the transaction", async () => {
    const customerId = await insertTestCustomer(db);
    const owner = await insertTestAccount(db);
    const latecomer = await insertTestAccount(db);
    await linkAccountToCustomer(db, owner, customerId);

    const stillWorks = await db.transaction(async (tx) => {
      const result = await linkAccountToCustomer(tx, latecomer, customerId);
      // Si la transacción hubiera quedado abortada, esta consulta fallaría.
      const [row] = await tx.select({ id: portalAccounts.id }).from(portalAccounts).where(eq(portalAccounts.id, owner));
      return { result, row };
    });

    expect(stillWorks.result).toBe("customer-has-account");
    expect(stillWorks.row.id).toBe(owner);
  });

  test("fails loudly for an account that does not exist", async () => {
    const customerId = await insertTestCustomer(db);

    await expect(linkAccountToCustomer(db, UNKNOWN_ID, customerId)).rejects.toThrow();
  });

  test("fails loudly for a student that does not exist, and leaves the account free", async () => {
    const accountId = await insertTestAccount(db);

    await expect(linkAccountToCustomer(db, accountId, UNKNOWN_ID)).rejects.toThrow();

    expect((await getAccount(db, accountId))?.customerId).toBeNull();
  });
});

describe("unlinkCustomer", () => {
  test("frees the account and returns its id; the account and its sessions stay", async () => {
    const accountId = await insertTestAccount(db);
    const customerId = await insertTestCustomer(db);
    await linkAccountToCustomer(db, accountId, customerId);
    const token = await createPortalSession(db, accountId, START);

    expect(await unlinkCustomer(db, customerId)).toBe(accountId);

    expect(await getAccount(db, accountId)).toMatchObject({ id: accountId, customerId: null });
    expect(await accountForCustomer(db, customerId)).toBeNull();
    // Cerrar las sesiones es de quien desvincula (`revokeAccountSessions`), no de esta función.
    expect(await readPortalSession(db, token, START)).toEqual({ accountId });
  });

  test("returns null when the student has no account", async () => {
    const customerId = await insertTestCustomer(db);

    expect(await unlinkCustomer(db, customerId)).toBeNull();
  });

  test("the freed account can be linked to another student", async () => {
    const accountId = await insertTestAccount(db);
    const firstCustomer = await insertTestCustomer(db, "Primero");
    const secondCustomer = await insertTestCustomer(db, "Segundo");
    await linkAccountToCustomer(db, accountId, firstCustomer);
    await unlinkCustomer(db, firstCustomer);

    expect(await linkAccountToCustomer(db, accountId, secondCustomer)).toBe("linked");
  });
});

describe("deleteAccountOfCustomer", () => {
  test("deletes the account and its sessions, and keeps the student", async () => {
    const accountId = await insertTestAccount(db);
    const customerId = await insertTestCustomer(db);
    await linkAccountToCustomer(db, accountId, customerId);
    const token = await createPortalSession(db, accountId, START);

    await deleteAccountOfCustomer(db, customerId);

    expect(await getAccount(db, accountId)).toBeNull();
    expect(await db.select().from(portalSessions)).toHaveLength(0);
    expect(await readPortalSession(db, token, START)).toBeNull();
    expect(await db.select().from(customers).where(eq(customers.id, customerId))).toHaveLength(1);
  });

  test("leaves the account of another student alone", async () => {
    const mine = await insertTestCustomer(db, "Mío");
    const other = await insertTestCustomer(db, "Otro");
    const otherAccount = await insertTestAccount(db);
    await linkAccountToCustomer(db, otherAccount, other);

    await deleteAccountOfCustomer(db, mine);

    expect(await getAccount(db, otherAccount)).not.toBeNull();
  });

  test("does nothing for a student without account", async () => {
    const customerId = await insertTestCustomer(db);

    await expect(deleteAccountOfCustomer(db, customerId)).resolves.toBeUndefined();
  });
});

describe("accountForCustomer", () => {
  test("returns the account of the student, or null", async () => {
    const accountId = await insertTestAccount(db, { displayName: "Ana", email: "ana@example.com" });
    const linked = await insertTestCustomer(db, "Con cuenta");
    const alone = await insertTestCustomer(db, "Sin cuenta");
    await linkAccountToCustomer(db, accountId, linked);

    expect(await accountForCustomer(db, linked)).toEqual({
      id: accountId,
      provider: "discord",
      displayName: "Ana",
      email: "ana@example.com",
      customerId: linked,
    });
    expect(await accountForCustomer(db, alone)).toBeNull();
  });
});

describe("deleting a student from the panel", () => {
  test("leaves the account without link instead of deleting it", async () => {
    const accountId = await insertTestAccount(db);
    const customerId = await insertTestCustomer(db);
    await linkAccountToCustomer(db, accountId, customerId);

    await db.delete(customers).where(eq(customers.id, customerId));

    expect(await getAccount(db, accountId)).toMatchObject({ id: accountId, customerId: null });
  });
});
