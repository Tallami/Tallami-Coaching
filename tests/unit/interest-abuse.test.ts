// Resistencia a abusos y privacidad de `/api/interest`: clave de IP por /64,
// hash con sal del día, tope global, `content-type` y retención.

import { count } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { loginIpHash } from "@/admin/auth/login-ip";
import { handleInterestRequest } from "@/admin/interest/endpoint";
import { interestIpHash } from "@/admin/interest/ip-key";
import {
  INTEREST_GLOBAL_MAX_PER_WINDOW,
  INTEREST_MAX_PER_WINDOW,
  INTEREST_WINDOW_MS,
  recordInterest,
  type InterestEventInput,
} from "@/admin/interest/record";
import {
  INTEREST_RETENTION_DAYS,
  PURGE_EVERY_MS,
  purgeInterestIfDue,
  purgeOldInterest,
} from "@/admin/interest/retention";
import { interestIpKey } from "@/admin/net/ip-key";
import type { Db } from "@/db/client";
import { interestEvents } from "@/db/schema";
import { createTestDb } from "../helpers/db";
import { click } from "../helpers/interest-requests";

const SECRET = "secreto-de-prueba-de-mas-de-32-caracteres";
const NOW = new Date("2026-10-13T18:00:00.000Z");
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

let db: Db;

function handle(request: Request, now: Date = NOW): Promise<Response> {
  return handleInterestRequest(request, { getDb: async () => db, now: () => now });
}

async function storedCount(): Promise<number> {
  const [row] = await db.select({ stored: count() }).from(interestEvents);
  return row.stored;
}

async function clicksFrom(ip: string, times: number, now: Date = NOW): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < times; index += 1) statuses.push((await handle(click(undefined, { ip }), now)).status);
  return statuses;
}

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
  await db.delete(interestEvents);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("interestIpKey: who counts as the same visitor", () => {
  test.each([
    ["203.0.113.9", "v4:203.0.113.9"],
    ["::ffff:203.0.113.9", "v4:203.0.113.9"],
    ["::FFFF:203.0.113.9", "v4:203.0.113.9"],
    ["::ffff:cb00:7109", "v4:203.0.113.9"],
    ["0:0:0:0:0:ffff:cb00:7109", "v4:203.0.113.9"],
    ["2001:db8:1:2::1", "v6:2001:db8:1:2"],
    ["2001:DB8:1:2::1", "v6:2001:db8:1:2"],
    ["2001:0db8:0001:0002:0000:0000:0000:0001", "v6:2001:db8:1:2"],
    ["2001:db8:1:2:ffff:ffff:ffff:ffff", "v6:2001:db8:1:2"],
    ["2001:db8:1:2:abcd:ef01:2345:6789", "v6:2001:db8:1:2"],
    ["2001:db8::", "v6:2001:db8:0:0"],
    ["2001:db8:0:0:1::", "v6:2001:db8:0:0"],
    ["::1", "v6:0:0:0:0"],
    ["fe80::1%eth0", "v6:fe80:0:0:0"],
    ["unknown", "unknown"],
    ["no-es-una-ip", "unknown"],
    ["", "unknown"],
  ])("%s is %s", (ip, key) => {
    expect(interestIpKey(ip)).toBe(key);
  });

  test("two addresses of the same /64 share a key, different /64 do not, and the 65th bit matters not", () => {
    expect(interestIpKey("2001:db8:1:2::1")).toBe(interestIpKey("2001:db8:1:2:8000::1"));
    expect(interestIpKey("2001:db8:1:2::1")).not.toBe(interestIpKey("2001:db8:1:3::1"));
    expect(interestIpKey("2001:db8:1:2::1")).not.toBe(interestIpKey("2001:db8:2:2::1"));
  });

  test("an IPv4 address and a v6 address never share a key", () => {
    expect(interestIpKey("203.0.113.9")).not.toBe(interestIpKey("2001:db8::1"));
    expect(interestIpKey("203.0.113.9")).not.toBe(interestIpKey("203.0.113.10"));
  });
});

