// Series y desgloses del resumen: ingresos por mes, por servicio, por medio de
// pago y por país, y los servicios que no se vendieron. Solo cuentan las ventas
// de ingreso, por su día de cobro. Los desgloses salen siempre en un orden
// determinístico (ingreso, cantidad y, para desempatar, el orden del catálogo).

import {
  PAYMENT_METHODS,
  SALE_ITEMS,
  type PaymentMethod,
  type SaleItem,
} from "@/admin/catalog";
import { splitShares, sumMinor } from "./math";
import { isIncome, type IncomeSale, type MetricSale } from "./metric-sale";
import {
  addDays,
  addMonths,
  firstOfMonth,
  isInRange,
  monthOf,
  todayInArgentina,
  type DateRange,
} from "./period";

/** Cómo se llama el grupo de alumnos sin país cargado. */
export const NO_COUNTRY_LABEL = "Sin país";
/** Ventana de "servicios sin ventas" si no se pide otra. */
export const DEFAULT_DAYS_WITHOUT_SALES = 90;

export interface MonthlyIncome {
  /** Mes de calendario de Argentina, "AAAA-MM". */
  month: string;
  usdMinor: number;
  arsMinor: number;
}

/**
 * Ingresos de cada uno de los últimos `months` meses, del más viejo al actual,
 * con los meses sin ventas en cero. El mes de una venta es el de su día de
 * cobro; las de meses futuros no entran.
 */
export function monthlyIncome(
  sales: readonly MetricSale[],
  months: number,
  now: Date,
): MonthlyIncome[] {
  if (!Number.isInteger(months) || months < 0) {
    throw new RangeError(`La cantidad de meses tiene que ser un entero desde 0, pero llegó ${months}.`);
  }
  const currentMonth = firstOfMonth(todayInArgentina(now));
  const buckets = Array.from({ length: months }, (_, index) => ({
    month: monthOf(addMonths(currentMonth, index - (months - 1))),
    usd: [] as number[],
    ars: [] as number[],
  }));
  const byMonth = new Map(buckets.map((bucket) => [bucket.month, bucket]));

  for (const sale of sales.filter(isIncome)) {
    const bucket = byMonth.get(monthOf(sale.paidOn));
    if (bucket) {
      bucket.usd.push(sale.amountUsdMinor);
      bucket.ars.push(sale.amountArsMinor);
    }
  }
  return buckets.map((bucket) => ({
    month: bucket.month,
    usdMinor: sumMinor(bucket.usd),
    arsMinor: sumMinor(bucket.ars),
  }));
}

interface Group<Key extends string> {
  key: Key;
  count: number;
  usdMinor: number;
}

/**
 * Agrupa las ventas de ingreso del rango por `keyOf`. Orden: más ingreso en
 * dólares primero; a igual ingreso, más ventas; a igual cantidad, `tieBreak`.
 */
function groupIncome<Key extends string>(
  sales: readonly MetricSale[],
  range: DateRange,
  keyOf: (sale: IncomeSale) => Key,
  tieBreak: (a: Key, b: Key) => number,
): Group<Key>[] {
  const amounts = new Map<Key, number[]>();
  for (const sale of sales.filter(isIncome)) {
    if (!isInRange(sale.paidOn, range)) continue;
    const key = keyOf(sale);
    amounts.set(key, [...(amounts.get(key) ?? []), sale.amountUsdMinor]);
  }
  return [...amounts.entries()]
    .map(([key, usd]) => ({ key, count: usd.length, usdMinor: sumMinor(usd) }))
    .sort((a, b) => b.usdMinor - a.usdMinor || b.count - a.count || tieBreak(a.key, b.key));
}

/** Les agrega a los grupos su parte del total, repartida para que sume exactamente 100,0. */
function withShares<Key extends string>(
  groups: readonly Group<Key>[],
): (Group<Key> & { sharePct: number })[] {
  const shares = splitShares(groups.map((group) => group.usdMinor));
  return groups.map((group, index) => ({ ...group, sharePct: shares[index] }));
}

