// Tipo de cambio oficial del BCRA, con caché en la tabla `exchange_rates`.
//
// Las ventas guardan los pesos por unidad de la moneda cobrada al día de cobro.
// Para fines de semana y feriados se usa la última cotización en o antes de esa
// fecha. El panel no puede depender del BCRA para abrir: si no contesta (o no
// hay dato), `getArsPerUnit` devuelve `null` y el formulario pide el valor a
// mano.

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Currency } from "@/admin/catalog";
import type { Db } from "@/db/client";
import { exchangeRates } from "@/db/schema";
import { normalizeRate } from "@/lib/money";

export type Rate = {
  /** Pesos por unidad de la moneda, con 4 decimales ("1517.0000"). */
  arsPerUnit: string;
  /** Día de la cotización; puede ser anterior al pedido (fin de semana, feriado). */
  quotedOn: string;
  source: "bcra" | "fixed";
};

/** Monedas que se piden al BCRA (USDT se toma como dólar). */
type QuotedCurrency = "USD" | "BRL";
type Quote = { quotedOn: string; arsPerUnit: string };

const BCRA_URL = "https://api.bcra.gob.ar/estadisticascambiarias/v1.0/Cotizaciones";
const BCRA_TIMEOUT_MS = 5000;
/** Días hacia atrás que se piden al BCRA para cubrir fines de semana y feriados largos. */
const BCRA_LOOKBACK_DAYS = 10;

/** Valores de `EXCHANGE_RATE_SOURCE=fixed` (e2e): sin red y sin base. */
const FIXED_RATES: Record<Currency, string> = {
  USD: "1500.0000",
  USDT: "1500.0000",
  BRL: "280.0000",
  ARS: "1.0000",
};
/** Antes de esta fecha la fuente fija no tiene valor: así los e2e prueban la carga manual. */
const FIXED_FIRST_DATE = "2020-01-01";
const ARS_RATE = FIXED_RATES.ARS;

// --- Fechas (texto "YYYY-MM-DD", calendario en UTC: no dependen de la zona) ---

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SATURDAY = 6;
const SUNDAY = 0;

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function shiftDays(date: string, days: number): string {
  const shifted = new Date(new Date(`${date}T00:00:00Z`).getTime() + days * MS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}

/** La fecha si cae de lunes a viernes; si es fin de semana, el viernes anterior. */
function lastWeekdayOnOrBefore(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === SATURDAY) return shiftDays(date, -1);
  if (day === SUNDAY) return shiftDays(date, -2);
  return date;
}

// --- Respuesta del BCRA -------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `"tipoCotizacion":1512.50000000` — el número, sin las comillas. */
const QUOTE_NUMBER = /("tipoCotizacion"\s*:\s*)(-?\d+(?:\.\d+)?)(?=\s*[,}])/g;

/**
 * Cotizaciones de `currency` entre `from` y `to` (inclusive) de la respuesta
 * del BCRA, sin repetir fechas. Las entradas mal formadas se descartan, no
 * tiran toda la respuesta. Tira si el cuerpo no es JSON o no trae `results`.
 *
 * El BCRA manda la cotización como número con 8 decimales. Antes de leer el
 * JSON se la entrecomilla para tomarla como texto exacto: así el redondeo a 4
 * decimales es half-up de verdad y no depende de decimales binarios.
 */
function parseBcraQuotes(
  body: string,
  currency: QuotedCurrency,
  from: string,
  to: string,
): Quote[] {
  const parsed: unknown = JSON.parse(body.replace(QUOTE_NUMBER, '$1"$2"'));
  if (!isRecord(parsed) || !Array.isArray(parsed.results)) {
    throw new TypeError("la respuesta no trae results");
  }
  const results: unknown[] = parsed.results;
  const byDate = new Map<string, Quote>();
  for (const entry of results) {
    if (!isRecord(entry) || typeof entry.fecha !== "string") continue;
    const quotedOn = entry.fecha;
    if (!isValidIsoDate(quotedOn) || quotedOn < from || quotedOn > to) continue;
    const details: unknown[] = Array.isArray(entry.detalle) ? entry.detalle : [];
    const detail = details.find(
      (item): item is Record<string, unknown> =>
        isRecord(item) && item.codigoMoneda === currency,
    );
    if (typeof detail?.tipoCotizacion !== "string") continue;
    try {
      byDate.set(quotedOn, { quotedOn, arsPerUnit: normalizeRate(detail.tipoCotizacion) });
    } catch {
      // Cotización en cero o con otro formato: se ignora esa fecha.
    }
  }
  return [...byDate.values()];
}

