// La venta tal como la leen las métricas del panel: solo los campos que las
// cuentas necesitan, con las fechas como texto. Las funciones de métricas son
// puras sobre listas de `MetricSale`; la única que toca la base es `load.ts`.

import {
  INCOME_STATUSES,
  type InvoiceStatus,
  type PaymentMethod,
  type SaleItem,
  type SaleStatus,
} from "@/admin/catalog";

export interface MetricSale {
  id: string;
  customerId: string;
  /** Nombre del alumno, para las listas de pendientes. */
  customerName: string;
  item: SaleItem;
  status: SaleStatus;
  /** Día de cobro (Argentina), "AAAA-MM-DD". */
  paidOn: string | null;
  /** Entrega comprometida o sesión: un instante en ISO 8601 con zona ("2026-10-15T18:00:00.000Z"). */
  dueAt: string | null;
  /** Cuándo se entregó, en el mismo formato que `dueAt`. */
  deliveredAt: string | null;
  amountArsMinor: number;
  amountUsdMinor: number;
  paymentMethod: PaymentMethod;
  /** País del alumno (ISO 3166-1 alfa-2) o `null` si no se cargó. */
  country: string | null;
  invoiceStatus: InvoiceStatus;
}

/** Una venta que cuenta como ingreso: tiene su día de cobro. */
export type IncomeSale = MetricSale & { paidOn: string };

const INCOME_STATUS_SET: ReadonlySet<SaleStatus> = new Set(INCOME_STATUSES);

/**
 * ¿Es ingreso? Una venta cobrada o entregada y con su día de cobro (la base
 * exige el día en las cobradas; sin él la venta no cabría en ningún período).
 * Las pendientes, canceladas y reembolsadas nunca suman.
 */
export function isIncome(sale: MetricSale): sale is IncomeSale {
  return INCOME_STATUS_SET.has(sale.status) && sale.paidOn !== null;
}