describe("interestIpHash: a salt per day", () => {
  test("is the same for the same visitor on the same day, and a hex HMAC", () => {
    expect(interestIpHash("203.0.113.9", "2026-10-13")).toBe(interestIpHash("203.0.113.9", "2026-10-13"));
    expect(interestIpHash("203.0.113.9", "2026-10-13")).toMatch(/^[0-9a-f]{64}$/);
    expect(interestIpHash("::ffff:203.0.113.9", "2026-10-13")).toBe(interestIpHash("203.0.113.9", "2026-10-13"));
    expect(interestIpHash("2001:db8:1:2::1", "2026-10-13")).toBe(interestIpHash("2001:db8:1:2::9", "2026-10-13"));
  });

  test("changes from one day to the next, so rows cannot be linked across days", () => {
    expect(interestIpHash("203.0.113.9", "2026-10-13")).not.toBe(interestIpHash("203.0.113.9", "2026-10-14"));
  });

  test("is not the login's hash for the same ip, so it cannot be linked to login_attempts", () => {
    const login = loginIpHash("203.0.113.9");
    for (const day of ["2026-10-13", "2026-10-14"]) {
      expect(interestIpHash("203.0.113.9", day)).not.toBe(login);
    }
    expect(interestIpHash("unknown", "2026-10-13")).not.toBe(loginIpHash("unknown"));
  });

  test("differs between visitors", () => {
    expect(interestIpHash("203.0.113.9", "2026-10-13")).not.toBe(interestIpHash("203.0.113.10", "2026-10-13"));
  });

  test("stored rows of the same visitor on two days have different hashes, none of them the login's", async () => {
    await handle(click(), NOW);
    await handle(click(), new Date(NOW.getTime() + DAY_MS));

    const rows = await db.select().from(interestEvents).orderBy(interestEvents.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].ipHash).toBe(interestIpHash("203.0.113.9", "2026-10-13"));
    expect(rows[1].ipHash).toBe(interestIpHash("203.0.113.9", "2026-10-14"));
    expect(rows[0].ipHash).not.toBe(rows[1].ipHash);
    expect(rows.map((row) => row.ipHash)).not.toContain(loginIpHash("203.0.113.9"));
  });

  test("the day is Argentina's: 23:59:30 and 00:00:10 there fall on different days", async () => {
    const beforeMidnight = new Date("2026-10-14T02:59:30.000Z");
    const afterMidnight = new Date("2026-10-14T03:00:10.000Z");
    await handle(click(), beforeMidnight);
    await handle(click(), afterMidnight);

    const rows = await db.select().from(interestEvents).orderBy(interestEvents.id);
    expect(rows[0].ipHash).toBe(interestIpHash("203.0.113.9", "2026-10-13"));
    expect(rows[1].ipHash).toBe(interestIpHash("203.0.113.9", "2026-10-14"));
  });

  test("the allowance still works within a day, and a midnight straddle only starts a fresh count", async () => {
    const beforeMidnight = new Date("2026-10-14T02:59:30.000Z");
    const afterMidnight = new Date("2026-10-14T03:00:10.000Z");
    const statuses = await clicksFrom("203.0.113.9", INTEREST_MAX_PER_WINDOW + 1, beforeMidnight);
    expect(statuses.slice(-1)).toEqual([429]);

    expect((await handle(click(), afterMidnight)).status).toBe(204);
  });
});

