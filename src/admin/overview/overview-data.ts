// Todo lo que muestra el resumen, calculado de una vez con las funciones puras
// de las métricas. La página lee las ventas y la configuración, llama a
// `buildOverview` y le pasa el resultado a `OverviewView`: así el armado de la
// pantalla se prueba sin base de datos.

import type { SaleItem } from "@/admin/catalog";
import { computeKpisWithPrevious, type Kpis } from "@/admin/metrics/kpis";
import type { MetricSale } from "@/admin/metrics/metric-sale";
import {
  monotributoStatus,
  monotributoWindow,
  type MonotributoSettings,
  type MonotributoStatus,
} from "@/admin/metrics/monotributo";
import { pendingWork, type PendingWork } from "@/admin/metrics/pending";
import {
  lengthInDays,
  periodRange,
  previousPeriodRange,
  todayInArgentina,
  type DateRange,
  type Period,
} from "@/admin/metrics/period";
import {
  DEFAULT_DAYS_WITHOUT_SALES,
  incomeByCountry,
  incomeByItem,
  incomeByPaymentMethod,
  itemsWithoutSales,
  monthlyIncome,
  type CountryIncome,
  type ItemIncome,
  type MonthlyIncome,
  type PaymentMethodIncome,
} from "@/admin/metrics/series";

/** Meses del gráfico de ingresos. */
export const CHART_MONTHS = 12;

export interface OverviewData {
  period: Period;
  /** Hoy en Argentina, "AAAA-MM-DD". */
  today: string;
  range: DateRange;
  /** El tramo con el que se compara (`previousPeriodRange`). */
  previousRange: DateRange;
  /** Días que lleva el período, hoy incluido. */
  rangeDays: number;
  kpis: Kpis;
  /** Ingresos en dólares del tramo con el que se compara, en centavos. */
  previousIncomeUsdMinor: number;
  /** Ingresos de los últimos 12 meses, del más viejo al actual. */
  months: MonthlyIncome[];
  byItem: ItemIncome[];
  /** Servicios sin ventas en los últimos 90 días. */
  withoutSales: SaleItem[];
  byPayment: PaymentMethodIncome[];
  byCountry: CountryIncome[];
  pending: PendingWork;
  monotributo: {
    status: MonotributoStatus;
    /** Lo que cargó Tallami, o `null` si todavía no cargó nada. */
    settings: MonotributoSettings | null;
    /** Los 12 meses móviles que se suman. */
    window: DateRange;
  };
  /** Hay alguna venta cargada: si no, el resumen es una invitación a cargar la primera. */
  hasSales: boolean;
}

/** Arma el resumen del período con las ventas que leen las métricas y la configuración del monotributo. */
export function buildOverview(
  sales: readonly MetricSale[],
  monotributoSettings: MonotributoSettings | null,
  period: Period,
  now: Date,
): OverviewData {
  const range = periodRange(period, now);
  const previousRange = previousPeriodRange(period, now);
  const { kpis, previousIncomeUsdMinor } = computeKpisWithPrevious(sales, period, now);
  return {
    period,
    today: todayInArgentina(now),
    range,
    previousRange,
    rangeDays: lengthInDays(range),
    kpis,
    previousIncomeUsdMinor,
    months: monthlyIncome(sales, CHART_MONTHS, now),
    byItem: incomeByItem(sales, range),
    withoutSales: itemsWithoutSales(sales, DEFAULT_DAYS_WITHOUT_SALES, now),
    byPayment: incomeByPaymentMethod(sales, range),
    byCountry: incomeByCountry(sales, range),
    pending: pendingWork(sales, now),
    monotributo: {
      status: monotributoStatus(sales, monotributoSettings, now),
      settings: monotributoSettings,
      window: monotributoWindow(now),
    },
    hasSales: sales.length > 0,
  };
}
