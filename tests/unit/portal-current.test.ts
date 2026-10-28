import { cookies } from "next/headers";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { ADMIN_COOKIE } from "@/admin/auth/session";
import { getDb, type Db } from "@/db/client";
import { portalAccounts } from "@/db/schema";
import { getCurrentStudent } from "@/portal/current";
import { PORTAL_COOKIE, createPortalSession, revokePortalSession } from "@/portal/sessions";
import { createTestDb } from "../helpers/db";
import { insertTestAccount } from "../helpers/portal";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));

const DAY_MS = 24 * 60 * 60_000;

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(portalAccounts);
  vi.mocked(getDb).mockReset();
  vi.mocked(getDb).mockResolvedValue(db);
  requestWithCookies({});
});

/** Hace que el pedido actual traiga esas cookies (nombre → valor). */
function requestWithCookies(values: Record<string, string>): void {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name in values ? { name, value: values[name] } : undefined),
  } as Awaited<ReturnType<typeof cookies>>);
}

describe("getCurrentStudent", () => {
  test("returns the account of the session in the cookie, with the fields of the portal and no more", async () => {
    const accountId = await insertTestAccount(db, { displayName: "Ana", email: "ana@example.com" });
    requestWithCookies({ [PORTAL_COOKIE]: await createPortalSession(db, accountId) });

    expect(await getCurrentStudent()).toEqual({
      id: accountId,
      provider: "discord",
      displayName: "Ana",
      email: "ana@example.com",
      customerId: null,
    });
  });

  test("is null without a cookie, and does not even open the database", async () => {
    expect(await getCurrentStudent()).toBeNull();
    expect(getDb).not.toHaveBeenCalled();
  });

  test("is null for a cookie that was never issued", async () => {
    requestWithCookies({ [PORTAL_COOKIE]: "a".repeat(43) });

    expect(await getCurrentStudent()).toBeNull();
  });

  test("is null once the session is closed", async () => {
    const accountId = await insertTestAccount(db);
    const token = await createPortalSession(db, accountId);
    requestWithCookies({ [PORTAL_COOKIE]: token });
    expect(await getCurrentStudent()).not.toBeNull();

    await revokePortalSession(db, token);

    expect(await getCurrentStudent()).toBeNull();
  });

  test("is null once the session is 30 days old", async () => {
    const accountId = await insertTestAccount(db);
    const longAgo = new Date(Date.now() - 31 * DAY_MS);
    requestWithCookies({ [PORTAL_COOKIE]: await createPortalSession(db, accountId, longAgo) });

    expect(await getCurrentStudent()).toBeNull();
  });

  test("a token in the cookie of the admin panel does not log a student in", async () => {
    const accountId = await insertTestAccount(db);
    requestWithCookies({ [ADMIN_COOKIE]: await createPortalSession(db, accountId) });

    expect(await getCurrentStudent()).toBeNull();
  });

  test("lets the failure of the database through: no answer is not 'not logged in'", async () => {
    requestWithCookies({ [PORTAL_COOKIE]: "a".repeat(43) });
    vi.mocked(getDb).mockRejectedValue(new Error("base caída"));

    await expect(getCurrentStudent()).rejects.toThrow("base caída");
  });
});