describe("one visitor is one /64, not one address", () => {
  test("30 clicks from a /64 use up the allowance of every address inside it", async () => {
    const first = await clicksFrom("2001:db8:1:2::1", INTEREST_MAX_PER_WINDOW);
    expect(first.every((status) => status === 204)).toBe(true);

    expect((await handle(click(undefined, { ip: "2001:db8:1:2:abcd:ef01:2345:6789" }))).status).toBe(429);
    expect((await handle(click(undefined, { ip: "2001:0DB8:0001:0002:0000:0000:0000:0042" }))).status).toBe(429);
    // Otro /64 no se entera.
    expect((await handle(click(undefined, { ip: "2001:db8:1:3::1" }))).status).toBe(204);
  });

  test("rotating the last 64 bits on every request does not escape the limit or grow the table", async () => {
    const responses = [];
    for (let index = 0; index < INTEREST_MAX_PER_WINDOW + 20; index += 1) {
      const suffix = (index + 1).toString(16);
      responses.push(await handle(click(undefined, { ip: `2001:db8:aaaa:bbbb:${suffix}:${suffix}:${suffix}:${suffix}` })));
    }

    expect(responses.filter((response) => response.status === 204)).toHaveLength(INTEREST_MAX_PER_WINDOW);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(20);
    expect(await storedCount()).toBe(INTEREST_MAX_PER_WINDOW);
  });

  test("an IPv4-mapped IPv6 address counts as its IPv4 address, in both spellings", async () => {
    await clicksFrom("203.0.113.9", INTEREST_MAX_PER_WINDOW);

    expect((await handle(click(undefined, { ip: "::ffff:203.0.113.9" }))).status).toBe(429);
    expect((await handle(click(undefined, { ip: "::ffff:cb00:7109" }))).status).toBe(429);
    expect((await handle(click(undefined, { ip: "::ffff:203.0.113.10" }))).status).toBe(204);
  });

  test("stores one hash per /64 and the raw address nowhere", async () => {
    await handle(click(undefined, { ip: "2001:db8:1:2::1" }));
    await handle(click(undefined, { ip: "2001:db8:1:2::2" }));

    const rows = await db.select().from(interestEvents);
    expect(new Set(rows.map((row) => row.ipHash)).size).toBe(1);
    expect(JSON.stringify(rows)).not.toContain("2001:db8");
  });
});

describe("content-type", () => {
  test.each([
    ["application/json"],
    ["application/json; charset=utf-8"],
    ["Application/JSON"],
    ["application/json;charset=UTF-8"],
  ])("accepts %s", async (contentType) => {
    expect((await handle(click(undefined, { contentType, ip: `198.51.100.${contentType.length}` }))).status).toBe(204);
  });

  test.each([
    ["text/plain"],
    ["text/plain;charset=UTF-8"],
    ["application/x-www-form-urlencoded"],
    ["multipart/form-data; boundary=x"],
    ["application/xml"],
    ["application/jsonp"],
    ["application/json-seq"],
    ["application/vnd.api+json"],
    [""],
  ])("rejects %j with 415 and stores nothing", async (contentType) => {
    const response = await handle(click(undefined, { contentType }));

    expect(response.status).toBe(415);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "unsupported_media_type" });
    expect(await storedCount()).toBe(0);
  });

  test("a valid body sent as text/plain (what a cross-site no-cors POST can send) is refused", async () => {
    const response = await handle(
      click(undefined, { contentType: "text/plain", raw: JSON.stringify({ item: "lesson", locale: "es" }) }),
    );

    expect(response.status).toBe(415);
    expect(await storedCount()).toBe(0);
  });

  test("a bot still gets the plain 204 whatever its content-type", async () => {
    const response = await handle(click(undefined, { userAgent: "Googlebot/2.1", contentType: "text/plain" }));

    expect(response.status).toBe(204);
  });

  test("is checked before the body is read", async () => {
    const response = await handle(click(undefined, { contentType: "text/plain", raw: "x".repeat(5000) }));

    expect(response.status).toBe(415);
  });
});

