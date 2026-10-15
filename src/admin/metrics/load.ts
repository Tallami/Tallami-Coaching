// Lectura de las ventas que necesitan las métricas: el único código de las
// métricas que toca la base. Trae lo mínimo para que las cuentas de las
// funciones puras den lo mismo que si miraran toda la tabla:
//
// 1. las ventas de ingreso de los últimos 24 meses de calendario (los 12 meses
//    de un período más los 12 anteriores con los que se compara);
// 2. las de ingreso más viejas que sigan "abiertas": sin facturar (para el
//    total de pendientes) o cobradas y sin entregar (entregas y sesiones);
// 3. de cada alumno que compró en la ventana, su primera compra de ingreso si
//    es más vieja (para que "alumnos nuevos" y "recompra" no tomen por nuevo a
//    quien compró hace tres años).
//
// Las pendientes de cobro, canceladas y reembolsadas no se traen: ninguna
// métrica las lee (las funciones puras igual las ignoran).

import { and, asc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import {
  INCOME_STATUSES,
  type InvoiceStatus,
  type PaymentMethod,
  type SaleItem,
  type SaleStatus,
} from "@/admin/catalog";
import type { Db } from "@/db/client";
import { customers, sales } from "@/db/schema";
import type { MetricSale } from "./metric-sale";
import { addMonths, firstOfMonth, todayInArgentina } from "./period";

/** Meses de calendario de historia, el actual incluido. */
const HISTORY_MONTHS = 24;

const metricColumns = {
  id: sales.id,
  customerId: sales.customerId,
  item: sales.item,
  status: sales.status,
  paidOn: sales.paidOn,
  dueAt: sales.dueAt,
  deliveredAt: sales.deliveredAt,
  amountArsMinor: sales.amountArsMinor,
  amountUsdMinor: sales.amountUsdMinor,
  paymentMethod: sales.paymentMethod,
  country: customers.country,
  invoiceStatus: sales.invoiceStatus,
};

/** La fila como la devuelve la base: las listas cerradas son texto suelto y las fechas con hora, `Date`. */
interface RawMetricRow {
  id: string;
  customerId: string;
  item: string;
  status: string;
  paidOn: string | null;
  dueAt: Date | null;
  deliveredAt: Date | null;
  amountArsMinor: number;
  amountUsdMinor: number;
  paymentMethod: string;
  country: string | null;
  invoiceStatus: string;
}

/**
 * Las listas cerradas llegan como texto; la base las limita con restricciones
 * `check` a los valores del catálogo, así que el cambio de tipo es seguro. Los
 * `bigint` ya llegan como `number` (`mode: "number"`).
 */
function toMetricSale(row: RawMetricRow): MetricSale {
  return {
    id: row.id,
    customerId: row.customerId,
    item: row.item as SaleItem,
    status: row.status as SaleStatus,
    paidOn: row.paidOn,
    dueAt: row.dueAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    amountArsMinor: row.amountArsMinor,
    amountUsdMinor: row.amountUsdMinor,
    paymentMethod: row.paymentMethod as PaymentMethod,
    country: row.country?.trim() || null,
    invoiceStatus: row.invoiceStatus as InvoiceStatus,
  };
}

/** Primer día de la ventana de historia, con el mes de Argentina de `now`. */
function historyStart(now: Date): string {
  return addMonths(firstOfMonth(todayInArgentina(now)), -(HISTORY_MONTHS - 1));
}

/**
 * Las ventas que leen las métricas, de la más vieja a la más nueva (a igual día,
 * por id), con el país de cada alumno. Ver el encabezado del archivo para saber
 * cuáles se traen.
 */
export async function loadMetricSales(db: Db, now: Date): Promise<MetricSale[]> {
  const windowStart = historyStart(now);
  const isIncomeSale = inArray(sales.status, [...INCOME_STATUSES]);

  const inWindowOrOpen = await db
    .select(metricColumns)
    .from(sales)
    .innerJoin(customers, eq(sales.customerId, customers.id))
    .where(
      and(
        isIncomeSale,
        or(
          gte(sales.paidOn, windowStart),
          eq(sales.invoiceStatus, "pending"),
          and(eq(sales.status, "paid"), isNull(sales.deliveredAt)),
        ),
      ),
    );

  // De cada alumno con ventas en la ventana, su compra más vieja si es anterior a ella.
  const firstPurchases = await db
    .selectDistinctOn([sales.customerId], metricColumns)
    .from(sales)
    .innerJoin(customers, eq(sales.customerId, customers.id))
    .where(
      and(
        isIncomeSale,
        lt(sales.paidOn, windowStart),
        inArray(
          sales.customerId,
          db
            .select({ customerId: sales.customerId })
            .from(sales)
            .where(and(isIncomeSale, gte(sales.paidOn, windowStart))),
        ),
      ),
    )
    .orderBy(asc(sales.customerId), asc(sales.paidOn), asc(sales.id));

  const byId = new Map<string, MetricSale>();
  for (const row of [...inWindowOrOpen, ...firstPurchases]) {
    byId.set(row.id, toMetricSale(row));
  }
  return [...byId.values()].sort(compareOldestFirst);
}

function compareOldestFirst(a: MetricSale, b: MetricSale): number {
  const dayA = a.paidOn ?? "";
  const dayB = b.paidOn ?? "";
  if (dayA !== dayB) return dayA < dayB ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
