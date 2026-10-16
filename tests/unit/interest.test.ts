import { count, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { SALE_ITEMS, INTEREST_ITEMS, INTEREST_LOCALES, SITE_BOOKING_ITEMS } from "@/admin/catalog";
import { hashIp } from "@/admin/auth/session";
import { isBotUserAgent } from "@/admin/interest/bots";
import { handleInterestRequest, MAX_BODY_BYTES } from "@/admin/interest/endpoint";
import { parseInterestPayload, readCountry } from "@/admin/interest/payload";
import { interestByItem } from "@/admin/interest/query";
import { INTEREST_MAX_PER_WINDOW, INTEREST_WINDOW_MS, recordInterest } from "@/admin/interest/record";
import { SERVICES } from "@/content/services";
import type { Db } from "@/db/client";
import { DbNotConfiguredError } from "@/db/client";
import { interestEvents } from "@/db/schema";
import { routing } from "@/i18n/routing";
import { createTestDb } from "../helpers/db";

const SECRET = "secreto-de-prueba-de-mas-de-32-caracteres";
const NOW = new Date("2026-10-13T18:00:00.000Z");
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

interface ClickOptions {
  ip?: string | null;
  userAgent?: string | null;
  country?: string;
  /** Texto del cuerpo tal cual; si falta se manda `body` como JSON. */
  raw?: string;
  method?: string;
}

/** Un pedido como el que manda el sitio: JSON chico, con la IP que pone Vercel. */
function click(body: unknown = { item: "lesson", locale: "es" }, options: ClickOptions = {}): Request {
  const { ip = "203.0.113.9", userAgent = CHROME, country, raw, method = "POST" } = options;
  const headers = new Headers({ "content-type": "application/json" });
  if (ip !== null) headers.set("x-forwarded-for", ip);
  if (userAgent !== null) headers.set("user-agent", userAgent);
  if (country !== undefined) headers.set("x-vercel-ip-country", country);
  return new Request("http://localhost/api/interest", {
    method,
    headers,
    body: method === "GET" ? undefined : (raw ?? JSON.stringify(body)),
  });
}

let db: Db;

function handle(request: Request, now: Date = NOW): Promise<Response> {
  return handleInterestRequest(request, { getDb: async () => db, now: () => now });
}

async function storedRows() {
  return db.select().from(interestEvents).orderBy(interestEvents.id);
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

describe("the closed lists of the interest endpoint", () => {
  test("accept every bookable item except 'other', in catalog order", () => {
    expect(INTEREST_ITEMS).toEqual(SALE_ITEMS.filter((item) => item !== "other"));
    expect(INTEREST_ITEMS).not.toContain("other");
  });

  test("accept every button of the public site", () => {
    // Los botones del menú de servicios más el de Temporada Pro.
    expect([...SITE_BOOKING_ITEMS]).toEqual([...SERVICES.map((service) => service.id), "proSeason"]);
    for (const item of SITE_BOOKING_ITEMS) {
      expect(INTEREST_ITEMS, item).toContain(item);
    }
  });

  test("accept exactly the languages of the site", () => {
    expect([...INTEREST_LOCALES]).toEqual([...routing.locales]);
  });
});

describe("POST /api/interest", () => {
  test("accepts a valid click and stores it without the raw ip", async () => {
    const response = await handle(click({ item: "vodLive", locale: "pt" }, { ip: "203.0.113.9", country: "BR" }));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ item: "vodLive", locale: "pt", country: "BR" });
    expect(row.createdAt).toEqual(NOW);
    // La IP solo queda como HMAC (hexadecimal de 64 caracteres) y nunca en claro.
    expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.ipHash).toBe(hashIp("203.0.113.9"));
    expect(JSON.stringify(row)).not.toContain("203.0.113.9");
  });

  test("keeps only a two-letter uppercase country from the Vercel header", async () => {
    const countries = ["AR", "ar", "ARG", "A", "A1", "", "<script>", "XX1"];
    for (const country of countries) {
      await handle(click({ item: "lesson", locale: "es" }, { country, ip: "198.51.100.1" }));
    }
    await handle(click({ item: "lesson", locale: "es" }, { ip: "198.51.100.1" }));

    const rows = await storedRows();
    expect(rows.map((row) => row.country)).toEqual(
      countries.map((country) => (country === "AR" ? "AR" : null)).concat([null]),
    );
  });

  test("every response says no-store", async () => {
    const responses = [
      await handle(click()),
      await handle(click({ item: "other", locale: "es" })),
      await handle(click(undefined, { raw: "x".repeat(MAX_BODY_BYTES + 1) })),
      await handle(click(undefined, { userAgent: "Googlebot/2.1" })),
    ];
    for (const response of responses) {
      expect(response.headers.get("cache-control"), String(response.status)).toBe("no-store");
    }
  });

  test.each([
    ["an unknown item", { item: "coaching-vip", locale: "es" }],
    ["the 'other' item, which has no button", { item: "other", locale: "es" }],
    ["an unknown language", { item: "lesson", locale: "fr" }],
    ["a missing language", { item: "lesson" }],
    ["a missing item", { locale: "es" }],
    ["an item that is not text", { item: 3, locale: "es" }],
    ["an item as a list", { item: ["lesson"], locale: "es" }],
    ["an extra field", { item: "lesson", locale: "es", note: "hola" }],
    ["a prototype key", JSON.parse('{"item":"lesson","locale":"es","__proto__":{"x":1}}')],
    ["a list", [{ item: "lesson", locale: "es" }]],
    ["null", null],
    ["a bare string", "lesson"],
  ])("rejects %s with 400 and stores nothing", async (_label, body) => {
    const response = await handle(click(body));

    expect(response.status).toBe(400);
    expect(await storedRows()).toHaveLength(0);
  });

  test.each([
    ["text that is not JSON", "item=lesson&locale=es"],
    ["broken JSON", '{"item":"lesson","locale":'],
    ["an empty body", ""],
  ])("rejects %s with 400", async (_label, raw) => {
    const response = await handle(click(undefined, { raw }));

    expect(response.status).toBe(400);
    expect(await storedRows()).toHaveLength(0);
  });

  test("never echoes what it received", async () => {
    const hostile = '<img src=x onerror=alert(1)>"tallami-eco-1234';
    const responses = [
      await handle(click({ item: hostile, locale: "es" })),
      await handle(click(undefined, { raw: hostile })),
      await handle(click(undefined, { raw: JSON.stringify({ item: "lesson", locale: "es", [hostile]: 1 }) })),
    ];

    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain("tallami-eco-1234");
      expect(response.headers.get("x-powered-by")).toBeNull();
    }
  });

  test("refuses a body over the size limit, declared or not", async () => {
    const valid = JSON.stringify({ item: "lesson", locale: "es" });
    const padded = `${valid}${" ".repeat(MAX_BODY_BYTES)}`;

    expect((await handle(click(undefined, { raw: padded }))).status).toBe(413);

    // Sin `content-length` (cuerpo en partes): se corta al pasar el límite.
    const chunks = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(valid.slice(0, 10)));
        controller.enqueue(encoder.encode(" ".repeat(MAX_BODY_BYTES)));
        controller.close();
      },
    });
    const streamed = new Request("http://localhost/api/interest", {
      method: "POST",
      headers: { "user-agent": CHROME, "x-forwarded-for": "203.0.113.9" },
      body: chunks,
      duplex: "half",
    } as RequestInit);
    expect((await handle(streamed)).status).toBe(413);
    expect(await storedRows()).toHaveLength(0);
  });

  test("drops bots with the same 204 and stores nothing", async () => {
    const bots = [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "curl/8.4.0",
      "python-requests/2.31.0",
      null,
      "",
    ];
    for (const userAgent of bots) {
      const response = await handle(click(undefined, { userAgent }));
      expect(response.status, String(userAgent)).toBe(204);
    }

    expect(await storedRows()).toHaveLength(0);
  });

  test("a bot gets no hint about the validation: even a broken body is a plain 204", async () => {
    const response = await handle(click(undefined, { userAgent: "AhrefsBot/7.0", raw: "no es json" }));

    expect(response.status).toBe(204);
    expect(await storedRows()).toHaveLength(0);
  });

  test("rate-limits bursts: 30 per minute per ip, then 429 with Retry-After", async () => {
    for (let index = 0; index < INTEREST_MAX_PER_WINDOW; index += 1) {
      expect((await handle(click())).status, `click ${index + 1}`).toBe(204);
    }
    const blocked = await handle(click());

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect(blocked.headers.get("cache-control")).toBe("no-store");
    expect(await storedRows()).toHaveLength(INTEREST_MAX_PER_WINDOW);
  });

  test("the limit is per ip: another visitor is not affected", async () => {
    for (let index = 0; index < INTEREST_MAX_PER_WINDOW; index += 1) await handle(click());

    expect((await handle(click(undefined, { ip: "203.0.113.77" }))).status).toBe(204);
    expect((await handle(click(undefined, { ip: "2001:db8::1" }))).status).toBe(204);
  });

  test("the window slides: a minute later the same ip can click again", async () => {
    for (let index = 0; index < INTEREST_MAX_PER_WINDOW; index += 1) await handle(click());
    expect((await handle(click())).status).toBe(429);

    const later = new Date(NOW.getTime() + INTEREST_WINDOW_MS + 1);
    expect((await handle(click(), later)).status).toBe(204);
  });

  test("invalid and bot requests do not use up the visitor's allowance", async () => {
    for (let index = 0; index < 40; index += 1) {
      await handle(click({ item: "other", locale: "es" }));
      await handle(click(undefined, { userAgent: "Googlebot/2.1" }));
    }

    expect((await handle(click())).status).toBe(204);
  });

  test("a burst of simultaneous requests never stores more than the limit", async () => {
    const responses = await Promise.all(Array.from({ length: 45 }, () => handle(click())));

    const accepted = responses.filter((response) => response.status === 204).length;
    const refused = responses.filter((response) => response.status === 429).length;
    const [{ stored }] = await db.select({ stored: count() }).from(interestEvents);
    expect(accepted + refused).toBe(45);
    expect(stored).toBeLessThanOrEqual(INTEREST_MAX_PER_WINDOW);
    // Lo que se contestó que sí es justo lo que quedó guardado.
    expect(stored).toBe(accepted);
  });

  test("requests without a usable ip share one allowance instead of failing", async () => {
    const response = await handle(click(undefined, { ip: null }));
    const second = await handle(click(undefined, { ip: "no-es-una-ip" }));

    expect(response.status).toBe(204);
    expect(second.status).toBe(204);
    const rows = await storedRows();
    expect(rows.map((row) => row.ipHash)).toEqual([hashIp("unknown"), hashIp("unknown")]);
  });

  test("without ADMIN_SESSION_SECRET it accepts and drops the click instead of crashing", async () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "");

    const response = await handle(click());

    expect(response.status).toBe(204);
    expect(await storedRows()).toHaveLength(0);
  });

  test("without a database it accepts and drops the click instead of crashing", async () => {
    const response = await handleInterestRequest(click(), {
      getDb: async () => {
        throw new DbNotConfiguredError();
      },
      now: () => NOW,
    });

    expect(response.status).toBe(204);
  });

  test("an unexpected database failure is a plain 500 with nothing leaked", async () => {
    const failure = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handleInterestRequest(click(), {
      getDb: async () => {
        throw new Error("connection refused postgres://user:clave-secreta@db.example.com");
      },
      now: () => NOW,
    });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("clave-secreta");
    expect(response.headers.get("cache-control")).toBe("no-store");
    failure.mockRestore();
  });
});

