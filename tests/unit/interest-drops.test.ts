// El tope por hora de los clics y la cuenta de los que se descartan en silencio
// (por minuto o por hora): `interest_drops`, una fila por día de Argentina.

import { count, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { handleInterestRequest } from "@/admin/interest/endpoint";
import { countDroppedClick } from "@/admin/interest/drops";
import { interestDropsInRange } from "@/admin/interest/query";
import {
  INTEREST_GLOBAL_MAX_PER_HOUR,
  INTEREST_GLOBAL_MAX_PER_WINDOW,
  INTEREST_HOUR_MS,
  INTEREST_MAX_PER_WINDOW,
  recordInterest,
  type InterestEventInput,
} from "@/admin/interest/record";
import { INTEREST_RETENTION_DAYS, purgeOldInterest } from "@/admin/interest/retention";
import type { Db } from "@/db/client";
import { interestDrops, interestEvents } from "@/db/schema";
import { createTestDb } from "../helpers/db";
import { click } from "../helpers/interest-requests";

const SECRET = "secreto-de-prueba-de-mas-de-32-caracteres";
/** Martes 13/10/2026, 15:00 en Argentina. */
const NOW = new Date("2026-10-13T18:00:00.000Z");
const TODAY = "2026-10-13";
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
  await db.delete(interestEvents);
  await db.delete(interestDrops);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function event(ipHash: string): InterestEventInput {
  return { item: "lesson", locale: "es", country: null, ipHash };
}

async function seedEvents(rows: number, at: Date): Promise<void> {
  // En tandas: un solo `insert` de miles de filas pasa el máximo de parámetros de Postgres.
  const batch = 500;
  for (let start = 0; start < rows; start += batch) {
    await db.insert(interestEvents).values(
      Array.from({ length: Math.min(batch, rows - start) }, (_, index) => ({
        item: "lesson",
        locale: "es",
        ipHash: `semilla-${start + index}`,
        createdAt: at,
      })),
    );
  }
}

async function storedCount(): Promise<number> {
  const [row] = await db.select({ stored: count() }).from(interestEvents);
  return row.stored;
}

async function droppedOn(day: string): Promise<number> {
  const [row] = await db.select().from(interestDrops).where(eq(interestDrops.day, day));
  return row?.dropped ?? 0;
}

function handle(request: Request, now: Date = NOW): Promise<Response> {
  return handleInterestRequest(request, { getDb: async () => db, now: () => now });
}

describe("the hourly ceiling", () => {
  test("is 2000 events an hour, much more than the per-minute ceiling alone allows in a quiet day", () => {
    expect(INTEREST_GLOBAL_MAX_PER_HOUR).toBe(2000);
    expect(INTEREST_HOUR_MS).toBe(60 * MINUTE_MS);
    expect(INTEREST_GLOBAL_MAX_PER_HOUR).toBeGreaterThan(INTEREST_GLOBAL_MAX_PER_WINDOW);
  });

  test("with 2000 events in the last hour, spread over earlier minutes, a new click is dropped without a trace", async () => {
    // Ningún minuto pasa su tope, pero la hora sí: 2000 clics hace media hora.
    await seedEvents(INTEREST_GLOBAL_MAX_PER_HOUR, new Date(NOW.getTime() - 30 * MINUTE_MS));

    const response = await handle(click(undefined, { ip: "198.51.100.77" }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(await storedCount()).toBe(INTEREST_GLOBAL_MAX_PER_HOUR);
  });

  test("with 1999 it still stores the next one, and then the hour is full", async () => {
    await seedEvents(INTEREST_GLOBAL_MAX_PER_HOUR - 1, new Date(NOW.getTime() - 30 * MINUTE_MS));

    expect(await recordInterest(db, event("uno"), NOW)).toBe("stored");
    expect(await storedCount()).toBe(INTEREST_GLOBAL_MAX_PER_HOUR);
    expect(await recordInterest(db, event("dos"), NOW)).toBe("dropped");
    expect(await storedCount()).toBe(INTEREST_GLOBAL_MAX_PER_HOUR);
  });

  test("the window slides: events older than an hour do not count", async () => {
    await seedEvents(INTEREST_GLOBAL_MAX_PER_HOUR + 100, new Date(NOW.getTime() - 61 * MINUTE_MS));

    expect(await recordInterest(db, event("nuevo"), NOW)).toBe("stored");
  });

  test("an hour later the ceiling is gone", async () => {
    const at = new Date(NOW.getTime() - 30 * MINUTE_MS);
    await seedEvents(INTEREST_GLOBAL_MAX_PER_HOUR, at);
    expect(await recordInterest(db, event("lleno"), NOW)).toBe("dropped");

    const later = new Date(at.getTime() + INTEREST_HOUR_MS + 1);
    expect(await recordInterest(db, event("libre"), later)).toBe("stored");
  });

  test("a visitor over their own allowance still gets the 429, before the hourly ceiling", async () => {
    await seedEvents(INTEREST_GLOBAL_MAX_PER_HOUR, new Date(NOW.getTime() - 30 * MINUTE_MS));
    await db.insert(interestEvents).values(
      Array.from({ length: INTEREST_MAX_PER_WINDOW }, () => ({
        item: "lesson",
        locale: "es",
        ipHash: "insistente",
        createdAt: new Date(NOW.getTime() - 5_000),
      })),
    );

    expect(await recordInterest(db, event("insistente"), NOW)).toBe("rate-limited");
    expect(await droppedOn(TODAY)).toBe(0);
  });

  test("a burst of simultaneous visitors never stores more than the hourly ceiling", async () => {
    const limits = { hourly: 5 };
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) => recordInterest(db, event(`visitante-${index}`), NOW, limits)),
    );

    expect(await storedCount()).toBeLessThanOrEqual(5);
    expect(await storedCount()).toBe(results.filter((result) => result === "stored").length);
  });
});

