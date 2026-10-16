// Todo lo que muestra la pantalla de Facturación, calculado de una vez con
// funciones puras. La página lee la lista de ventas por facturar, las ventas de
// las métricas y la configuración, llama a `buildBilling` y le pasa el
// resultado a `BillingView`: así el armado se prueba sin base de datos.
//
// Las ventas por facturar y el resumen de 12 meses salen de lecturas distintas
// (la lista necesita todas las columnas; el resumen y el monotributo, las de las
// métricas) pero de la misma regla de ingreso que el resumen del panel, así
// los números coinciden.

import {
  groupUninvoicedByMonth,
  monthlyBilling,
  sumBilling,
  type BillingTotals,
  type MonthBilling,
  type UninvoicedGroup,
} from "@/admin/billing/summary";
import { sumMinor } from "@/admin/metrics/math";
import { isIncome, type MetricSale } from "@/admin/metrics/metric-sale";
import {
  monotributoStatus,
  monotributoWindow,
  type MonotributoSettings,
} from "@/admin/metrics/monotributo";
import { todayInArgentina, type DateRange } from "@/admin/metrics/period";
import type { OverviewData } from "@/admin/overview/overview-data";
import type { SaleRow } from "@/admin/sales/sale-row";

/** Meses del resumen de cobrado contra facturado. */
export const BILLING_MONTHS = 12;

export interface BillingData {
  /** Hoy en Argentina, "AAAA-MM-DD". */
  today: string;
  /** Hay alguna venta cobrada o por facturar: si no, la pantalla es una invitación a cargar la primera. */
  hasIncome: boolean;
  uninvoiced: {
    /** Por mes de cobro, el más nuevo primero. */
    groups: UninvoicedGroup[];
    count: number;
    arsMinor: number;
    usdMinor: number;
    /** La lista se cortó: hay más ventas sin facturar que las que se muestran. */
    truncated: boolean;
  };
  /** Los últimos 12 meses, el actual primero. */
  months: MonthBilling[];
  /** La suma de los 12 meses. */
  total: BillingTotals;
  monotributo: OverviewData["monotributo"];
  /** Las fechas con que arranca el formulario de exportación: los 12 meses del monotributo. */
  exportDefaults: DateRange;
}

export interface BillingInput {
  /** Lo que se puede facturar (ver `listUninvoicedSales`). */
  uninvoiced: { rows: readonly SaleRow[]; truncated: boolean };
  /** Las ventas que leen las métricas (ver `loadMetricSales`). */
  sales: readonly MetricSale[];
  settings: MonotributoSettings | null;
  now: Date;
}

export function buildBilling({ uninvoiced, sales, settings, now }: BillingInput): BillingData {
  const today = todayInArgentina(now);
  const groups = groupUninvoicedByMonth(uninvoiced.rows);
  const months = monthlyBilling(sales, BILLING_MONTHS, now);
  const window = monotributoWindow(now);
  return {
    today,
    hasIncome: uninvoiced.rows.length > 0 || sales.some((sale) => isIncome(sale) && sale.paidOn <= today),
    uninvoiced: {
      groups,
      count: sumMinor(groups.map((group) => group.count)),
      arsMinor: sumMinor(groups.map((group) => group.arsMinor)),
      usdMinor: sumMinor(groups.map((group) => group.usdMinor)),
      truncated: uninvoiced.truncated,
    },
    months: [...months].reverse(),
    total: sumBilling(months),
    monotributo: {
      status: monotributoStatus(sales, settings, now),
      settings,
      window,
    },
    exportDefaults: window,
  };
}