describe("recordInterest", () => {
  const EVENT = { item: "gamePlan", locale: "en", country: null, ipHash: "hash-uno" } as const;

  test("stores the event at the given time and reports it", async () => {
    expect(await recordInterest(db, EVENT, NOW)).toBe("stored");

    const [row] = await storedRows();
    expect(row).toMatchObject({ ...EVENT, createdAt: NOW });
  });

  test("a refused event leaves no row behind", async () => {
    for (let index = 0; index < INTEREST_MAX_PER_WINDOW; index += 1) await recordInterest(db, EVENT, NOW);

    expect(await recordInterest(db, EVENT, NOW)).toBe("rate-limited");
    const rows = await db.select({ stored: count() }).from(interestEvents).where(eq(interestEvents.ipHash, "hash-uno"));
    expect(rows[0].stored).toBe(INTEREST_MAX_PER_WINDOW);
  });
});

describe("parseInterestPayload and readCountry", () => {
  test("reads the two fields and nothing else", () => {
    expect(parseInterestPayload('{"item":"tournament","locale":"en"}')).toEqual({ item: "tournament", locale: "en" });
    expect(parseInterestPayload('{"item":"tournament","locale":"en","x":1}')).toBeNull();
    expect(parseInterestPayload("")).toBeNull();
  });

  test("readCountry accepts exactly two uppercase ASCII letters", () => {
    const from = (value?: string) => readCountry(new Headers(value === undefined ? {} : { "x-vercel-ip-country": value }));
    expect(from("MX")).toBe("MX");
    expect(from(undefined)).toBeNull();
    for (const bad of ["mx", "Mx", "MEX", "M", "M1", "ÑA"]) {
      expect(from(bad), bad).toBeNull();
    }
  });
});