describe("counting the dropped clicks", () => {
  test("a click dropped by the per-minute ceiling is counted on its Argentina day", async () => {
    await seedEvents(INTEREST_GLOBAL_MAX_PER_WINDOW, new Date(NOW.getTime() - 5_000));

    await handle(click(undefined, { ip: "198.51.100.1" }));
    await handle(click(undefined, { ip: "198.51.100.2" }));

    expect(await droppedOn(TODAY)).toBe(2);
    expect(await storedCount()).toBe(INTEREST_GLOBAL_MAX_PER_WINDOW);
  });

  test("a click dropped by the hourly ceiling is counted too", async () => {
    await seedEvents(INTEREST_GLOBAL_MAX_PER_HOUR, new Date(NOW.getTime() - 30 * MINUTE_MS));

    await handle(click(undefined, { ip: "198.51.100.1" }));

    expect(await droppedOn(TODAY)).toBe(1);
  });

  test("the day is Argentina's: 23:59:30 and 00:00:10 there are two different days", async () => {
    const limits = { global: 1 };
    const beforeMidnight = new Date("2026-10-14T02:59:30.000Z");
    const afterMidnight = new Date("2026-10-14T03:00:10.000Z");
    await recordInterest(db, event("a"), beforeMidnight, limits);

    await recordInterest(db, event("b"), beforeMidnight, limits);
    await recordInterest(db, event("c"), new Date(beforeMidnight.getTime() + 1_000), limits);
    // 40 segundos después, ya es el día siguiente en Argentina: el minuto sigue lleno.
    await recordInterest(db, event("d"), afterMidnight, limits);

    expect(await droppedOn("2026-10-13")).toBe(2);
    expect(await droppedOn("2026-10-14")).toBe(1);
  });

  test("a stored click and a click the visitor sent too often (429) are not dropped clicks", async () => {
    expect(await recordInterest(db, event("x"), NOW, { perIp: 1 })).toBe("stored");
    expect(await recordInterest(db, event("x"), NOW, { perIp: 1 })).toBe("rate-limited");

    expect(await droppedOn(TODAY)).toBe(0);
    expect(await db.select().from(interestDrops)).toEqual([]);
  });

  test("a bot, a bad body or a missing secret leave the counter alone", async () => {
    await seedEvents(INTEREST_GLOBAL_MAX_PER_WINDOW, new Date(NOW.getTime() - 5_000));

    await handle(click(undefined, { userAgent: "Googlebot/2.1" }));
    await handle(click({ item: "nada", locale: "es" }));
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    await handle(click());

    expect(await droppedOn(TODAY)).toBe(0);
  });

  test("simultaneous drops add up exactly: what was dropped is what was counted", async () => {
    const limits = { global: 3 };
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => recordInterest(db, event(`v-${index}`), NOW, limits)),
    );

    const dropped = results.filter((result) => result === "dropped").length;
    expect(dropped).toBeGreaterThan(0);
    expect(await droppedOn(TODAY)).toBe(dropped);
  });

  test("keeps one row per day, whatever the count", async () => {
    await countDroppedClick(db, NOW);
    await countDroppedClick(db, NOW);
    await countDroppedClick(db, new Date(NOW.getTime() + DAY_MS));

    const rows = await db.select().from(interestDrops).orderBy(interestDrops.day);
    expect(rows).toEqual([
      { day: "2026-10-13", dropped: 2 },
      { day: "2026-10-14", dropped: 1 },
    ]);
  });

  test("a failure while counting is logged without details and never turns the drop into an error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "insert") {
          return (table: unknown) =>
            table === interestDrops
              ? { values: () => { throw new Error("la base no contesta en postgres://secreto"); } }
              : target.insert(table as typeof interestEvents);
        }
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(countDroppedClick(failing, NOW)).resolves.toBeUndefined();
    expect(await recordInterest(failing, event("a"), NOW, { global: 0 })).toBe("dropped");

    expect(consoleError).toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secreto");
    consoleError.mockRestore();
  });
});