describe("the global ceiling", () => {
  const seedRows = async (rows: number, at: Date, prefix = "otro") =>
    db.insert(interestEvents).values(
      Array.from({ length: rows }, (_, index) => ({
        item: "lesson",
        locale: "es",
        ipHash: `${prefix}-${index}`,
        createdAt: at,
      })),
    );

  test("is generous: between 200 and 300 events a minute", () => {
    expect(INTEREST_GLOBAL_MAX_PER_WINDOW).toBeGreaterThanOrEqual(200);
    expect(INTEREST_GLOBAL_MAX_PER_WINDOW).toBeLessThanOrEqual(300);
  });

  test("past the ceiling a new visitor gets a silent 204 and nothing is stored", async () => {
    await seedRows(INTEREST_GLOBAL_MAX_PER_WINDOW, new Date(NOW.getTime() - 5_000));

    const response = await handle(click(undefined, { ip: "198.51.100.77" }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(await storedCount()).toBe(INTEREST_GLOBAL_MAX_PER_WINDOW);
  });

  test("just under the ceiling still stores, and only the old rows of other minutes do not count", async () => {
    await seedRows(INTEREST_GLOBAL_MAX_PER_WINDOW - 1, new Date(NOW.getTime() - 5_000));
    expect((await handle(click(undefined, { ip: "198.51.100.1" }))).status).toBe(204);
    expect(await storedCount()).toBe(INTEREST_GLOBAL_MAX_PER_WINDOW);

    await db.delete(interestEvents);
    await seedRows(INTEREST_GLOBAL_MAX_PER_WINDOW + 50, new Date(NOW.getTime() - 2 * MINUTE_MS));
    expect((await handle(click(undefined, { ip: "198.51.100.2" }))).status).toBe(204);
    expect(await storedCount()).toBe(INTEREST_GLOBAL_MAX_PER_WINDOW + 51);
  });

  test("the window slides: a minute later the ceiling is gone", async () => {
    const at = new Date(NOW.getTime() - 5_000);
    await seedRows(INTEREST_GLOBAL_MAX_PER_WINDOW, at);
    await handle(click(undefined, { ip: "198.51.100.77" }));
    expect(await storedCount()).toBe(INTEREST_GLOBAL_MAX_PER_WINDOW);

    await handle(click(undefined, { ip: "198.51.100.77" }), new Date(at.getTime() + INTEREST_WINDOW_MS + 1));

    expect(await storedCount()).toBe(INTEREST_GLOBAL_MAX_PER_WINDOW + 1);
  });

  test("recordInterest reports it as dropped, after the per-ip limit", async () => {
    const limits = { perIp: INTEREST_MAX_PER_WINDOW, global: 3 };
    const event = (ipHash: string): InterestEventInput => ({ item: "lesson", locale: "es", country: null, ipHash });
    const results = [];
    for (const ipHash of ["a", "b", "c", "d", "e"]) results.push(await recordInterest(db, event(ipHash), NOW, limits));

    expect(results).toEqual(["stored", "stored", "stored", "dropped", "dropped"]);
    expect(await storedCount()).toBe(3);
    // Quien ya pasó su propio tope sigue recibiendo 429, no el descarte silencioso.
    const tight = { perIp: 1, global: 100 };
    await db.delete(interestEvents);
    expect(await recordInterest(db, event("x"), NOW, tight)).toBe("stored");
    expect(await recordInterest(db, event("x"), NOW, tight)).toBe("rate-limited");
  });

  test("checks the visitor, the minute and the hour with one query each time it counts", async () => {
    const event = (ipHash: string): InterestEventInput => ({ item: "lesson", locale: "es", country: null, ipHash });
    const select = vi.spyOn(db, "select");

    // Una vez antes de reservar y otra con el evento ya anotado: dos consultas en total, no seis.
    expect(await recordInterest(db, event("a"), NOW)).toBe("stored");
    expect(select).toHaveBeenCalledTimes(2);

    // Quien ya pasó su tope se entera en la primera consulta y no escribe nada.
    select.mockClear();
    expect(await recordInterest(db, event("a"), NOW, { perIp: 1 })).toBe("rate-limited");
    expect(select).toHaveBeenCalledTimes(1);

    // Lo mismo con el tope global.
    select.mockClear();
    expect(await recordInterest(db, event("b"), NOW, { global: 1 })).toBe("dropped");
    expect(select).toHaveBeenCalledTimes(1);
    select.mockRestore();
  });

  test("a burst of simultaneous visitors never stores more than the ceiling", async () => {
    const limits = { perIp: INTEREST_MAX_PER_WINDOW, global: 5 };
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        recordInterest(db, { item: "lesson", locale: "es", country: null, ipHash: `visitor-${index}` }, NOW, limits),
      ),
    );

    const stored = results.filter((result) => result === "stored").length;
    expect(await storedCount()).toBeLessThanOrEqual(5);
    expect(await storedCount()).toBe(stored);
  });
});