/** Orden de una lista cerrada del catálogo. */
function catalogOrder<Key extends string>(catalog: readonly Key[]): (a: Key, b: Key) => number {
  return (a, b) => catalog.indexOf(a) - catalog.indexOf(b);
}

export interface ItemIncome {
  item: SaleItem;
  count: number;
  usdMinor: number;
  /** Parte del ingreso en dólares del rango, un decimal; los de la lista suman 100,0. */
  sharePct: number;
}

/**
 * Ingresos del rango por servicio (solo los que vendieron), de mayor a menor.
 * Los porcentajes se reparten con el método del mayor resto para sumar 100,0
 * exactos; si el total en dólares es cero, todos valen 0.
 */
export function incomeByItem(sales: readonly MetricSale[], range: DateRange): ItemIncome[] {
  const groups = groupIncome(sales, range, (sale) => sale.item, catalogOrder(SALE_ITEMS));
  return withShares(groups).map(({ key, ...rest }) => ({ item: key, ...rest }));
}

export interface PaymentMethodIncome {
  paymentMethod: PaymentMethod;
  count: number;
  usdMinor: number;
  sharePct: number;
}

/** Ingresos del rango por medio de pago, de mayor a menor (mismo reparto que `incomeByItem`). */
export function incomeByPaymentMethod(
  sales: readonly MetricSale[],
  range: DateRange,
): PaymentMethodIncome[] {
  const groups = groupIncome(
    sales,
    range,
    (sale) => sale.paymentMethod,
    catalogOrder(PAYMENT_METHODS),
  );
  return withShares(groups).map(({ key, ...rest }) => ({ paymentMethod: key, ...rest }));
}

export interface CountryIncome {
  /** Código del país del alumno ("AR") o `NO_COUNTRY_LABEL` si no tiene. */
  country: string;
  count: number;
  usdMinor: number;
  sharePct: number;
}

/** El país de la venta en mayúsculas, o `NO_COUNTRY_LABEL` si el alumno no tiene (o está en blanco). */
function countryKey(sale: IncomeSale): string {
  const code = sale.country?.trim().toUpperCase();
  return code ? code : NO_COUNTRY_LABEL;
}

/** Códigos de país por orden alfabético, y "Sin país" después de todos. */
function compareCountries(a: string, b: string): number {
  if (a === b) return 0;
  if (a === NO_COUNTRY_LABEL) return 1;
  if (b === NO_COUNTRY_LABEL) return -1;
  return a < b ? -1 : 1;
}

/** Ingresos del rango por país del alumno, de mayor a menor; los sin país van juntos bajo "Sin país". */
export function incomeByCountry(sales: readonly MetricSale[], range: DateRange): CountryIncome[] {
  const groups = groupIncome(sales, range, countryKey, compareCountries);
  return withShares(groups).map(({ key, ...rest }) => ({ country: key, ...rest }));
}

/**
 * Los servicios del catálogo (sin "Otro") que no vendieron en los últimos
 * `days` días, en el orden del catálogo. La ventana va del día `days - 1`
 * anterior a hoy en adelante: 90 días contando hoy, y una venta con fecha
 * futura cuenta como venta del servicio.
 */
export function itemsWithoutSales(
  sales: readonly MetricSale[],
  days: number = DEFAULT_DAYS_WITHOUT_SALES,
  now: Date,
): SaleItem[] {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`Los días tienen que ser un entero desde 1, pero llegó ${days}.`);
  }
  const firstDay = addDays(todayInArgentina(now), -(days - 1));
  const sold = new Set(
    sales.filter(isIncome).filter((sale) => sale.paidOn >= firstDay).map((sale) => sale.item),
  );
  return SALE_ITEMS.filter((item) => item !== "other" && !sold.has(item));
}
