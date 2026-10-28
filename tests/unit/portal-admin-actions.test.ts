// Las tres acciones de la tarjeta "Portal del alumno" de la ficha del alumno. Como las
// demás del panel, verifican la sesión antes de tocar la base (el patrón de
// `billing-guards.test.ts`); con sesión, hacen lo que dice la spec: invitar, desvincular
// cerrando las sesiones y borrar la cuenta.

import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { requireAdmin } from "@/admin/auth/require-admin";
import { getDb, type Db } from "@/db/client";
import { customers, portalAccounts, portalInvites, portalSessions, sales } from "@/db/schema";
import { SITE_URL } from "@/lib/site-url";
import { accountForCustomer } from "@/portal/accounts";
import { createInvite, redeemInvite } from "@/portal/invites";
import { PORTAL_INVITE_MS } from "@/portal/policy";
import { createPortalSession, readPortalSession } from "@/portal/sessions";
import { createTestDb } from "../helpers/db";
import { insertTestAccount, insertTestCustomer, insertTestSale } from "../helpers/portal";

vi.mock("@/admin/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

const NO_SESSION = "NEXT_REDIRECT /admin/login";
const SOME_ID = "8f4f3f64-7c5c-4a43-9d4c-3f6a3a2f1b10";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const LINK_PREFIX = `${SITE_URL}/es/portal?invitacion=`;
const URL_SAFE_32_BYTES = /^[A-Za-z0-9_-]{43}$/;

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(getDb).mockReset();
  await db.delete(portalAccounts);
  await db.delete(sales); // una venta impide borrar a su alumno
  await db.delete(customers);
});

function withoutSession(): void {
  vi.mocked(requireAdmin).mockRejectedValue(new Error(NO_SESSION));
}

function withSession(): void {
  vi.mocked(requireAdmin).mockResolvedValue(undefined);
  vi.mocked(getDb).mockResolvedValue(db);
}

/** El token de un link de invitación, comprobando que sea el del portal del sitio. */
function tokenOf(url: string): string {
  expect(url.startsWith(LINK_PREFIX), url).toBe(true);
  const token = url.slice(LINK_PREFIX.length);
  expect(token).toMatch(URL_SAFE_32_BYTES);
  return token;
}

async function actions() {
  return import("@/app/admin/alumnos/[id]/portal-actions");
}

