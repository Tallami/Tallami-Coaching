// Ventas: alta, edición, lectura y listado con filtros. Cada venta guarda su
// monto en la moneda cobrada y su valor en pesos y en dólares, calculados al
// guardar con el tipo de cambio de `SaleRates` (aritmética entera, half-up).
//
// Las funciones que escriben van en una transacción: un alumno nuevo y su
// venta se guardan juntos o no se guarda nada.

import { and, asc, count, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import {
  INCOME_STATUSES,
  isDollarCurrency,
  type InvoiceStatus,
  type PaymentMethod,
  type SaleItem,
  type SaleStatus,
} from "@/admin/catalog";
import { CustomerNotFoundError, createCustomer } from "@/admin/customers/repository";
import { PAGE_SIZE } from "@/admin/limits";
import type { SaleRates } from "@/admin/sales/rates";
import { newestSalesFirst, saleRowColumns, toSaleRow, type SaleRow } from "@/admin/sales/sale-row";
import type { SaleCustomerInput, SaleInput } from "@/admin/sales/schema";
import type { Db } from "@/db/client";
import { containsPattern } from "@/db/like";
import { customers, sales } from "@/db/schema";
import { isUuid } from "@/db/uuid";
import { arsToUsdMinor, convertToArsMinor } from "@/lib/money";

// La forma de una venta vive en `sale-row.ts`; se vuelve a exportar acá porque
// es lo que el resto del panel importa junto con las funciones de este archivo.
export type { SaleRow };
// El error vive con el repositorio de alumnos, que es quien lo tira al buscar uno.
export { CustomerNotFoundError };

/** Ventas por página si no se pide otro tamaño. */
/** Tope de página: más allá, el desplazamiento dejaría de ser un entero seguro. */
const MAX_PAGE = 1_000_000;

/** La venta que se quiere editar no existe. */
export class SaleNotFoundError extends Error {
  constructor() {
    super("No encontramos esa venta.");
    this.name = "SaleNotFoundError";
  }
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
 * La hora de entrega que se guarda: solo una venta entregada tiene una. Con otro
 * estado (cobrada, pendiente, cancelada, reembolsada) queda vacía aunque el
 * formulario traiga la fecha de cuando estaba entregada: una venta cobrada con
 * hora de entrega saldría de los pendientes de entrega sin haberse entregado. Una
 * venta entregada sin hora queda con la hora en que se guarda.
 */
function deliveryTime(input: SaleInput): Date | null {
  if (input.status !== "delivered") return null;
  return input.deliveredAt ?? new Date();
}

/**
 * Los valores de la venta a guardar. USD y USDT valen lo mismo en dólares que
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
    deliveredAt: deliveryTime(input),
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
  if (!isUuid(id)) throw new SaleNotFoundError();
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
  if (!isUuid(id)) return null;
  const [row] = await db
    .select(saleRowColumns)
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
  pageSize: number = PAGE_SIZE,
): Promise<{ rows: SaleRow[]; total: number }> {
  const safePage = Number.isInteger(page) && page > 1 ? Math.min(page, MAX_PAGE) : 1;
  const where = and(...filterConditions(filter));

  const [rows, [totals]] = await Promise.all([
    db
      .select(saleRowColumns)
      .from(sales)
      .innerJoin(customers, eq(sales.customerId, customers.id))
      .where(where)
      .orderBy(...newestSalesFirst)
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

/** Hay más ventas para exportar que las que entran en un archivo. */
export class ExportTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Hay más de ${limit} ventas para exportar.`);
    this.name = "ExportTooLargeError";
  }
}

export interface ExportOptions {
  /** Cuántas ventas como mucho; si hay más, tira `ExportTooLargeError` en vez de entregar un archivo cortado. */
  limit: number;
  /**
   * Solo lo cobrado hasta este día ("AAAA-MM-DD", inclusive): ventas cobradas o
   * entregadas con fecha de cobro a más tardar ese día. Es el criterio de
   * ingreso de los totales del panel; sin él se exporta todo lo que filtra la lista.
   */
  collectedBy?: string;
}

/**
 * Las ventas que cumplen el filtro, todas (sin páginas), de la cobrada hace más
 * tiempo a la más nueva; las que todavía no tienen fecha de cobro, al final.
 * Es el orden de un libro de ventas, el contrario al de la lista.
 */
export async function listSalesForExport(
  db: Db,
  filter: SaleFilter,
  options: ExportOptions,
): Promise<SaleRow[]> {
  const where = and(
    ...filterConditions(filter),
    options.collectedBy
      ? and(inArray(sales.status, [...INCOME_STATUSES]), lte(sales.paidOn, options.collectedBy))
      : undefined,
  );
  const rows = await db
    .select(saleRowColumns)
    .from(sales)
    .innerJoin(customers, eq(sales.customerId, customers.id))
    .where(where)
    .orderBy(sql`${sales.paidOn} asc nulls last`, asc(sales.createdAt), asc(sales.id))
    .limit(options.limit + 1);
  if (rows.length > options.limit) throw new ExportTooLargeError(options.limit);
  return rows.map(toSaleRow);
}
