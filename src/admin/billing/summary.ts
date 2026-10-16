// Cuentas de la pantalla de Facturación, todas funciones puras:
//
// - `monthlyBilling`: de lo cobrado en cada mes, cuánto está facturado, cuánto
//   no requiere factura y cuánto falta facturar. El mes de una venta es el de su
//   fecha de cobro (la misma regla que los ingresos del resumen), no el de su
//   factura; así lo cobrado de cada mes es siempre facturado + no requiere +
//   pendiente, y su columna "cobrado" es la de "Ingresos por mes" del resumen.
// - `groupUninvoicedByMonth`: las ventas por facturar agrupadas por mes de cobro.
//
// Una venta con fecha de cobro futura todavía no se cobró: no entra en ningún
// total hasta ese día, igual que en el resumen.

import type { SaleRow } from "@/admin/sales/sale-row";
import { sumMinor } from "@/admin/metrics/math";
import { isIncome, type MetricSale } from "@/admin/metrics/metric-sale";
import { addMonths, firstOfMonth, monthOf, todayInArgentina } from "@/admin/metrics/period";

/** Cantidad y suma de un grupo de ventas. */
export interface BillingAmounts {
  count: number;
  /** Suma en centavos de peso. */
  arsMinor: number;
  /** Suma en centavos de dólar. */
  usdMinor: number;
}

export interface MonthBilling {
  /** Mes de calendario de Argentina, "AAAA-MM". */
  month: string;
  /** Todo lo cobrado en el mes. */
  collected: BillingAmounts;
  invoiced: BillingAmounts;
  notRequired: BillingAmounts;
  /** Cobrado sin factura todavía. */
  pending: BillingAmounts;
}

/** Los totales de varios meses: lo mismo que un mes, sin el nombre. */
export type BillingTotals = Omit<MonthBilling, "month">;

function amountsOf(sales: readonly { amountArsMinor: number; amountUsdMinor: number }[]): BillingAmounts {
  return {
    count: sales.length,
    arsMinor: sumMinor(sales.map((sale) => sale.amountArsMinor)),
    usdMinor: sumMinor(sales.map((sale) => sale.amountUsdMinor)),
  };
}

/**
 * Lo cobrado, facturado y pendiente de cada uno de los últimos `months` meses,
 * del más viejo al actual, con los meses sin ventas en cero.
 */
export function monthlyBilling(
  sales: readonly MetricSale[],
  months: number,
  now: Date,
): MonthBilling[] {
  if (!Number.isInteger(months) || months < 0) {
    throw new RangeError(`La cantidad de meses tiene que ser un entero desde 0, pero llegó ${months}.`);
  }
  const today = todayInArgentina(now);
  const currentMonth = firstOfMonth(today);
  const buckets = Array.from({ length: months }, (_, index) => ({
    month: monthOf(addMonths(currentMonth, index - (months - 1))),
    sales: [] as MetricSale[],
  }));
  const byMonth = new Map(buckets.map((bucket) => [bucket.month, bucket]));

  for (const sale of sales.filter(isIncome)) {
    if (sale.paidOn > today) continue;
    byMonth.get(monthOf(sale.paidOn))?.sales.push(sale);
  }

  return buckets.map(({ month, sales: collected }) => ({
    month,
    collected: amountsOf(collected),
    invoiced: amountsOf(collected.filter((sale) => sale.invoiceStatus === "issued")),
    notRequired: amountsOf(collected.filter((sale) => sale.invoiceStatus === "not_required")),
    pending: amountsOf(collected.filter((sale) => sale.invoiceStatus === "pending")),
  }));
}

function sumAmounts(parts: readonly BillingAmounts[]): BillingAmounts {
  return {
    count: sumMinor(parts.map((part) => part.count)),
    arsMinor: sumMinor(parts.map((part) => part.arsMinor)),
    usdMinor: sumMinor(parts.map((part) => part.usdMinor)),
  };
}

/** La suma de varios meses, columna por columna. */
export function sumBilling(months: readonly MonthBilling[]): BillingTotals {
  return {
    collected: sumAmounts(months.map((month) => month.collected)),
    invoiced: sumAmounts(months.map((month) => month.invoiced)),
    notRequired: sumAmounts(months.map((month) => month.notRequired)),
    pending: sumAmounts(months.map((month) => month.pending)),
  };
}

/** Las ventas por facturar de un mes de cobro, con sus totales. */
export interface UninvoicedGroup extends BillingAmounts {
  /** Mes de calendario de Argentina, "AAAA-MM". */
  month: string;
  /** De la más nueva a la más vieja. */
  rows: SaleRow[];
}

/** Más nueva primero: por día de cobro, después por alta y, para desempatar, por id. */
function newestFirst(a: SaleRow, b: SaleRow): number {
  if (a.paidOn !== b.paidOn) return (a.paidOn ?? "") < (b.paidOn ?? "") ? 1 : -1;
  if (a.createdAt.getTime() !== b.createdAt.getTime()) return b.createdAt.getTime() - a.createdAt.getTime();
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Agrupa las ventas por mes de cobro, el mes más nuevo primero. Las ventas sin
 * fecha de cobro no entran: no hay mes al que asignarlas (y no se pueden facturar).
 */
export function groupUninvoicedByMonth(rows: readonly SaleRow[]): UninvoicedGroup[] {
  const byMonth = new Map<string, SaleRow[]>();
  for (const row of [...rows].sort(newestFirst)) {
    if (row.paidOn === null) continue;
    const month = monthOf(row.paidOn);
    const group = byMonth.get(month);
    if (group) group.push(row);
    else byMonth.set(month, [row]);
  }
  return [...byMonth.entries()].map(([month, monthRows]) => ({
    month,
    rows: monthRows,
    ...amountsOf(monthRows),
  }));
}
