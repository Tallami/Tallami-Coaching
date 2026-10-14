import { readFileSync } from "node:fs";
import path from "node:path";
import { asc, count, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getArsPerUnit } from "@/admin/exchange-rate";
import type { Db } from "@/db/client";
import { exchangeRates } from "@/db/schema";
import { createTestDb } from "../helpers/db";

const BCRA_URL =
  "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones";

// Respuestas reales del BCRA (grabadas el 13/10/2026): del 30/9 al 10/10 hay
// cotización de lunes a viernes, y el 3-4 y el 10-11 son fin de semana.
function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "tests/fixtures/bcra", name), "utf8");
}
const USD_RANGE = fixture("usd-2026-09-30_2026-10-10.json");
const BRL_RANGE = fixture("brl-2026-09-30_2026-10-10.json");
const USD_EMPTY = fixture("usd-empty-2026-10-10_2026-10-11.json");
const BCRA_ERROR = fixture("error-future-date.json");

const SATURDAY = "2026-10-10";
const SUNDAY = "2026-10-11";
/** Lunes feriado: el BCRA no publica cotización aunque no sea fin de semana. */
const HOLIDAY_MONDAY = "2026-10-12";

type FetchMock = ReturnType<typeof mockFetch>;

/** Reemplaza `fetch`: cada llamada contesta una respuesta nueva con el cuerpo dado. */
function mockFetch(body: string | (() => Promise<Response>), status = 200) {
  const respond =
    typeof body === "function"
      ? body
      : async () => new Response(body, { status });
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    () => respond(),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestedUrls(fetchMock: FetchMock): string[] {
  return fetchMock.mock.calls.map(([url]) => url);
}

/** Respuesta del BCRA con las cotizaciones dadas, en el formato real. */
function bcraBody(
  currency: string,
  quotes: ReadonlyArray<readonly [fecha: string, tipoCotizacion: string]>,
): string {
  const results = quotes
    .map(
      ([fecha, tipo]) =>
        `{"fecha":"${fecha}","detalle":[{"codigoMoneda":"${currency}","descripcion":"X","tipoPase":0.0,"tipoCotizacion":${tipo}}]}`,
    )
    .join(",");
  return `{"status":200,"metadata":{"resultset":{"count":${quotes.length},"offset":0,"limit":1000}},"results":[${results}]}`;
}

describe("getArsPerUnit", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  beforeEach(async () => {
    vi.stubEnv("EXCHANGE_RATE_SOURCE", undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await db.delete(exchangeRates);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("with the BCRA", () => {
    test("uses the last BCRA quote on or before a weekend date", async () => {
      const fetchMock = mockFetch(USD_RANGE);

      const saturday = await getArsPerUnit(db, "USD", SATURDAY);
      const sunday = await getArsPerUnit(db, "USD", SUNDAY);

      const friday = { arsPerUnit: "1517.0000", quotedOn: "2026-10-09", source: "bcra" };
      expect(saturday).toEqual(friday);
      expect(sunday).toEqual(friday);
      expect(requestedUrls(fetchMock)[0]).toBe(
        `${BCRA_URL}/USD?fechadesde=2026-09-30&fechahasta=${SATURDAY}`,
      );
    });

    test("uses the last quote before a holiday that falls on a weekday", async () => {
      mockFetch(USD_RANGE);

      expect(await getArsPerUnit(db, "USD", HOLIDAY_MONDAY)).toEqual({
        arsPerUnit: "1517.0000",
        quotedOn: "2026-10-09",
        source: "bcra",
      });
    });

    test("returns the quote of the day itself when there is one", async () => {
      mockFetch(USD_RANGE);

      expect(await getArsPerUnit(db, "USD", "2026-10-08")).toEqual({
        arsPerUnit: "1515.5000",
        quotedOn: "2026-10-08",
        source: "bcra",
      });
    });

    test("quotes the real as pesos per real, with four decimals", async () => {
      const fetchMock = mockFetch(BRL_RANGE);

      expect(await getArsPerUnit(db, "BRL", SATURDAY)).toEqual({
        arsPerUnit: "304.1543",
        quotedOn: "2026-10-09",
        source: "bcra",
      });
      expect(requestedUrls(fetchMock)[0]).toContain("/Cotizaciones/BRL?");
    });

    test("values USDT as dollars", async () => {
      const fetchMock = mockFetch(USD_RANGE);

      expect(await getArsPerUnit(db, "USDT", SATURDAY)).toEqual({
        arsPerUnit: "1517.0000",
        quotedOn: "2026-10-09",
        source: "bcra",
      });
      expect(requestedUrls(fetchMock)[0]).toContain("/Cotizaciones/USD?");
      // Lo guardado es la cotización del dólar: también sirve para USD.
      const fetchAgain = mockFetch(USD_RANGE);
      await getArsPerUnit(db, "USD", SATURDAY);
      expect(fetchAgain).not.toHaveBeenCalled();
    });

    test("rounds the BCRA's eight decimals half-up without float errors", async () => {
      // 1.00105 en binario queda apenas debajo del empate: toFixed(4) daría 1.0010.
      mockFetch(bcraBody("USD", [["2026-10-09", "1.00105000"]]));

      expect((await getArsPerUnit(db, "USD", SATURDAY))?.arsPerUnit).toBe("1.0011");
    });

    test("pads whole-number quotes to four decimals", async () => {
      mockFetch(bcraBody("USD", [["2026-10-09", "1517"]]));

      expect((await getArsPerUnit(db, "USD", SATURDAY))?.arsPerUnit).toBe("1517.0000");
    });

    test("skips malformed entries and keeps the valid ones", async () => {
      mockFetch(
        `{"results":[
          {"fecha":"2026-10-09","detalle":[{"codigoMoneda":"EUR","tipoCotizacion":1700.0}]},
          {"fecha":"2026-10-08","detalle":[{"codigoMoneda":"USD","tipoCotizacion":0}]},
          {"fecha":"2026-10-07","detalle":[{"codigoMoneda":"USD","tipoCotizacion":"abc"}]},
          {"fecha":"mañana","detalle":[{"codigoMoneda":"USD","tipoCotizacion":1500.0}]},
          {"fecha":"2026-10-06","detalle":"nada"},
          {"fecha":"2026-10-05"},
          null,
          {"fecha":"2026-10-02","detalle":[{"codigoMoneda":"USD","tipoCotizacion":1520.5}]}
        ]}`,
      );

      expect(await getArsPerUnit(db, "USD", SATURDAY)).toEqual({
        arsPerUnit: "1520.5000",
        quotedOn: "2026-10-02",
        source: "bcra",
      });
    });

    test("ignores quotes dated after the requested day", async () => {
      mockFetch(
        bcraBody("USD", [
          ["2026-10-13", "1512.5"],
          ["2026-10-09", "1517.0"],
        ]),
      );

      expect((await getArsPerUnit(db, "USD", SATURDAY))?.quotedOn).toBe("2026-10-09");
    });
  });

  describe("cache", () => {
    test("caches quotes and does not call the BCRA twice", async () => {
      const fetchMock = mockFetch(USD_RANGE);

      const first = await getArsPerUnit(db, "USD", SATURDAY);
      const second = await getArsPerUnit(db, "USD", SATURDAY);

      expect(second).toEqual(first);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("keeps every quote received, and serves them without the BCRA", async () => {
      const fetchMock = mockFetch(USD_RANGE);
      await getArsPerUnit(db, "USD", SATURDAY);

      const stored = await db
        .select()
        .from(exchangeRates)
        .where(eq(exchangeRates.currency, "USD"))
        .orderBy(asc(exchangeRates.quotedOn));
      expect(stored.map((row) => [row.quotedOn, row.arsPerUnit])).toEqual([
        ["2026-09-30", "1517.0000"],
        ["2026-10-01", "1524.5000"],
        ["2026-10-02", "1520.0000"],
        ["2026-10-05", "1520.0000"],
        ["2026-10-06", "1520.0000"],
        ["2026-10-07", "1517.0000"],
        ["2026-10-08", "1515.5000"],
        ["2026-10-09", "1517.0000"],
      ]);
      expect(stored.every((row) => row.source === "bcra")).toBe(true);

      // Un día de semana y un domingo ya guardados: sin otra llamada.
      expect((await getArsPerUnit(db, "USD", "2026-10-07"))?.arsPerUnit).toBe("1517.0000");
      expect((await getArsPerUnit(db, "USD", SUNDAY))?.quotedOn).toBe("2026-10-09");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("does not trust an old quote when the weekday's own quote is missing", async () => {
      // Solo está la del miércoles 7: el sábado 10 el último día hábil es el viernes 9.
      await db
        .insert(exchangeRates)
        .values({
          currency: "USD",
          quotedOn: "2026-10-07",
          arsPerUnit: "1517.0000",
          source: "bcra",
        });
      const fetchMock = mockFetch(USD_RANGE);

      const rate = await getArsPerUnit(db, "USD", SATURDAY);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(rate?.quotedOn).toBe("2026-10-09");
    });

    test("keeps each currency in its own quotes", async () => {
      mockFetch(USD_RANGE);
      await getArsPerUnit(db, "USD", SATURDAY);
      const brl = mockFetch(BRL_RANGE);

      expect((await getArsPerUnit(db, "BRL", SATURDAY))?.arsPerUnit).toBe("304.1543");
      expect(brl).toHaveBeenCalledTimes(1);
    });

    test("refreshes a stored quote when the BCRA answers again", async () => {
      await db.insert(exchangeRates).values({
        currency: "USD",
        quotedOn: "2026-10-07",
        arsPerUnit: "1.0000",
        source: "bcra",
      });
      mockFetch(USD_RANGE);

      // El sábado se pide al BCRA (falta el viernes) y trae el miércoles de nuevo.
      await getArsPerUnit(db, "USD", SATURDAY);

      const rows = await db
        .select({ arsPerUnit: exchangeRates.arsPerUnit })
        .from(exchangeRates)
        .where(eq(exchangeRates.quotedOn, "2026-10-07"));
      expect(rows).toEqual([{ arsPerUnit: "1517.0000" }]);
    });
  });

  describe("when the BCRA does not give a quote", () => {
    test("returns null when the BCRA fails", async () => {
      mockFetch(async () => {
        throw new TypeError("fetch failed");
      });
      expect(await getArsPerUnit(db, "USD", SATURDAY)).toBeNull();

      mockFetch("Internal Server Error", 500);
      expect(await getArsPerUnit(db, "USD", SATURDAY)).toBeNull();
    });

    test("returns null for the BCRA's own error answer", async () => {
      mockFetch(BCRA_ERROR, 400);

      expect(await getArsPerUnit(db, "USD", SATURDAY)).toBeNull();
    });

    test("returns null when the answer has no quotes or is not JSON", async () => {
      mockFetch(USD_EMPTY);
      expect(await getArsPerUnit(db, "USD", SATURDAY)).toBeNull();

      mockFetch("<html>Gateway Timeout</html>");
      expect(await getArsPerUnit(db, "USD", SATURDAY)).toBeNull();

      mockFetch('{"status":200,"results":"nada"}');
      expect(await getArsPerUnit(db, "USD", SATURDAY)).toBeNull();
    });

    test("returns null when only quotes after the date come back", async () => {
      mockFetch(bcraBody("USD", [["2026-10-13", "1512.5"]]));

      expect(await getArsPerUnit(db, "USD", SATURDAY)).toBeNull();
    });

    test("gives up after five seconds", async () => {
      const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(AbortSignal.abort());
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.signal?.aborted) throw new DOMException("Timed out", "TimeoutError");
          return new Response(USD_RANGE);
        }),
      );

      expect(await getArsPerUnit(db, "USD", SATURDAY)).toBeNull();
      expect(timeout).toHaveBeenCalledWith(5000);
    });

    test("does not store anything on failure, so the next call tries again", async () => {
      const failing = mockFetch("Internal Server Error", 500);
      await getArsPerUnit(db, "USD", SATURDAY);
      const [{ stored }] = await db.select({ stored: count() }).from(exchangeRates);
      expect(stored).toBe(0);
      expect(failing).toHaveBeenCalledTimes(1);

      const working = mockFetch(USD_RANGE);
      expect((await getArsPerUnit(db, "USD", SATURDAY))?.quotedOn).toBe("2026-10-09");
      expect(working).toHaveBeenCalledTimes(1);
    });

    test("tells the server log what went wrong", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockFetch("Internal Server Error", 500);

      await getArsPerUnit(db, "USD", SATURDAY);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/BCRA/);
    });
  });

  describe("pesos", () => {
    test("is one peso per peso and never asks anyone", async () => {
      const fetchMock = mockFetch(USD_RANGE);

      expect(await getArsPerUnit(db, "ARS", SATURDAY)).toEqual({
        arsPerUnit: "1.0000",
        quotedOn: SATURDAY,
        source: "fixed",
      });
      expect(await getArsPerUnit(db, "ARS", "2010-05-01")).toMatchObject({
        arsPerUnit: "1.0000",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("fixed source", () => {
    beforeEach(() => {
      vi.stubEnv("EXCHANGE_RATE_SOURCE", "fixed");
    });

    test("fixed source never calls fetch", async () => {
      const fetchMock = mockFetch(USD_RANGE);

      expect(await getArsPerUnit(db, "USD", SATURDAY)).toEqual({
        arsPerUnit: "1500.0000",
        quotedOn: SATURDAY,
        source: "fixed",
      });
      expect((await getArsPerUnit(db, "USDT", SATURDAY))?.arsPerUnit).toBe("1500.0000");
      expect((await getArsPerUnit(db, "BRL", SATURDAY))?.arsPerUnit).toBe("280.0000");
      expect((await getArsPerUnit(db, "ARS", SATURDAY))?.arsPerUnit).toBe("1.0000");
      expect(fetchMock).not.toHaveBeenCalled();
      const [{ stored }] = await db.select({ stored: count() }).from(exchangeRates);
      expect(stored).toBe(0);
    });

    test("answers null before 2020 so e2e tests can enter the rate by hand", async () => {
      const fetchMock = mockFetch(USD_RANGE);

      expect(await getArsPerUnit(db, "USD", "2019-12-31")).toBeNull();
      expect(await getArsPerUnit(db, "USDT", "2015-06-01")).toBeNull();
      expect(await getArsPerUnit(db, "BRL", "2019-12-31")).toBeNull();
      expect((await getArsPerUnit(db, "USD", "2020-01-01"))?.arsPerUnit).toBe("1500.0000");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("date", () => {
    test.each(["", "10/10/2026", "2026-1-5", "2026-02-30", "2026-13-01", "hoy"])(
      "rejects the date %j",
      async (date) => {
        const fetchMock = mockFetch(USD_RANGE);

        await expect(getArsPerUnit(db, "USD", date)).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });
});