describe("retention", () => {
  const rowAt = (daysAgo: number, label: string) => ({
    item: "lesson",
    locale: "es",
    ipHash: label,
    createdAt: new Date(NOW.getTime() - daysAgo * DAY_MS),
  });
  const labels = async (database: Db) =>
    (await database.select({ ipHash: interestEvents.ipHash }).from(interestEvents)).map((row) => row.ipHash).sort();

  test("keeps 400 days of clicks", () => {
    expect(INTEREST_RETENTION_DAYS).toBe(400);
  });

  test("purgeOldInterest deletes what is older than 400 days and nothing else", async () => {
    await db.insert(interestEvents).values([
      rowAt(500, "viejo"),
      rowAt(401, "apenas-viejo"),
      rowAt(400, "justo"),
      rowAt(399, "reciente"),
      rowAt(1, "ayer"),
    ]);

    await purgeOldInterest(db, NOW);

    expect(await labels(db)).toEqual(["ayer", "justo", "reciente"]);
  });

  test("recordInterest cleans up as it goes, at most once an hour", async () => {
    const fresh = await createTestDb();
    const event = (ipHash: string): InterestEventInput => ({ item: "lesson", locale: "es", country: null, ipHash });
    await fresh.insert(interestEvents).values(rowAt(500, "viejo-1"));

    expect(await recordInterest(fresh, event("a"), NOW)).toBe("stored");
    expect(await labels(fresh)).toEqual(["a"]);

    await fresh.insert(interestEvents).values(rowAt(500, "viejo-2"));
    const soon = new Date(NOW.getTime() + PURGE_EVERY_MS - MINUTE_MS);
    expect(await recordInterest(fresh, event("b"), soon)).toBe("stored");
    expect(await labels(fresh)).toEqual(["a", "b", "viejo-2"]);

    const later = new Date(NOW.getTime() + PURGE_EVERY_MS + MINUTE_MS);
    expect(await recordInterest(fresh, event("c"), later)).toBe("stored");
    expect(await labels(fresh)).toEqual(["a", "b", "c"]);
  });

  test("purgeInterestIfDue runs once per database and does not go back in time", async () => {
    const fresh = await createTestDb();
    await fresh.insert(interestEvents).values(rowAt(500, "viejo-1"));

    expect(await purgeInterestIfDue(fresh, NOW)).toBe(true);
    await fresh.insert(interestEvents).values(rowAt(500, "viejo-2"));
    expect(await purgeInterestIfDue(fresh, NOW)).toBe(false);
    expect(await purgeInterestIfDue(fresh, new Date(NOW.getTime() - DAY_MS))).toBe(false);
    expect(await purgeInterestIfDue(fresh, new Date(NOW.getTime() + PURGE_EVERY_MS))).toBe(true);
    expect(await labels(fresh)).toEqual([]);
  });

  test("a purge failure never fails the request and logs only the error type", async () => {
    const fresh = await createTestDb();
    const failure = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const spy = vi.spyOn(fresh, "delete").mockImplementation(() => {
      throw new Error("connection refused postgres://user:clave-secreta@db.example.com");
    });

    const result = await recordInterest(fresh, { item: "lesson", locale: "es", country: null, ipHash: "a" }, NOW);

    expect(result).toBe("stored");
    expect(spy).toHaveBeenCalled();
    expect(failure).toHaveBeenCalled();
    expect(JSON.stringify(failure.mock.calls)).not.toContain("clave-secreta");
    failure.mockRestore();
    spy.mockRestore();
  });
});