describe("bots", () => {
  test.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 Chrome-Lighthouse",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "curl/8.4.0",
    "Wget/1.21.4",
    "python-requests/2.31.0",
    "Go-http-client/2.0",
    "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)",
    "axios/1.6.0",
    "SomeSpider/1.0",
    "",
    null,
    undefined,
  ])("treats %s as a bot", (userAgent) => {
    expect(isBotUserAgent(userAgent)).toBe(true);
  });

  test.each([
    CHROME,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
    "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0 (iPhone14,5)",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  ])("lets a real browser through: %s", (userAgent) => {
    expect(isBotUserAgent(userAgent)).toBe(false);
  });
});

describe("interest_events table", () => {
  test("rejects an item or a language outside the closed lists", async () => {
    const base = { item: "lesson", locale: "es", ipHash: "h" };

    await expect(db.insert(interestEvents).values({ ...base, item: "other" })).rejects.toThrow();
    await expect(db.insert(interestEvents).values({ ...base, locale: "fr" })).rejects.toThrow();
    await expect(db.insert(interestEvents).values({ ...base, country: "ar" })).rejects.toThrow();
    await expect(db.insert(interestEvents).values({ ...base, country: "A" })).rejects.toThrow();
    await db.insert(interestEvents).values({ ...base, country: "AR" });
    await db.insert(interestEvents).values({ ...base, country: null });
    expect(await storedRows()).toHaveLength(2);
  });
});

