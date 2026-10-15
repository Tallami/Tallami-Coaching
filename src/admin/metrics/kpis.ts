// Las tarjetas del resumen: ingresos en dólares y en pesos con la variación
// contra el período anterior, cantidad de ventas, ticket promedio, alumnos
// nuevos y porcentaje de recompra. Solo cuentan las ventas de ingreso
// (cobradas o entregadas) y por su día de cobro.

import { divideRound, percent, sumMinor } from "./math";
import { isIncome, type IncomeSale, type MetricSale } from "./metric-sale";
import { isInRange, periodRange, previousPeriodRange, type DateRange, type Period } from "./period";

// `isIncome` y `MetricSale` viven en `metric-sale.ts`; se vuelven a exportar
// acá porque son lo que se importa junto con las tarjetas.
export { isIncome, type MetricSale };

export interface Kpis {
  /** Ingresos del período en centavos de dólar. */
  incomeUsdMinor: number;
  /** Ingresos del período en centavos de peso. */
  incomeArsMinor: number;
  /**
   * Variación porcentual del ingreso en dólares contra el mismo tramo del
   * período anterior (`previousPeriodRange`: el 1 al 13 de octubre contra el 1
   * al 13 de septiembre), con un decimal (50 es +50 %), o `null` si el anterior
   * no tuvo ingresos.
   */
  incomeUsdDeltaPct: number | null;
  salesCount: number;
  /** Ingreso en dólares sobre cantidad de ventas, en centavos, half-up; 0 si no hubo ventas. */
  avgTicketUsdMinor: number;
  /** Alumnos cuya primera compra de ingreso cae en el período. */
  newCustomers: number;
  /**
   * De los alumnos que compraron en el período, el porcentaje que ya tenía una
   * compra de ingreso anterior al período (un decimal); 0 si nadie compró.
   */
  repeatRatePct: number;
}

function inRange(income: readonly IncomeSale[], range: DateRange): IncomeSale[] {
  return income.filter((sale) => isInRange(sale.paidOn, range));
}

/** Día de la primera compra de ingreso de cada alumno, entre todas las ventas que se pasan. */
function firstPurchaseDays(income: readonly IncomeSale[]): Map<string, string> {
  const firstDays = new Map<string, string>();
  for (const sale of income) {
    const known = firstDays.get(sale.customerId);
    if (known === undefined || sale.paidOn < known) firstDays.set(sale.customerId, sale.paidOn);
  }
  return firstDays;
}

/**
 * Las tarjetas del período, con "hoy" en Argentina. Alumnos nuevos y recompra
 * miran la historia completa que reciben las ventas (`loadMetricSales` incluye,
 * de cada alumno que compró en los últimos 24 meses, su primera compra aunque
 * sea más vieja).
 */
export function computeKpis(sales: readonly MetricSale[], period: Period, now: Date): Kpis {
  const range = periodRange(period, now);
  const income = sales.filter(isIncome);
  const current = inRange(income, range);

  const incomeUsdMinor = sumMinor(current.map((sale) => sale.amountUsdMinor));
  const previousUsdMinor = sumMinor(
    inRange(income, previousPeriodRange(period, now)).map((sale) => sale.amountUsdMinor),
  );

  const firstDays = firstPurchaseDays(income);
  const periodCustomers = new Set(current.map((sale) => sale.customerId));
  let newCustomers = 0;
  let returningCustomers = 0;
  for (const customerId of periodCustomers) {
    const firstDay = firstDays.get(customerId) as string;
    if (firstDay < range.from) returningCustomers += 1;
    else newCustomers += 1;
  }

  return {
    incomeUsdMinor,
    incomeArsMinor: sumMinor(current.map((sale) => sale.amountArsMinor)),
    incomeUsdDeltaPct:
      previousUsdMinor === 0 ? null : percent(incomeUsdMinor - previousUsdMinor, previousUsdMinor),
    salesCount: current.length,
    avgTicketUsdMinor: current.length === 0 ? 0 : divideRound(incomeUsdMinor, current.length),
    newCustomers,
    repeatRatePct: periodCustomers.size === 0 ? 0 : percent(returningCustomers, periodCustomers.size),
  };
}
