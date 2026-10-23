import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import { PENDING_LOGIN_MS } from "@/admin/auth/policy";
import {
  PENDING_COOKIE,
  consumePendingLogin,
  createPendingLogin,
  pendingCookieOptions,
  readPendingLogin,
  setPendingChallenge,
  switchPendingToCode,
  takePendingChallenge,
} from "@/admin/auth/pending-logins";
import type { Db } from "@/db/client";
import { adminPendingLogins } from "@/db/schema";
import { createTestDb } from "../helpers/db";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

/** Las 10:00 de un día cualquiera: todas las horas de los tests parten de acá. */
const START = new Date("2026-10-21T10:00:00.000Z");
const INPUT = {
  mode: "passkey",
  nextPath: "/admin/facturacion",
  ipHash: "hash-de-una-ip",
  device: "Chrome en Windows",
} as const;

function after(ms: number): Date {
  return new Date(START.getTime() + ms);
}

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(adminPendingLogins);
});

describe("createPendingLogin", () => {
  test("returns a random url-safe id of 32 bytes, different every time", async () => {
    const ids = await Promise.all([
      createPendingLogin(db, INPUT, START),
      createPendingLogin(db, INPUT, START),
      createPendingLogin(db, INPUT, START),
    ]);

    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(ids).size).toBe(3);
  });

  test("stores what it was given and lasts five minutes", async () => {
    const id = await createPendingLogin(db, INPUT, START);

    const [row] = await db.select().from(adminPendingLogins).where(eq(adminPendingLogins.id, id));
    expect(row).toMatchObject({
      id,
      mode: "passkey",
      nextPath: "/admin/facturacion",
      ipHash: "hash-de-una-ip",
      device: "Chrome en Windows",
      challenge: null,
      createdAt: START,
      expiresAt: after(PENDING_LOGIN_MS),
      consumedAt: null,
    });
    expect(PENDING_LOGIN_MS).toBe(5 * MINUTE_MS);
  });

  test("the database refuses a mode it does not know", async () => {
    await expect(createPendingLogin(db, { ...INPUT, mode: "otro" as never }, START)).rejects.toThrow();
  });
});

describe("readPendingLogin", () => {
  test("hands back what the second step needs, and nothing more", async () => {
    const id = await createPendingLogin(db, { ...INPUT, mode: "first-key" }, START);

    expect(await readPendingLogin(db, id, after(MINUTE_MS))).toEqual({
      id,
      mode: "first-key",
      nextPath: "/admin/facturacion",
      ipHash: "hash-de-una-ip",
      device: "Chrome en Windows",
      challenge: null,
    });
  });

  test("is still valid at 4:59 and gone at 5:00", async () => {
    const id = await createPendingLogin(db, INPUT, START);

    expect(await readPendingLogin(db, id, after(5 * MINUTE_MS - SECOND_MS))).not.toBeNull();
    expect(await readPendingLogin(db, id, after(5 * MINUTE_MS))).toBeNull();
  });

  test("reading it does not use it up", async () => {
    const id = await createPendingLogin(db, INPUT, START);

    expect(await readPendingLogin(db, id, START)).not.toBeNull();
    expect(await readPendingLogin(db, id, START)).not.toBeNull();
  });

  test("is gone once consumed", async () => {
    const id = await createPendingLogin(db, INPUT, START);
    await consumePendingLogin(db, id, after(SECOND_MS));

    expect(await readPendingLogin(db, id, after(2 * SECOND_MS))).toBeNull();
  });

  test.each([
    ["no cookie", undefined],
    ["an empty cookie", ""],
    ["text that is not an id", "esto-no-es-un-id"],
    ["an id of the right length that does not exist", "a".repeat(43)],
    ["an id with characters that are not url-safe", `${"a".repeat(42)}'`],
  ])("is null for %s", async (_label, id) => {
    await createPendingLogin(db, INPUT, START);

    expect(await readPendingLogin(db, id, START)).toBeNull();
  });
});

describe("setPendingChallenge", () => {
  test("keeps the challenge, and a new one replaces the old", async () => {
    const id = await createPendingLogin(db, INPUT, START);

    await setPendingChallenge(db, id, "primer-desafio");
    expect((await readPendingLogin(db, id, START))?.challenge).toBe("primer-desafio");

    await setPendingChallenge(db, id, "segundo-desafio");
    expect((await readPendingLogin(db, id, START))?.challenge).toBe("segundo-desafio");
  });

  test("does nothing to a login that was already consumed, or to one that does not exist", async () => {
    const id = await createPendingLogin(db, INPUT, START);
    await consumePendingLogin(db, id, START);

    await setPendingChallenge(db, id, "tarde");
    await setPendingChallenge(db, "a".repeat(43), "de-nadie");

    const [row] = await db.select().from(adminPendingLogins).where(eq(adminPendingLogins.id, id));
    expect(row.challenge).toBeNull();
  });
});

