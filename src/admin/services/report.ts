// Lo que muestra la página Servicios, calculado de una vez con las funciones
// puras de las métricas: la página lee las ventas y los clics, llama a
// `buildServicesReport` y le pasa el resultado a `ServicesView`, así el armado
// se prueba sin base de datos.
//
// Una fila por ítem del catálogo, en el orden del catálogo. Las ventas son las
// de ingreso (cobradas o entregadas) por su día de cobro dentro del período; la
// tendencia y la última venta miran toda la historia que traen las ventas, no
// solo el período. La conversión es ventas cobradas ÷ clics en "Reservar" del
// mismo período, y vacía (`null`) cuando no hubo clics. El pack de 4 clases no
// tiene botón propio: se pide desde el de Clase 1 a 1, así que la conversión de
// esa fila suma las ventas de las dos (sus columnas de ventas e ingresos siguen
// siendo solo las suyas).

import { SALE_ITEMS, SITE_BOOKING_ITEMS, type SaleItem } from "@/admin/catalog";
import type { ItemClicks } from "@/admin/interest/query";
import { divideRound, percent, sumMinor } from "@/admin/metrics/math";
import { isIncome, type MetricSale } from "@/admin/metrics/metric-sale";
import { periodRange, todayInArgentina, type DateRange, type Period } from "@/admin/metrics/period";
import { incomeByItem, monthlyIncome, type MonthlyIncome } from "@/admin/metrics/series";

/** Meses de la tendencia de cada fila, el mes en curso incluido. */
export const TREND_MONTHS = 6;

const SITE_BOOKING_SET: ReadonlySet<SaleItem> = new Set(SITE_BOOKING_ITEMS);

/** El ítem sin botón propio y el botón desde el que se pide: el segundo cobra también las ventas del primero. */
const PACK_ITEM: SaleItem = "lessonPack";
const PACK_BUTTON_ITEM: SaleItem = "lesson";

export interface ServiceRow {
  item: SaleItem;
  /** Ventas cobradas (o entregadas) con día de cobro dentro del período. */
  sales: number;
  /** Lo cobrado en el período, en centavos de dólar. */
  incomeUsdMinor: number;
  /** Ingreso sobre cantidad de ventas, half-up, o `null` sin ventas. */
  avgTicketUsdMinor: number | null;
  /** Parte del ingreso en dólares del período, un decimal; las filas suman 100,0 (0 si no hubo ingresos). */
  sharePct: number;
  /** Ingresos de los últimos 6 meses, del más viejo al mes en curso. */
  trend: MonthlyIncome[];
  /** Día del último cobro hasta hoy, de cualquier época, o `null`. */
  lastSaleOn: string | null;
  /** Clics en el botón del sitio en el período, o `null` si el ítem no tiene botón. */
  clicks: number | null;
  /** Las ventas que cuentan para la conversión: las propias y, en Clase 1 a 1, también las del pack. */
  conversionSales: number;
  /** De `conversionSales`, las que son del pack de 4 clases (solo en Clase 1 a 1; 0 en las demás filas). */
  includedPackSales: number;
  /** `conversionSales` ÷ clics, un decimal, o `null` sin clics. Puede pasar de 100. */
  conversionPct: number | null;
}

export interface ServicesReport {
  period: Period;
  /** Hoy en Argentina, "AAAA-MM-DD". */
  today: string;
  range: DateRange;
  rows: ServiceRow[];
  /** Los meses de la tendencia, "AAAA-MM", del más viejo al actual. */
  trendMonths: string[];
  totals: { sales: number; incomeUsdMinor: number; clicks: number };
  /** Clics que el registro descartó en el período por pasarse del tope de todo el sitio (por minuto o por hora); no están en `totals.clicks`. */
  droppedClicks: number;
  /** Hay alguna venta cargada o algún clic (o clic descartado) en el período: si no, la página invita a cargar la primera venta. */
  hasActivity: boolean;
}

/** El último día de cobro de ingreso hasta hoy (una venta con fecha futura todavía no cuenta). */
function lastSaleDay(income: readonly { paidOn: string }[], today: string): string | null {
  let last: string | null = null;
  for (const sale of income) {
    if (sale.paidOn <= today && (last === null || sale.paidOn > last)) last = sale.paidOn;
  }
  return last;
}

/**
 * Arma la página Servicios del período con las ventas que leen las métricas, los
 * clics del período y cuántos clics se descartaron por exceso (cero si no se pasa).
 */
export function buildServicesReport(
  sales: readonly MetricSale[],
  clicks: readonly ItemClicks[],
  period: Period,
  now: Date,
  droppedClicks = 0,
): ServicesReport {
  const today = todayInArgentina(now);
  const range = periodRange(period, now);
  const income = sales.filter(isIncome);
  const periodIncome = new Map(incomeByItem(sales, range).map((entry) => [entry.item, entry]));
  const clicksByItem = new Map<string, number>(clicks.map((entry) => [entry.item, entry.clicks]));

  const rows = SALE_ITEMS.map((item): ServiceRow => {
    const own = income.filter((sale) => sale.item === item);
    const inPeriod = periodIncome.get(item);
    const count = inPeriod?.count ?? 0;
    const incomeUsdMinor = inPeriod?.usdMinor ?? 0;
    const itemClicks = SITE_BOOKING_SET.has(item) ? (clicksByItem.get(item) ?? 0) : null;
    const includedPackSales = item === PACK_BUTTON_ITEM ? (periodIncome.get(PACK_ITEM)?.count ?? 0) : 0;
    const conversionSales = count + includedPackSales;
    return {
      item,
      sales: count,
      incomeUsdMinor,
      avgTicketUsdMinor: count === 0 ? null : divideRound(incomeUsdMinor, count),
      sharePct: inPeriod?.sharePct ?? 0,
      trend: monthlyIncome(own, TREND_MONTHS, now),
      lastSaleOn: lastSaleDay(own, today),
      clicks: itemClicks,
      conversionSales,
      includedPackSales,
      conversionPct: itemClicks === null || itemClicks === 0 ? null : percent(conversionSales, itemClicks),
    };
  });

  const totals = {
    sales: rows.reduce((total, row) => total + row.sales, 0),
    incomeUsdMinor: sumMinor(rows.map((row) => row.incomeUsdMinor)),
    clicks: rows.reduce((total, row) => total + (row.clicks ?? 0), 0),
  };

  return {
    period,
    today,
    range,
    rows,
    trendMonths: rows[0].trend.map((month) => month.month),
    totals,
    droppedClicks,
    hasActivity: sales.length > 0 || totals.clicks > 0 || droppedClicks > 0,
  };
}