describe("interestByItem", () => {
  const at = (iso: string) => new Date(iso);

  async function seed(rows: readonly (readonly [string, string])[]): Promise<void> {
    await db.insert(interestEvents).values(
      rows.map(([item, createdAt]) => ({ item, locale: "es", ipHash: "h", createdAt: at(createdAt) })),
    );
  }

  test("returns every bookable item in catalog order, with zero for the ones nobody clicked", async () => {
    await seed([["lesson", "2026-10-05T15:00:00Z"]]);

    const rows = await interestByItem(db, { from: "2026-10-01", to: "2026-10-31" });

    expect(rows.map((row) => row.item)).toEqual([...INTEREST_ITEMS]);
    expect(rows.find((row) => row.item === "lesson")?.clicks).toBe(1);
    expect(rows.filter((row) => row.item !== "lesson").every((row) => row.clicks === 0)).toBe(true);
  });

  test("counts per item inside the range and ignores the rest", async () => {
    await seed([
      ["vodLive", "2026-10-05T15:00:00Z"],
      ["vodLive", "2026-10-20T15:00:00Z"],
      ["vodLive", "2026-09-20T15:00:00Z"],
      ["tournament", "2026-10-06T15:00:00Z"],
      ["tournament", "2026-11-02T15:00:00Z"],
    ]);

    const rows = await interestByItem(db, { from: "2026-10-01", to: "2026-10-31" });
    const clicks = Object.fromEntries(rows.map((row) => [row.item, row.clicks]));

    expect(clicks.vodLive).toBe(2);
    expect(clicks.tournament).toBe(1);
  });

  test("the days are Argentina's: 23:59 on the 30th is September, 00:00 on the 1st is October", async () => {
    // Argentina es UTC-3: las 03:00 UTC son las 00:00 del día de Argentina.
    await seed([
      ["lesson", "2026-10-01T02:59:59Z"],
      ["lesson", "2026-10-01T03:00:00Z"],
      ["lesson", "2026-11-01T02:59:59Z"],
      ["lesson", "2026-11-01T03:00:00Z"],
    ]);

    const october = await interestByItem(db, { from: "2026-10-01", to: "2026-10-31" });
    const september = await interestByItem(db, { from: "2026-09-01", to: "2026-09-30" });

    expect(october.find((row) => row.item === "lesson")?.clicks).toBe(2);
    expect(september.find((row) => row.item === "lesson")?.clicks).toBe(1);
  });

  test("a single day is a valid range", async () => {
    await seed([
      ["gamePlan", "2026-10-13T12:00:00Z"],
      ["gamePlan", "2026-10-14T12:00:00Z"],
    ]);

    const rows = await interestByItem(db, { from: "2026-10-13", to: "2026-10-13" });

    expect(rows.find((row) => row.item === "gamePlan")?.clicks).toBe(1);
  });
});
