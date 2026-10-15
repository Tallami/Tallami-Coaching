// Estado del monotributo: los ingresos en pesos de los últimos 12 meses
// móviles contra el tope anual de la categoría que carga Tallami. El panel solo
// suma lo cargado y lo compara con el tope cargado: no reemplaza al contador.

import { percent, sumMinor } from "./math";
import { isIncome, type MetricSale } from "./metric-sale";
import { addDays, addMonths, isInRange, todayInArgentina } from "./period";

/** La categoría y el tope anual vigentes, como los guarda la configuración (Tarea 9). */
export interface MonotributoSettings {
  category: string;
  /** Tope anual de facturación en centavos de peso. */
  annualCapArsMinor: number;
  /** Desde cuándo rige el tope, "AAAA-MM-DD". Informativo: el cálculo usa el tope tal cual está cargado. */
  validFrom: string;
}

export interface MonotributoStatus {
  /** Ingresos de los últimos 12 meses móviles, en centavos de peso. */
  last12ArsMinor: number;
  /** El tope, o `null` si no hay configuración (o el tope cargado no es un monto válido). */
  capArsMinor: number | null;
  /** Porcentaje del tope usado, con un decimal (puede pasar de 100); `null` sin tope. */
  usedPct: number | null;
  /** Lo que queda del tope; negativo si ya se pasó. `null` sin tope. */
  remainingArsMinor: number | null;
}

const MONTHS_IN_YEAR = 12;

/**
 * Los ingresos en pesos de los últimos 12 meses móviles: desde el día siguiente
 * a hoy hace un año hasta hoy (en Argentina), por día de cobro. Las ventas con
 * fecha futura todavía no cuentan. Sin una configuración con tope válido (un
 * entero seguro mayor a cero) se devuelve solo el total.
 */
export function monotributoStatus(
  sales: readonly MetricSale[],
  settings: MonotributoSettings | null,
  now: Date,
): MonotributoStatus {
  const today = todayInArgentina(now);
  const window = { from: addDays(addMonths(today, -MONTHS_IN_YEAR), 1), to: today };
  const last12ArsMinor = sumMinor(
    sales
      .filter(isIncome)
      .filter((sale) => isInRange(sale.paidOn, window))
      .map((sale) => sale.amountArsMinor),
  );

  const cap = settings?.annualCapArsMinor;
  if (cap === undefined || !Number.isSafeInteger(cap) || cap <= 0) {
    return { last12ArsMinor, capArsMinor: null, usedPct: null, remainingArsMinor: null };
  }
  return {
    last12ArsMinor,
    capArsMinor: cap,
    usedPct: percent(last12ArsMinor, cap),
    remainingArsMinor: cap - last12ArsMinor,
  };
}
