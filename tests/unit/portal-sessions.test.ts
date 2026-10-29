import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { portalAccounts, portalInvites, portalSessions } from "@/db/schema";
import { PORTAL_RECORD_RETENTION_MS, PORTAL_SESSION_MS } from "@/portal/policy";
import {
  PORTAL_COOKIE,
  createPortalSession,
  portalCookieOptions,
  purgePortalRecords,
  readPortalSession,
  revokeAccountSessions,
  revokePortalSession,
} from "@/portal/sessions";
import { createTestDb } from "../helpers/db";
import { insertTestAccount, insertTestCustomer } from "../helpers/portal";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Las 10:00 de un día cualquiera: todas las horas de los tests parten de acá. */
const START = new Date("2026-10-28T10:00:00.000Z");

function after(ms: number, base: Date = START): Date {
  return new Date(base.getTime() + ms);
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

let db: Db;
let accountId: string;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(portalAccounts); // las cuentas arrastran sus sesiones (on delete cascade)
  accountId = await insertTestAccount(db);
});

describe("createPortalSession", () => {
  test("returns a random url-safe token of 32 bytes, different every time", async () => {
    const tokens = await Promise.all([
      createPortalSession(db, accountId, START),
      createPortalSession(db, accountId, START),
      createPortalSession(db, accountId, START),
    ]);

    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(tokens).size).toBe(3);
  });

  test("keeps only the SHA-256 of the token: the token itself is nowhere in the database", async () => {
    const token = await createPortalSession(db, accountId, START);

    const rows = await db.select().from(portalSessions);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(sha256Hex(token));
    expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test("stores the account, the creation hour and the expiry 30 days later, still open", async () => {
    await createPortalSession(db, accountId, START);

    const [row] = await db.select().from(portalSessions);

    expect(row.accountId).toBe(accountId);
    expect(row.createdAt).toEqual(START);
    expect(row.expiresAt).toEqual(after(PORTAL_SESSION_MS));
    expect(row.revokedAt).toBeNull();
  });
});

describe("readPortalSession", () => {
  test("returns the account of an open session, and nothing else", async () => {
    const token = await createPortalSession(db, accountId, START);

    expect(await readPortalSession(db, token, after(MINUTE_MS))).toEqual({ accountId });
  });

  test("is valid at 29 days 23:59 and null from the 30 days on", async () => {
    const token = await createPortalSession(db, accountId, START);

    expect(await readPortalSession(db, token, after(30 * DAY_MS - MINUTE_MS))).toEqual({ accountId });
    expect(await readPortalSession(db, token, after(30 * DAY_MS - 1))).toEqual({ accountId });
    expect(await readPortalSession(db, token, after(30 * DAY_MS))).toBeNull();
    expect(await readPortalSession(db, token, after(31 * DAY_MS))).toBeNull();
  });

  test("a session does not get longer by being used", async () => {
    const token = await createPortalSession(db, accountId, START);

    expect(await readPortalSession(db, token, after(20 * DAY_MS))).not.toBeNull();
    expect(await readPortalSession(db, token, after(30 * DAY_MS))).toBeNull();
  });

  test("is null without a token, with text that is not a token and with a token that was never issued", async () => {
    await createPortalSession(db, accountId, START);

    expect(await readPortalSession(db, undefined, START)).toBeNull();
    expect(await readPortalSession(db, "", START)).toBeNull();
    expect(await readPortalSession(db, "no es un token", START)).toBeNull();
    expect(await readPortalSession(db, randomBytes(32).toString("base64url"), START)).toBeNull();
  });

  test("the stored id is not a token: having the database row is not having the session", async () => {
    const token = await createPortalSession(db, accountId, START);
    const [row] = await db.select().from(portalSessions);

    expect(row.id).not.toBe(token);
    expect(await readPortalSession(db, row.id, START)).toBeNull();
  });

  test("uses the current hour when none is given", async () => {
    const token = await createPortalSession(db, accountId);

    expect(await readPortalSession(db, token)).toEqual({ accountId });
  });

  test("a session of another account never answers for this one", async () => {
    const otherAccountId = await insertTestAccount(db);
    const otherToken = await createPortalSession(db, otherAccountId, START);

    expect(await readPortalSession(db, otherToken, START)).toEqual({ accountId: otherAccountId });
  });
});

describe("revokePortalSession", () => {
  test("closes the session: it reads as null afterwards", async () => {
    const token = await createPortalSession(db, accountId, START);

    await revokePortalSession(db, token, after(MINUTE_MS));

    expect(await readPortalSession(db, token, after(2 * MINUTE_MS))).toBeNull();
  });

  test("keeps the first closing hour when it is closed again", async () => {
    const token = await createPortalSession(db, accountId, START);

    await revokePortalSession(db, token, after(MINUTE_MS));
    await revokePortalSession(db, token, after(5 * MINUTE_MS));

    const [row] = await db.select().from(portalSessions);
    expect(row.revokedAt).toEqual(after(MINUTE_MS));
  });

  test("closes only that session, not the other sessions of the account", async () => {
    const closed = await createPortalSession(db, accountId, START);
    const kept = await createPortalSession(db, accountId, START);

    await revokePortalSession(db, closed, START);

    expect(await readPortalSession(db, closed, START)).toBeNull();
    expect(await readPortalSession(db, kept, START)).toEqual({ accountId });
  });

  test("does nothing, and does not fail, with a token that does not exist or is not a token", async () => {
    const token = await createPortalSession(db, accountId, START);

    await revokePortalSession(db, randomBytes(32).toString("base64url"), START);
    await revokePortalSession(db, "no es un token", START);

    expect(await readPortalSession(db, token, START)).toEqual({ accountId });
  });
});

describe("revokeAccountSessions", () => {
  test("closes every open session of the account", async () => {
    const tokens = await Promise.all([
      createPortalSession(db, accountId, START),
      createPortalSession(db, accountId, START),
      createPortalSession(db, accountId, START),
    ]);

    await revokeAccountSessions(db, accountId, after(MINUTE_MS));

    for (const token of tokens) {
      expect(await readPortalSession(db, token, after(2 * MINUTE_MS))).toBeNull();
    }
  });

  test("leaves the sessions of other accounts alone", async () => {
    const otherAccountId = await insertTestAccount(db);
    await createPortalSession(db, accountId, START);
    const otherToken = await createPortalSession(db, otherAccountId, START);

    await revokeAccountSessions(db, accountId, START);

    expect(await readPortalSession(db, otherToken, START)).toEqual({ accountId: otherAccountId });
  });

  test("keeps the first closing hour of a session that was already closed", async () => {
    const token = await createPortalSession(db, accountId, START);
    await revokePortalSession(db, token, after(MINUTE_MS));

    await revokeAccountSessions(db, accountId, after(9 * MINUTE_MS));

    const [row] = await db.select().from(portalSessions).where(eq(portalSessions.accountId, accountId));
    expect(row.revokedAt).toEqual(after(MINUTE_MS));
  });

  test("does nothing for an account without sessions", async () => {
    await expect(revokeAccountSessions(db, accountId, START)).resolves.toBeUndefined();
  });
});

describe("purgePortalRecords", () => {
  const NOW = after(60 * DAY_MS);

  /** Una sesión con horas a medida; devuelve su id en la base. */
  async function insertSession(times: { createdAt: Date; expiresAt: Date; revokedAt?: Date }): Promise<string> {
    const id = sha256Hex(randomBytes(32).toString("base64url"));
    await db.insert(portalSessions).values({ id, accountId, ...times });
    return id;
  }

  /** Una invitación con horas a medida; devuelve su id. */
  async function insertInvite(customerId: string, times: { expiresAt: Date; usedAt?: Date }): Promise<string> {
    const [row] = await db
      .insert(portalInvites)
      .values({ tokenHash: sha256Hex(randomBytes(32).toString("base64url")), customerId, createdAt: START, ...times })
      .returning({ id: portalInvites.id });
    return row.id;
  }

  async function sessionIds(): Promise<string[]> {
    return (await db.select({ id: portalSessions.id }).from(portalSessions)).map(({ id }) => id).sort();
  }

  async function inviteIds(): Promise<string[]> {
    return (await db.select({ id: portalInvites.id }).from(portalInvites)).map(({ id }) => id).sort();
  }

  beforeEach(async () => {
    await db.delete(portalInvites);
    // La cuenta de estos tests entró hace un momento (en la hora de los tests, no en la de la máquina).
    await db.update(portalAccounts).set({ lastLoginAt: NOW }).where(eq(portalAccounts.id, accountId));
  });

  test("deletes the sessions that expired or were closed more than a day ago, and keeps the rest", async () => {
    const created = after(-31 * DAY_MS, NOW);
    const expiredLongAgo = await insertSession({ createdAt: created, expiresAt: after(-DAY_MS - 1, NOW) });
    const closedLongAgo = await insertSession({
      createdAt: after(-5 * DAY_MS, NOW),
      expiresAt: after(25 * DAY_MS, NOW),
      revokedAt: after(-2 * DAY_MS, NOW),
    });
    const expiredToday = await insertSession({ createdAt: created, expiresAt: after(-DAY_MS + MINUTE_MS, NOW) });
    const closedToday = await insertSession({
      createdAt: after(-5 * DAY_MS, NOW),
      expiresAt: after(25 * DAY_MS, NOW),
      revokedAt: after(-MINUTE_MS, NOW),
    });
    const open = await insertSession({ createdAt: after(-DAY_MS, NOW), expiresAt: after(29 * DAY_MS, NOW) });

    await purgePortalRecords(db, NOW);

    const remaining = await sessionIds();
    expect(remaining).toEqual([expiredToday, closedToday, open].sort());
    expect(remaining).not.toContain(expiredLongAgo);
    expect(remaining).not.toContain(closedLongAgo);
  });

  test("deletes the invites used or expired more than a day ago, and keeps pending and recent ones", async () => {
    const customerId = await insertTestCustomer(db);
    const usedLongAgo = await insertInvite(customerId, {
      expiresAt: after(5 * DAY_MS, NOW),
      usedAt: after(-2 * DAY_MS, NOW),
    });
    const expiredLongAgo = await insertInvite(customerId, { expiresAt: after(-2 * DAY_MS, NOW) });
    const usedToday = await insertInvite(customerId, { expiresAt: after(5 * DAY_MS, NOW), usedAt: after(-MINUTE_MS, NOW) });
    const expiredToday = await insertInvite(customerId, { expiresAt: after(-MINUTE_MS, NOW) });
    const pending = await insertInvite(customerId, { expiresAt: after(10 * DAY_MS, NOW) });

    await purgePortalRecords(db, NOW);

    const remaining = await inviteIds();
    expect(remaining).toEqual([usedToday, expiredToday, pending].sort());
    expect(remaining).not.toContain(usedLongAgo);
    expect(remaining).not.toContain(expiredLongAgo);
  });

  describe("the accounts", () => {
    /** Con una sesión abierta de las que su último ingreso pudo abrir, y una invitación que usó. */
    async function accountWithRecords(lastLoginAt: Date, customerId: string | null) {
      const id = await insertTestAccount(db, { customerId, lastLoginAt });
      await db.insert(portalSessions).values({
        id: sha256Hex(randomBytes(32).toString("base64url")),
        accountId: id,
        createdAt: lastLoginAt,
        expiresAt: after(PORTAL_SESSION_MS, lastLoginAt),
      });
      return id;
    }

    async function accountIds(): Promise<string[]> {
      return (await db.select({ id: portalAccounts.id }).from(portalAccounts)).map(({ id }) => id);
    }

    /** El límite: la sesión más larga (30 días) más el día que se guarda lo que ya no sirve. */
    const WINDOW_MS = PORTAL_SESSION_MS + PORTAL_RECORD_RETENTION_MS;

    test("the window is 31 days: 30 of the session plus the day that dead records are kept", () => {
      expect(WINDOW_MS).toBe(31 * DAY_MS);
    });

    test("deletes an account that is not linked and last signed in more than 31 days ago, with its sessions", async () => {
      const stale = await accountWithRecords(after(-WINDOW_MS - 1, NOW), null);

      await purgePortalRecords(db, NOW);

      expect(await accountIds()).toEqual([accountId]);
      expect(await db.select().from(portalSessions).where(eq(portalSessions.accountId, stale))).toEqual([]);
    });

    test("keeps an account that is not linked while its last sign-in is inside the window", async () => {
      const edge = await accountWithRecords(after(-WINDOW_MS, NOW), null);
      const recent = await accountWithRecords(after(-WINDOW_MS + MINUTE_MS, NOW), null);

      await purgePortalRecords(db, NOW);

      expect((await accountIds()).sort()).toEqual([accountId, edge, recent].sort());
    });

    test("keeps a linked account however long ago it signed in: deleting it is the panel's decision", async () => {
      const customerId = await insertTestCustomer(db);
      const linked = await accountWithRecords(after(-400 * DAY_MS, NOW), customerId);

      await purgePortalRecords(db, NOW);

      expect(await accountIds()).toContain(linked);
    });

    test("keeps the account of a student who unlinked and signed in again today, whatever its age", async () => {
      const unlinked = await insertTestAccount(db, { customerId: null, lastLoginAt: NOW });
      await db.update(portalAccounts).set({ createdAt: after(-400 * DAY_MS, NOW) }).where(eq(portalAccounts.id, unlinked));

      await purgePortalRecords(db, NOW);

      expect(await accountIds()).toContain(unlinked);
    });

    test("an invite used by a deleted account stays, without the account it points to", async () => {
      const customerId = await insertTestCustomer(db);
      const stale = await accountWithRecords(after(-WINDOW_MS - 1, NOW), null);
      const inviteId = await insertInvite(customerId, { expiresAt: after(5 * DAY_MS, NOW) });
      await db.update(portalInvites).set({ usedByAccountId: stale }).where(eq(portalInvites.id, inviteId));

      await purgePortalRecords(db, NOW);

      expect(await inviteIds()).toEqual([inviteId]);
      const [invite] = await db.select().from(portalInvites).where(eq(portalInvites.id, inviteId));
      expect(invite.usedByAccountId).toBeNull();
    });

    test("an account that was just linked is not caught by the cleanup that was about to delete it", async () => {
      const customerId = await insertTestCustomer(db);
      const account = await accountWithRecords(after(-WINDOW_MS - 1, NOW), null);
      await db.update(portalAccounts).set({ customerId }).where(eq(portalAccounts.id, account));

      await purgePortalRecords(db, NOW);

      expect(await accountIds()).toContain(account);
    });
  });

  test("uses the current hour when none is given", async () => {
    await insertSession({ createdAt: new Date(Date.now() - 40 * DAY_MS), expiresAt: new Date(Date.now() - 10 * DAY_MS) });

    await purgePortalRecords(db);

    expect(await sessionIds()).toEqual([]);
  });
});

describe("the account and its sessions", () => {
  test("deleting the account deletes its sessions", async () => {
    const token = await createPortalSession(db, accountId, START);

    await db.delete(portalAccounts).where(eq(portalAccounts.id, accountId));

    expect(await db.select().from(portalSessions)).toHaveLength(0);
    expect(await readPortalSession(db, token, START)).toBeNull();
  });
});

describe("the session cookie", () => {
  test("is called tallami_alumno", () => {
    expect(PORTAL_COOKIE).toBe("tallami_alumno");
  });

  test("is httpOnly, SameSite=Lax, for the whole site, and lasts 30 days", () => {
    expect(portalCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
    });
  });

  test("is Secure unless the caller says it is plain http on localhost", () => {
    expect(portalCookieOptions(true).secure).toBe(true);
    expect(portalCookieOptions(false).secure).toBe(false);
  });
});