describe("takePendingChallenge", () => {
  test("hands the challenge over once and leaves none behind: the next try needs a new one", async () => {
    const id = await createPendingLogin(db, INPUT, START);
    await setPendingChallenge(db, id, "desafio");

    expect(await takePendingChallenge(db, id, after(SECOND_MS))).toBe("desafio");
    expect(await takePendingChallenge(db, id, after(2 * SECOND_MS))).toBeNull();
    expect((await readPendingLogin(db, id, after(2 * SECOND_MS)))?.challenge).toBeNull();
  });

  test("taking it does not use up the login itself", async () => {
    const id = await createPendingLogin(db, INPUT, START);
    await setPendingChallenge(db, id, "desafio");

    await takePendingChallenge(db, id, START);

    expect(await readPendingLogin(db, id, START)).not.toBeNull();
    expect(await consumePendingLogin(db, id, START)).toBe(true);
  });

  test("two at the same time: only one gets it", async () => {
    const id = await createPendingLogin(db, INPUT, START);
    await setPendingChallenge(db, id, "desafio");

    const taken = await Promise.all([takePendingChallenge(db, id, START), takePendingChallenge(db, id, START)]);

    expect(taken.filter((challenge) => challenge === "desafio")).toHaveLength(1);
    expect(taken.filter((challenge) => challenge === null)).toHaveLength(1);
  });

  test("is null when nothing was asked for, or the login expired, was consumed or does not exist", async () => {
    const without = await createPendingLogin(db, INPUT, START);
    const expired = await createPendingLogin(db, INPUT, START);
    await setPendingChallenge(db, expired, "vencido");
    const consumed = await createPendingLogin(db, INPUT, START);
    await setPendingChallenge(db, consumed, "usado");
    await consumePendingLogin(db, consumed, START);

    expect(await takePendingChallenge(db, without, START)).toBeNull();
    expect(await takePendingChallenge(db, expired, after(5 * MINUTE_MS))).toBeNull();
    expect(await takePendingChallenge(db, consumed, START)).toBeNull();
    expect(await takePendingChallenge(db, "a".repeat(43), START)).toBeNull();
  });
});

describe("switchPendingToCode", () => {
  test("turns a passkey login into a code login and drops the challenge it had", async () => {
    const id = await createPendingLogin(db, INPUT, START);
    await setPendingChallenge(db, id, "desafio-de-la-llave");

    expect(await switchPendingToCode(db, id, after(MINUTE_MS))).toBe(true);

    expect(await readPendingLogin(db, id, after(MINUTE_MS))).toMatchObject({ mode: "code", challenge: null });
  });

  test("never turns a first-key login into a code login: there is no key anywhere to make a code from", async () => {
    const id = await createPendingLogin(db, { ...INPUT, mode: "first-key" }, START);

    expect(await switchPendingToCode(db, id, START)).toBe(false);

    expect((await readPendingLogin(db, id, START))?.mode).toBe("first-key");
  });

  test("says false when it is already a code login", async () => {
    const id = await createPendingLogin(db, { ...INPUT, mode: "code" }, START);

    expect(await switchPendingToCode(db, id, START)).toBe(false);
  });

  test("says false when it expired, was consumed or does not exist", async () => {
    const expired = await createPendingLogin(db, INPUT, START);
    const consumed = await createPendingLogin(db, INPUT, START);
    await consumePendingLogin(db, consumed, START);

    expect(await switchPendingToCode(db, expired, after(5 * MINUTE_MS))).toBe(false);
    expect(await switchPendingToCode(db, consumed, START)).toBe(false);
    expect(await switchPendingToCode(db, "a".repeat(43), START)).toBe(false);
  });
});

describe("consumePendingLogin", () => {
  test("works once: the first call is true and the second false", async () => {
    const id = await createPendingLogin(db, INPUT, START);

    expect(await consumePendingLogin(db, id, after(SECOND_MS))).toBe(true);
    expect(await consumePendingLogin(db, id, after(2 * SECOND_MS))).toBe(false);

    const [row] = await db.select().from(adminPendingLogins).where(eq(adminPendingLogins.id, id));
    expect(row.consumedAt).toEqual(after(SECOND_MS));
  });

  test("two at the same time: exactly one wins", async () => {
    const id = await createPendingLogin(db, INPUT, START);

    const results = await Promise.all(Array.from({ length: 6 }, () => consumePendingLogin(db, id, after(SECOND_MS))));

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("is false at 5:00 and true at 4:59", async () => {
    const late = await createPendingLogin(db, INPUT, START);
    const justInTime = await createPendingLogin(db, INPUT, START);

    expect(await consumePendingLogin(db, late, after(5 * MINUTE_MS))).toBe(false);
    expect(await consumePendingLogin(db, justInTime, after(5 * MINUTE_MS - SECOND_MS))).toBe(true);
  });

  test("is false for an id that does not exist or is not an id", async () => {
    expect(await consumePendingLogin(db, "a".repeat(43), START)).toBe(false);
    expect(await consumePendingLogin(db, "nada", START)).toBe(false);
  });
});

describe("the cookie", () => {
  test("has its own name, different from the session cookie", () => {
    expect(PENDING_COOKIE).toBe("tallami_admin_pending");
  });

  test("is httpOnly, strict, limited to the login pages and lasts five minutes", () => {
    expect(pendingCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/admin/login",
      maxAge: 300,
    });
    expect(pendingCookieOptions(false).secure).toBe(false);
  });
});