describe("without a session nothing reads or writes", () => {
  test("inviting", async () => {
    withoutSession();
    const { createPortalInviteAction } = await actions();

    await expect(createPortalInviteAction(SOME_ID)).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("unlinking", async () => {
    withoutSession();
    const { unlinkPortalAccountAction } = await actions();

    await expect(unlinkPortalAccountAction(SOME_ID)).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("deleting the account", async () => {
    withoutSession();
    const { deletePortalAccountAction } = await actions();

    await expect(deletePortalAccountAction(SOME_ID)).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("a session that fails leaves the data as it was", async () => {
    const customerId = await insertTestCustomer(db);
    const accountId = await insertTestAccount(db, { customerId });
    const token = await createPortalSession(db, accountId);
    vi.mocked(getDb).mockResolvedValue(db);
    withoutSession();
    const { unlinkPortalAccountAction, deletePortalAccountAction, createPortalInviteAction } = await actions();

    await expect(unlinkPortalAccountAction(customerId)).rejects.toThrow(NO_SESSION);
    await expect(deletePortalAccountAction(customerId)).rejects.toThrow(NO_SESSION);
    await expect(createPortalInviteAction(customerId)).rejects.toThrow(NO_SESSION);

    expect((await accountForCustomer(db, customerId))?.id).toBe(accountId);
    expect(await readPortalSession(db, token)).not.toBeNull();
    expect(await db.select().from(portalInvites)).toEqual([]);
  });
});

describe("createPortalInviteAction", () => {
  test("creates an invite for the student and returns its link and its expiry, checking the session first", async () => {
    withSession();
    const customerId = await insertTestCustomer(db);
    const { createPortalInviteAction } = await actions();
    const before = Date.now();

    const result = await createPortalInviteAction(customerId);

    const after = Date.now();
    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, url: expect.any(String), expiresAt: expect.any(String) });
    if (!result.ok) throw new Error("se esperaba una invitación");
    tokenOf(result.url);
    const expiresAt = new Date(result.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + PORTAL_INVITE_MS);
    expect(expiresAt).toBeLessThanOrEqual(after + PORTAL_INVITE_MS);
    const [invite] = await db.select().from(portalInvites);
    expect(invite).toMatchObject({ customerId, usedAt: null });
    expect(invite.expiresAt.getTime()).toBe(expiresAt);
  });

  test("the link works once: the account that opens it is linked to the student", async () => {
    withSession();
    const customerId = await insertTestCustomer(db);
    const { createPortalInviteAction } = await actions();
    const result = await createPortalInviteAction(customerId);
    if (!result.ok) throw new Error("se esperaba una invitación");
    const token = tokenOf(result.url);

    expect(await redeemInvite(db, token, await insertTestAccount(db))).toBe("linked");
    expect(await redeemInvite(db, token, await insertTestAccount(db))).toBe("invalid");
  });

  test("another invite voids the one before", async () => {
    withSession();
    const customerId = await insertTestCustomer(db);
    const { createPortalInviteAction } = await actions();
    const first = await createPortalInviteAction(customerId);
    const second = await createPortalInviteAction(customerId);
    if (!first.ok || !second.ok) throw new Error("se esperaban dos invitaciones");

    expect(await redeemInvite(db, tokenOf(first.url), await insertTestAccount(db))).toBe("invalid");
    expect(await redeemInvite(db, tokenOf(second.url), await insertTestAccount(db))).toBe("linked");
  });

  test("a student that already has an account is not invited again", async () => {
    withSession();
    const customerId = await insertTestCustomer(db);
    await insertTestAccount(db, { customerId });
    const { createPortalInviteAction } = await actions();

    const result = await createPortalInviteAction(customerId);

    expect(result).toEqual({ ok: false, error: "already-linked" });
    expect(await db.select().from(portalInvites)).toEqual([]);
  });

  test("a student that does not exist answers not-found and leaves nothing", async () => {
    withSession();
    const { createPortalInviteAction } = await actions();

    expect(await createPortalInviteAction(UNKNOWN_ID)).toEqual({ ok: false, error: "not-found" });
    expect(await db.select().from(portalInvites)).toEqual([]);
  });

  test("an id that is not a uuid never reaches the database", async () => {
    withSession();
    const { createPortalInviteAction } = await actions();

    expect(await createPortalInviteAction("x'; drop table customers; --")).toEqual({ ok: false, error: "not-found" });
    expect(getDb).not.toHaveBeenCalled();
  });

  test("keeps the invite of another student", async () => {
    withSession();
    const ana = await insertTestCustomer(db, "Ana");
    const beto = await insertTestCustomer(db, "Beto");
    const anaToken = await createInvite(db, ana);
    const { createPortalInviteAction } = await actions();

    await createPortalInviteAction(beto);

    expect(await redeemInvite(db, anaToken, await insertTestAccount(db))).toBe("linked");
  });
});

describe("unlinkPortalAccountAction", () => {
  test("unlinks the account from the student and closes all its sessions, keeping the account", async () => {
    withSession();
    const customerId = await insertTestCustomer(db);
    const accountId = await insertTestAccount(db, { customerId });
    const first = await createPortalSession(db, accountId);
    const second = await createPortalSession(db, accountId);
    const { unlinkPortalAccountAction } = await actions();

    const result = await unlinkPortalAccountAction(customerId);

    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true });
    expect(await accountForCustomer(db, customerId)).toBeNull();
    const [account] = await db.select().from(portalAccounts).where(eq(portalAccounts.id, accountId));
    expect(account.customerId).toBeNull();
    expect(await readPortalSession(db, first)).toBeNull();
    expect(await readPortalSession(db, second)).toBeNull();
  });

  test("leaves the sessions of other accounts open", async () => {
    withSession();
    const customerId = await insertTestCustomer(db);
    await insertTestAccount(db, { customerId });
    const otherCustomer = await insertTestCustomer(db, "Otro");
    const otherAccount = await insertTestAccount(db, { customerId: otherCustomer });
    const otherSession = await createPortalSession(db, otherAccount);
    const { unlinkPortalAccountAction } = await actions();

    await unlinkPortalAccountAction(customerId);

    expect(await readPortalSession(db, otherSession)).not.toBeNull();
    expect((await accountForCustomer(db, otherCustomer))?.id).toBe(otherAccount);
  });

  test("after unlinking, the student can be invited again and the old account can link to someone else", async () => {
    withSession();
    const customerId = await insertTestCustomer(db);
    const accountId = await insertTestAccount(db, { customerId });
    const { unlinkPortalAccountAction, createPortalInviteAction } = await actions();

    await unlinkPortalAccountAction(customerId);

    expect((await createPortalInviteAction(customerId)).ok).toBe(true);
    const token = await createInvite(db, await insertTestCustomer(db, "Otro alumno"));
    expect(await redeemInvite(db, token, accountId)).toBe("linked");
  });

  test("a student without an account: nothing to do, and nothing breaks", async () => {
    withSession();
    const customerId = await insertTestCustomer(db);
    const { unlinkPortalAccountAction } = await actions();

    expect(await unlinkPortalAccountAction(customerId)).toEqual({ ok: true });
  });

  test("an id that is not a uuid never reaches the database", async () => {
    withSession();
    const { unlinkPortalAccountAction } = await actions();

    expect(await unlinkPortalAccountAction("no-es-un-id")).toEqual({ ok: false, error: "not-found" });
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("deletePortalAccountAction", () => {
  test("deletes the account and its sessions; the student and the sales stay in the panel", async () => {
    withSession();
    const customerId = await insertTestCustomer(db);
    const saleId = await insertTestSale(db, customerId);
    const accountId = await insertTestAccount(db, { customerId });
    const token = await createPortalSession(db, accountId);
    const { deletePortalAccountAction } = await actions();

    const result = await deletePortalAccountAction(customerId);

    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true });
    expect(await db.select().from(portalAccounts).where(eq(portalAccounts.id, accountId))).toEqual([]);
    expect(await db.select().from(portalSessions).where(eq(portalSessions.accountId, accountId))).toEqual([]);
    expect(await readPortalSession(db, token)).toBeNull();
    expect(await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId))).toHaveLength(1);
    expect(await db.select({ id: sales.id }).from(sales).where(eq(sales.id, saleId))).toHaveLength(1);
  });

  test("leaves the accounts of other students alone", async () => {
    withSession();
    const customerId = await insertTestCustomer(db);
    await insertTestAccount(db, { customerId });
    const otherCustomer = await insertTestCustomer(db, "Otro");
    const otherAccount = await insertTestAccount(db, { customerId: otherCustomer });
    const { deletePortalAccountAction } = await actions();

    await deletePortalAccountAction(customerId);

    expect((await accountForCustomer(db, otherCustomer))?.id).toBe(otherAccount);
  });

  test("a student without an account: nothing to do, and nothing breaks", async () => {
    withSession();
    const customerId = await insertTestCustomer(db);
    const { deletePortalAccountAction } = await actions();

    expect(await deletePortalAccountAction(customerId)).toEqual({ ok: true });
  });

  test("an id that is not a uuid never reaches the database", async () => {
    withSession();
    const { deletePortalAccountAction } = await actions();

    expect(await deletePortalAccountAction("no-es-un-id")).toEqual({ ok: false, error: "not-found" });
    expect(getDb).not.toHaveBeenCalled();
  });
});
