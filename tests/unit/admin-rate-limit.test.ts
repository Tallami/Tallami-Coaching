import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  failuresInWindow,
  isLoginBlocked,
  recordLoginFailure,
} from "@/admin/auth/rate-limit";
import type { Db } from "@/db/client";
import { loginAttempts } from "@/db/schema";
import { createTestDb } from "../helpers/db";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

const NOW = new Date("2026-10-21T10:00:00.000Z");
const IP = "hash-de-una-ip";
const OTHER_IP = "hash-de-otra-ip";

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(loginAttempts);
});

async function recordFailures(count: number, ipHash: string, at: Date): Promise<void> {
  for (let i = 0; i < count; i += 1) await recordLoginFailure(db, ipHash, at);
}

describe("recordLoginFailure and failuresInWindow", () => {
  test("a failure is stored as a failed attempt of that connection, at the given time", async () => {
    await recordLoginFailure(db, IP, ago(MINUTE_MS));

    const rows = await db.select().from(loginAttempts);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ipHash: IP, succeeded: false, createdAt: ago(MINUTE_MS) });
  });

  test("counts only the failures of the last fifteen minutes", async () => {
    await recordLoginFailure(db, IP, ago(LOGIN_WINDOW_MS + MINUTE_MS));
    await recordLoginFailure(db, IP, ago(LOGIN_WINDOW_MS)); // justo en el borde: ya no cuenta
    await recordLoginFailure(db, IP, ago(LOGIN_WINDOW_MS - SECOND_MS));
    await recordLoginFailure(db, IP, ago(5 * MINUTE_MS));
    await recordLoginFailure(db, IP, NOW);

    expect(await failuresInWindow(db, IP, NOW)).toBe(3);
  });

  test("counts each connection apart", async () => {
    await recordFailures(2, IP, NOW);
    await recordFailures(4, OTHER_IP, NOW);

    expect(await failuresInWindow(db, IP, NOW)).toBe(2);
    expect(await failuresInWindow(db, OTHER_IP, NOW)).toBe(4);
    expect(await failuresInWindow(db, "una-ip-que-nunca-fallo", NOW)).toBe(0);
  });

  test("does not count attempts that ended well", async () => {
    await recordFailures(2, IP, NOW);
    await db.insert(loginAttempts).values({ ipHash: IP, succeeded: true, createdAt: NOW });

    expect(await failuresInWindow(db, IP, NOW)).toBe(2);
  });
});

describe("isLoginBlocked", () => {
  test("is false up to four failures and true from the fifth", async () => {
    await recordFailures(LOGIN_MAX_FAILURES - 1, IP, NOW);
    expect(await isLoginBlocked(db, IP, NOW)).toBe(false);

    await recordLoginFailure(db, IP, NOW);
    expect(await isLoginBlocked(db, IP, NOW)).toBe(true);
    expect(LOGIN_MAX_FAILURES).toBe(5);
  });

  test("blocks only the connection that failed", async () => {
    await recordFailures(LOGIN_MAX_FAILURES, IP, NOW);

    expect(await isLoginBlocked(db, IP, NOW)).toBe(true);
    expect(await isLoginBlocked(db, OTHER_IP, NOW)).toBe(false);
  });

  test("lifts by itself once the failures are older than fifteen minutes", async () => {
    await recordFailures(LOGIN_MAX_FAILURES, IP, NOW);

    expect(await isLoginBlocked(db, IP, new Date(NOW.getTime() + LOGIN_WINDOW_MS - SECOND_MS))).toBe(true);
    expect(await isLoginBlocked(db, IP, new Date(NOW.getTime() + LOGIN_WINDOW_MS))).toBe(false);
  });
});
