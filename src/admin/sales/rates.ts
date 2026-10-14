// Tipo de cambio de una venta: los pesos por unidad de la moneda cobrada y los
// pesos por dólar del día de cobro, con su fuente. Al guardar, el formulario
// elige entre lo oficial (BCRA) y lo que escribió Tallami; si no hay cotización
// oficial, la venta no se inventa un valor: vuelve al formulario a pedirlo.

import { isDollarCurrency, type Currency, type RateSource } from "@/admin/catalog";
import { todayInArgentina } from "@/admin/dates";
import { getArsPerUnit } from "@/admin/exchange-rate";
import type { SaleInput } from "@/admin/sales/schema";
import type { Db } from "@/db/client";

/** Lo que se guarda en la venta sobre el tipo de cambio usado. */
export interface SaleRates {
  /** Pesos por unidad de la moneda cobrada ("1500.0000"). */
  arsPerUnit: string;
  /** Pesos por dólar ("1500.0000"). */
  arsPerUsd: string;
  source: RateSource;
  /** Día de la cotización usada (puede ser anterior al cobro); vacío si se escribió a mano. */
  quotedOn: string | null;
}

/** Lo que una venta ya guardada recuerda de su tipo de cambio. */
export interface StoredRates {
  currency: Currency;
  paidOn: string | null;
  arsPerUnit: string;
  arsPerUsd: string;
  rateSource: RateSource;
  rateQuotedOn: string | null;
}

export type RateResolution = { ok: true; rates: SaleRates } | { ok: false };

const ARS_PER_ARS = "1.0000";

/** Los valores que escribió Tallami. El formulario ya exigió los que corresponden a la moneda. */
function manualRates(input: SaleInput): SaleRates {
  const { arsPerUsd } = input;
  if (!arsPerUsd) throw new Error("Falta el tipo de cambio manual: pesos por dólar.");
  let arsPerUnit: string | undefined;
  if (input.currency === "ARS") arsPerUnit = ARS_PER_ARS;
  else if (isDollarCurrency(input.currency)) arsPerUnit = arsPerUsd;
  else arsPerUnit = input.arsPerUnit;
  if (!arsPerUnit) throw new Error(`Falta el tipo de cambio manual de ${input.currency}.`);
  return { arsPerUnit, arsPerUsd, source: "manual", quotedOn: null };
}

/**
 * Al editar, el tipo de cambio guardado se conserva mientras no cambie lo que
 * lo determina (la moneda y el día de cobro): una cotización ya registrada no
 * se vuelve a pedir ni se pisa por tocar el estado o las notas. Una cotización
 * escrita a mano no se conserva si se pide la automática: se pidió la oficial.
 */
function keepsStoredRates(previous: StoredRates, input: SaleInput): boolean {
  return (
    previous.rateSource !== "manual" &&
    previous.currency === input.currency &&
    previous.paidOn === (input.paidOn ?? null)
  );
}

function olderDay(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * Resuelve el tipo de cambio de la venta.
 *
 * - Manual: los valores escritos, con fuente `manual`.
 * - Automático: al editar, los ya guardados si siguen valiendo; si no, la
 *   cotización oficial del día de cobro (o de hoy si todavía no se cobró).
 *   `{ ok: false }` si no hay cotización del dólar o de la moneda.
 *
 * `today` solo existe para probar sin tocar el reloj.
 */
export async function resolveSaleRates(
  db: Db,
  input: SaleInput,
  options: { previous?: StoredRates; today?: string } = {},
): Promise<RateResolution> {
  if (input.rateMode === "manual") return { ok: true, rates: manualRates(input) };

  const { previous } = options;
  if (previous && keepsStoredRates(previous, input)) {
    return {
      ok: true,
      rates: {
        arsPerUnit: previous.arsPerUnit,
        arsPerUsd: previous.arsPerUsd,
        source: previous.rateSource,
        quotedOn: previous.rateQuotedOn,
      },
    };
  }

  const day = input.paidOn ?? options.today ?? todayInArgentina();
  const dollar = await getArsPerUnit(db, "USD", day);
  if (!dollar) return { ok: false };
  if (isDollarCurrency(input.currency)) {
    return {
      ok: true,
      rates: {
        arsPerUnit: dollar.arsPerUnit,
        arsPerUsd: dollar.arsPerUnit,
        source: dollar.source,
        quotedOn: dollar.quotedOn,
      },
    };
  }

  const own = await getArsPerUnit(db, input.currency, day);
  if (!own) return { ok: false };
  return {
    ok: true,
    rates: {
      arsPerUnit: own.arsPerUnit,
      arsPerUsd: dollar.arsPerUnit,
      source: dollar.source,
      // En pesos la cotización "propia" es siempre la de ese día: manda la del dólar.
      quotedOn: input.currency === "ARS" ? dollar.quotedOn : olderDay(own.quotedOn, dollar.quotedOn),
    },
  };
}