/** Pide el rango al BCRA. `null` si no contesta a tiempo, contesta mal o con error. */
async function fetchBcraQuotes(
  currency: QuotedCurrency,
  from: string,
  to: string,
): Promise<Quote[] | null> {
  try {
    const response = await fetch(`${BCRA_URL}/${currency}?fechadesde=${from}&fechahasta=${to}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(BCRA_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`el BCRA respondió HTTP ${response.status}`);
    }
    return parseBcraQuotes(await response.text(), currency, from, to);
  } catch (error) {
    console.warn(
      `BCRA: no se pudo obtener la cotización de ${currency} (${from} a ${to}), se pide el valor a mano.`,
      error,
    );
    return null;
  }
}

// --- Caché --------------------------------------------------------------------

/**
 * La cotización guardada que sirve para `date`, o `null` si hay que preguntar.
 * Sirve la de ese día o, si cae en fin de semana, la del viernes. Una
 * cotización más vieja no alcanza: puede haber una más nueva que todavía no se
 * trajo. (Un feriado entre semana tampoco la tiene y se vuelve a preguntar.)
 */
async function findCachedRate(
  db: Db,
  currency: QuotedCurrency,
  date: string,
): Promise<Rate | null> {
  const [row] = await db
    .select({ quotedOn: exchangeRates.quotedOn, arsPerUnit: exchangeRates.arsPerUnit })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.currency, currency),
        gte(exchangeRates.quotedOn, lastWeekdayOnOrBefore(date)),
        lte(exchangeRates.quotedOn, date),
      ),
    )
    .orderBy(desc(exchangeRates.quotedOn))
    .limit(1);
  return row ? { ...row, source: "bcra" } : null;
}

async function storeQuotes(db: Db, currency: QuotedCurrency, quotes: Quote[]): Promise<void> {
  await db
    .insert(exchangeRates)
    .values(quotes.map((quote) => ({ ...quote, currency, source: "bcra" })))
    .onConflictDoUpdate({
      target: [exchangeRates.currency, exchangeRates.quotedOn],
      set: {
        arsPerUnit: sql`excluded.ars_per_unit`,
        source: sql`excluded.source`,
        fetchedAt: sql`now()`,
      },
    });
}

// --- API pública --------------------------------------------------------------

/**
 * Pesos por unidad de `currency` en `date` ("YYYY-MM-DD", día de Argentina).
 *
 * - ARS vale "1.0000"; USDT usa la cotización del dólar.
 * - Con `EXCHANGE_RATE_SOURCE=fixed` devuelve valores fijos, sin red ni base
 *   (y `null` antes de 2020, para probar la carga manual).
 * - Si no, mira `exchange_rates` y, si falta, pide al BCRA los 10 días hasta
 *   `date` (5 s de espera), guarda todo lo que llegó y devuelve la última
 *   cotización en o antes de `date`.
 * - Devuelve `null` si el BCRA falla o no hay cotización: nada se guarda y la
 *   próxima llamada vuelve a intentar.
 *
 * Tira `RangeError` si `date` no es una fecha válida.
 */
export async function getArsPerUnit(
  db: Db,
  currency: Currency,
  date: string,
): Promise<Rate | null> {
  if (!isValidIsoDate(date)) {
    throw new RangeError(`Fecha inválida: "${date}" (se espera AAAA-MM-DD).`);
  }
  if (currency === "ARS") {
    return { arsPerUnit: ARS_RATE, quotedOn: date, source: "fixed" };
  }
  if (process.env.EXCHANGE_RATE_SOURCE === "fixed") {
    if (date < FIXED_FIRST_DATE) return null;
    return { arsPerUnit: FIXED_RATES[currency], quotedOn: date, source: "fixed" };
  }

  const quoted: QuotedCurrency = currency === "USDT" ? "USD" : currency;
  const cached = await findCachedRate(db, quoted, date);
  if (cached) return cached;

  const quotes = await fetchBcraQuotes(quoted, shiftDays(date, -BCRA_LOOKBACK_DAYS), date);
  if (!quotes || quotes.length === 0) return null;
  await storeQuotes(db, quoted, quotes);
  const latest = quotes.reduce((best, quote) => (quote.quotedOn > best.quotedOn ? quote : best));
  return { ...latest, source: "bcra" };
}
