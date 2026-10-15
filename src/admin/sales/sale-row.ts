// La venta con los datos de su alumno, tal como la leen la lista de ventas, el
// formulario de edición y el historial de cada alumno. Vive aparte del
// repositorio de ventas para que el de alumnos pueda leer ventas sin que los
// dos repositorios se importen entre sí.

import { desc, sql } from "drizzle-orm";
import type {
  Currency,
  InvoiceStatus,
  InvoiceType,
  PaymentMethod,
  RateSource,
  SaleItem,
  SaleStatus,
} from "@/admin/catalog";
import { customers, sales } from "@/db/schema";

/** Una venta con los datos de su alumno, tal como la muestran la lista y el formulario. */
export interface SaleRow {
  id: string;
  customerId: string;
  customerName: string;
  customerDiscord: string | null;
  customerCountry: string | null;
  item: SaleItem;
  description: string | null;
  currency: Currency;
  /** Monto en la moneda cobrada, en unidades menores. */
  amountMinor: number;
  arsPerUnit: string;
  arsPerUsd: string;
  rateSource: RateSource;
  rateQuotedOn: string | null;
  amountArsMinor: number;
  amountUsdMinor: number;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  /** Día de cobro (Argentina), "AAAA-MM-DD". */
  paidOn: string | null;
  dueAt: Date | null;
  deliveredAt: Date | null;
  invoiceStatus: InvoiceStatus;
  invoiceType: InvoiceType | null;
  invoiceNumber: string | null;
  invoicedOn: string | null;
  source: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Las columnas de una venta con su alumno (`sales` unida con `customers`). */
export const saleRowColumns = {
  id: sales.id,
  customerId: sales.customerId,
  customerName: customers.name,
  customerDiscord: customers.discord,
  customerCountry: customers.country,
  item: sales.item,
  description: sales.description,
  currency: sales.currency,
  amountMinor: sales.amountMinor,
  arsPerUnit: sales.arsPerUnit,
  arsPerUsd: sales.arsPerUsd,
  rateSource: sales.rateSource,
  rateQuotedOn: sales.rateQuotedOn,
  amountArsMinor: sales.amountArsMinor,
  amountUsdMinor: sales.amountUsdMinor,
  paymentMethod: sales.paymentMethod,
  status: sales.status,
  paidOn: sales.paidOn,
  dueAt: sales.dueAt,
  deliveredAt: sales.deliveredAt,
  invoiceStatus: sales.invoiceStatus,
  invoiceType: sales.invoiceType,
  invoiceNumber: sales.invoiceNumber,
  invoicedOn: sales.invoicedOn,
  source: sales.source,
  notes: sales.notes,
  createdAt: sales.createdAt,
  updatedAt: sales.updatedAt,
};

/**
 * Orden de las ventas, las más nuevas primero: por día de cobro (las que
 * todavía no se cobraron, sin día, van arriba como pendientes de atención),
 * después por fecha de alta y, para desempatar, por id.
 */
export const newestSalesFirst = [
  sql`${sales.paidOn} desc nulls first`,
  desc(sales.createdAt),
  desc(sales.id),
] as const;

/** La fila como la devuelve la base: las listas cerradas son texto suelto. */
type RawRow = Omit<
  SaleRow,
  "item" | "currency" | "rateSource" | "paymentMethod" | "status" | "invoiceStatus" | "invoiceType"
> & {
  item: string;
  currency: string;
  rateSource: string;
  paymentMethod: string;
  status: string;
  invoiceStatus: string;
  invoiceType: string | null;
};

/**
 * Las columnas de lista cerrada llegan como texto; la base las limita con
 * restricciones `check` a los valores del catálogo, así que el cambio de tipo
 * es seguro.
 */
export function toSaleRow(raw: RawRow): SaleRow {
  return {
    ...raw,
    item: raw.item as SaleItem,
    currency: raw.currency as Currency,
    rateSource: raw.rateSource as RateSource,
    paymentMethod: raw.paymentMethod as PaymentMethod,
    status: raw.status as SaleStatus,
    invoiceStatus: raw.invoiceStatus as InvoiceStatus,
    invoiceType: raw.invoiceType as InvoiceType | null,
  };
}
