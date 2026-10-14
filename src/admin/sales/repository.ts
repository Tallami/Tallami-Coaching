// Ventas: alta, edición, lectura y listado con filtros. Cada venta guarda su
// monto en la moneda cobrada y su valor en pesos y en dólares, calculados al
// guardar con el tipo de cambio de `SaleRates` (aritmética entera, half-up).
//
// Las funciones que escriben van en una transacción: un alumno nuevo y su
// venta se guardan juntos o no se guarda nada.

import { and, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import {
  isDollarCurrency,
  type Currency,
  type InvoiceStatus,
  type InvoiceType,
  type PaymentMethod,
  type RateSource,
  type SaleItem,
  type SaleStatus,
} from "@/admin/catalog";
import { createCustomer } from "@/admin/customers/repository";
import type { SaleRates } from "@/admin/sales/rates";
import type { SaleCustomerInput, SaleInput } from "@/admin/sales/schema";
import type { Db } from "@/db/client";
import { containsPattern } from "@/db/like";
import { customers, sales } from "@/db/schema";
import { arsToUsdMinor, convertToArsMinor } from "@/lib/money";

/** Ventas por página si no se pide otro tamaño. */
const DEFAULT_PAGE_SIZE = 25;
/** Tope de página: más allá, el desplazamiento dejaría de ser un entero seguro. */
const MAX_PAGE = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** La venta que se quiere editar no existe. */
export class SaleNotFoundError extends Error {
  constructor() {
    super("No encontramos esa venta.");
    this.name = "SaleNotFoundError";
  }
}

/** El alumno elegido para la venta no existe (por ejemplo, ya no está). */
export class CustomerNotFoundError extends Error {
  constructor() {
    super("Ese alumno ya no existe: elegí otro o cargalo de nuevo.");
    this.name = "CustomerNotFoundError";
  }
}

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

/** Filtros de la lista de ventas. Las fechas son el día de cobro, extremos incluidos. */
export interface SaleFilter {
  from?: string;
  to?: string;
  item?: SaleItem;
  status?: SaleStatus;
  paymentMethod?: PaymentMethod;
  invoiceStatus?: InvoiceStatus;
  /** Texto en el nombre o el Discord del alumno. */
  q?: string;
}

const rowColumns = {
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
function toSaleRow(raw: RawRow): SaleRow {
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

/** El alumno de la venta: el elegido (si existe) o uno nuevo dado de alta. */
async function resolveCustomerId(db: Db, customer: SaleCustomerInput): Promise<string> {
  if (customer.mode === "new") {
    return (await createCustomer(db, customer)).id;
  }
  const [found] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.id, customer.id))
    .limit(1);
  if (!found) throw new CustomerNotFoundError();
  return found.id;
}

/**
 * Los valores de la venta a guardar. Una venta entregada sin hora de entrega
 * queda con la hora en que se guarda. USD y USDT valen lo mismo en dólares que
 * su monto; las demás monedas pasan por pesos.
 */
function saleValues(customerId: string, input: SaleInput, rates: SaleRates) {
  const amountArsMinor = convertToArsMinor(input.amountMinor, rates.arsPerUnit);
  const amountUsdMinor = isDollarCurrency(input.currency)
    ? input.amountMinor
    : arsToUsdMinor(amountArsMinor, rates.arsPerUsd);
  return {
    customerId,
    item: input.item,
    description: input.description ?? null,
    currency: input.currency,
    amountMinor: input.amountMinor,
    arsPerUnit: rates.arsPerUnit,
    arsPerUsd: rates.arsPerUsd,
    rateSource: rates.source,
    rateQuotedOn: rates.quotedOn,
    amountArsMinor,
    amountUsdMinor,
    paymentMethod: input.paymentMethod,
    status: input.status,
    paidOn: input.paidOn ?? null,
    dueAt: input.dueAt ?? null,
    deliveredAt: input.deliveredAt ?? (input.status === "delivered" ? new Date() : null),
    notes: input.notes ?? null,
  };
}

/** Guarda una venta nueva (y su alumno, si es nuevo) y devuelve su id. */
export async function createSale(
  db: Db,
  input: SaleInput,
  rates: SaleRates,
): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const customerId = await resolveCustomerId(tx, input.customer);
    const [created] = await tx
      .insert(sales)
      .values(saleValues(customerId, input, rates))
      .returning({ id: sales.id });
    return created;
  });
}

/**
 * Cambia una venta y recalcula sus valores en pesos y dólares. No toca la
 * factura, el origen ni la fecha de alta. Tira `SaleNotFoundError` si no
 * existe (y no deja un alumno nuevo a medias).
 */
export async function updateSale(
  db: Db,
  id: string,
  input: SaleInput,
  rates: SaleRates,
): Promise<{ id: string }> {
  if (!UUID.test(id)) throw new SaleNotFoundError();
  return db.transaction(async (tx) => {
    const customerId = await resolveCustomerId(tx, input.customer);
    const [updated] = await tx
      .update(sales)
      .set(saleValues(customerId, input, rates))
      .where(eq(sales.id, id))
      .returning({ id: sales.id });
    if (!updated) throw new SaleNotFoundError();
    return updated;
  });
}

/** Una venta con los datos de su alumno, o `null` si no existe (o el id no es un id). */
export async function getSale(db: Db, id: string): Promise<SaleRow | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db
    .select(rowColumns)
    .from(sales)
    .innerJoin(customers, eq(sales.customerId, customers.id))
    .where(eq(sales.id, id))
    .limit(1);
  return row ? toSaleRow(row) : null;
}

function filterConditions(filter: SaleFilter): (SQL | undefined)[] {
  const pattern = filter.q === undefined ? null : containsPattern(filter.q);
  return [
    filter.from ? gte(sales.paidOn, filter.from) : undefined,
    filter.to ? lte(sales.paidOn, filter.to) : undefined,
    filter.item ? eq(sales.item, filter.item) : undefined,
    filter.status ? eq(sales.status, filter.status) : undefined,
    filter.paymentMethod ? eq(sales.paymentMethod, filter.paymentMethod) : undefined,
    filter.invoiceStatus ? eq(sales.invoiceStatus, filter.invoiceStatus) : undefined,
    pattern ? or(ilike(customers.name, pattern), ilike(customers.discord, pattern)) : undefined,
  ];
}

/**
 * Una página de ventas, las más nuevas primero: por día de cobro (las que
 * todavía no se cobraron, sin día, van arriba como pendientes de atención),
 * después por fecha de alta y, para desempatar, por id. Devuelve también el
 * total de ventas que cumplen el filtro. Una página menor a 1 es la primera.
 */
export async function listSales(
  db: Db,
  filter: SaleFilter,
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<{ rows: SaleRow[]; total: number }> {
  const safePage = Number.isInteger(page) && page > 1 ? Math.min(page, MAX_PAGE) : 1;
  const where = and(...filterConditions(filter));

  const [rows, [totals]] = await Promise.all([
    db
      .select(rowColumns)
      .from(sales)
      .innerJoin(customers, eq(sales.customerId, customers.id))
      .where(where)
      .orderBy(sql`${sales.paidOn} desc nulls first`, desc(sales.createdAt), desc(sales.id))
      .limit(pageSize)
      .offset((safePage - 1) * pageSize),
    db
      .select({ total: count() })
      .from(sales)
      .innerJoin(customers, eq(sales.customerId, customers.id))
      .where(where),
  ]);
  return { rows: rows.map(toSaleRow), total: totals.total };
}