describe("the retention of the counter", () => {
  test("drops older than 400 days are deleted with the clicks, and the 400th day stays", async () => {
    const dayAt = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY_MS);
    await countDroppedClick(db, dayAt(INTEREST_RETENTION_DAYS + 5));
    await countDroppedClick(db, dayAt(INTEREST_RETENTION_DAYS + 1));
    await countDroppedClick(db, dayAt(INTEREST_RETENTION_DAYS));
    await countDroppedClick(db, dayAt(10));

    await purgeOldInterest(db, NOW);

    const days = (await db.select().from(interestDrops).orderBy(interestDrops.day)).map((row) => row.day);
    expect(days).toEqual(["2025-09-08", "2026-10-03"]);
  });
});

describe("interestDropsInRange", () => {
  async function seedDrops(rows: Record<string, number>): Promise<void> {
    await db.insert(interestDrops).values(Object.entries(rows).map(([day, dropped]) => ({ day, dropped })));
  }

  test("is zero when nothing was dropped", async () => {
    expect(await interestDropsInRange(db, { from: "2026-10-01", to: "2026-10-31" })).toBe(0);
  });

  test("adds up the days of the range, both ends included, and nothing else", async () => {
    await seedDrops({
      "2026-09-30": 100,
      "2026-10-01": 3,
      "2026-10-13": 5,
      "2026-10-31": 7,
      "2026-11-01": 200,
    });

    expect(await interestDropsInRange(db, { from: "2026-10-01", to: "2026-10-31" })).toBe(15);
    expect(await interestDropsInRange(db, { from: "2026-10-13", to: "2026-10-13" })).toBe(5);
    expect(await interestDropsInRange(db, { from: "2026-10-02", to: "2026-10-12" })).toBe(0);
    expect(await interestDropsInRange(db, { from: "2026-01-01", to: "2026-12-31" })).toBe(315);
  });
});
