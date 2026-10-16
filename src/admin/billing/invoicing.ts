// Facturación de las ventas: marcar las cobradas como facturadas (con el tipo,
// el número y la fecha de la factura) o como "no requiere factura", y listar
// las que faltan. El panel no emite facturas en ARCA: anota lo que Tallami ya
// hizo allá.
//
// Qué se puede marcar: una venta de ingreso (cobrada o entregada), con fecha de
// cobro que no sea futura (una venta con fecha de cobro de mañana todavía no se
// cobró, igual que en el resumen) y con la factura pendiente. Cualquier otra
// (cancelada, reembolsada, sin cobrar, ya facturada, que no existe) se rechaza.
//
// Un lote es todo o nada: si una sola venta no se puede marcar, la operación
// entera falla y no se cambia ninguna. Va en una transacción con un único
// `update … where` que ya trae las condiciones; si actualiza menos ventas que
// las pedidas, se deshace. Así tampoco hay carreras: dos pedidos a la vez sobre
// la misma venta no la marcan dos veces.

import { and, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { markInvoicedSchema, markNotRequiredSchema } from "@/admin/billing/schema";
import { INCOME_STATUSES, type InvoiceType } from "@/admin/catalog";
import { todayInArgentina } from "@/admin/dates";
import { fieldErrorsOf } from "@/admin/form-errors";
import { saleRowColumns, toSaleRow, type SaleRow } from "@/admin/sales/sale-row";
import type { Db } from "@/db/client";
import { customers, sales } from "@/db/schema";

export { MAX_INVOICE_BATCH } from "@/admin/billing/schema";

/** Ventas sin facturar que muestra la lista como mucho; con más, avisa que está cortada. */
export const UNINVOICED_LIMIT = 1000;

/** Los datos de la factura que se anotan en cada venta marcada. */
export interface InvoiceInput {
  type: InvoiceType;
  /** Como figura en ARCA, por ejemplo "00003-00000045". */
  number: string;
  /** Fecha de la factura, "AAAA-MM-DD". */
  issuedOn: string;
}

/** Algún dato no es válido (las ventas elegidas o la factura); `fieldErrors` trae un mensaje por campo. */
export class InvalidInvoiceError extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super("Los datos de la factura no son válidos.");
    this.name = "InvalidInvoiceError";
  }
}

/** Alguna venta elegida no se puede marcar (ya tiene factura, no está cobrada o no existe). No se cambió ninguna. */
export class InvoiceNotAllowedError extends Error {
  constructor(readonly rejected: number) {
    super(
      `${rejected === 1 ? "Una de las ventas elegidas ya no se puede marcar" : `${rejected} de las ventas elegidas ya no se pueden marcar`}: ya tiene factura, no está cobrada o no existe. No se cambió ninguna; recargá la página y elegí de nuevo.`,
    );
    this.name = "InvoiceNotAllowedError";
  }
}

/** Qué queda escrito en las ventas marcadas. */
type InvoiceValues =
  | { invoiceStatus: "issued"; invoiceType: InvoiceType; invoiceNumber: string; invoicedOn: string }
  | { invoiceStatus: "not_required"; invoiceType: null; invoiceNumber: null; invoicedOn: null };

/** Marca `ids` con `values` si todas se pueden marcar; si no, no toca ninguna. */
async function applyInvoice(
  db: Db,
  ids: readonly string[],
  values: InvoiceValues,
  today: string,
): Promise<{ updated: number }> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(sales)
      .set(values)
      .where(
        and(
          inArray(sales.id, [...ids]),
          inArray(sales.status, [...INCOME_STATUSES]),
          isNotNull(sales.paidOn),
          lte(sales.paidOn, today),
          eq(sales.invoiceStatus, "pending"),
        ),
      )
      .returning({ id: sales.id });
    // Tirar acá deshace la transacción: el lote es todo o nada.
    if (updated.length !== ids.length) throw new InvoiceNotAllowedError(ids.length - updated.length);
    return { updated: updated.length };
  });
}

/**
 * Marca las ventas como facturadas con el tipo, el número y la fecha de la
 * factura (el mismo para todas: una factura puede cubrir varias ventas). Tira
 * `InvalidInvoiceError` si los datos no son válidos y `InvoiceNotAllowedError`
 * si alguna venta no se puede marcar; en ambos casos no cambia nada.
 */
export async function markInvoiced(
  db: Db,
  ids: readonly string[],
  invoice: InvoiceInput,
  now: Date = new Date(),
): Promise<{ updated: number }> {
  const parsed = markInvoicedSchema.safeParse({ ...invoice, ids });
  if (!parsed.success) throw new InvalidInvoiceError(fieldErrorsOf(parsed.error));
  const { ids: chosen, type, number, issuedOn } = parsed.data;
  return applyInvoice(
    db,
    chosen,
    { invoiceStatus: "issued", invoiceType: type, invoiceNumber: number, invoicedOn: issuedOn },
    todayInArgentina(now),
  );
}

/** Marca las ventas como "no requiere factura". Mismas reglas y mismos errores que `markInvoiced`. */
export async function markInvoiceNotRequired(
  db: Db,
  ids: readonly string[],
  now: Date = new Date(),
): Promise<{ updated: number }> {
  const parsed = markNotRequiredSchema.safeParse({ ids });
  if (!parsed.success) throw new InvalidInvoiceError(fieldErrorsOf(parsed.error));
  return applyInvoice(
    db,
    parsed.data.ids,
    { invoiceStatus: "not_required", invoiceType: null, invoiceNumber: null, invoicedOn: null },
    todayInArgentina(now),
  );
}

/**
 * Las ventas que se pueden facturar (las que acepta `markInvoiced`), las más
 * nuevas primero, con los datos de su alumno. Si hay más que `limit` devuelve
 * las más nuevas y `truncated: true`.
 */
export async function listUninvoicedSales(
  db: Db,
  now: Date,
  limit: number = UNINVOICED_LIMIT,
): Promise<{ rows: SaleRow[]; truncated: boolean }> {
  const rows = await db
    .select(saleRowColumns)
    .from(sales)
    .innerJoin(customers, eq(sales.customerId, customers.id))
    .where(
      and(
        inArray(sales.status, [...INCOME_STATUSES]),
        isNotNull(sales.paidOn),
        lte(sales.paidOn, todayInArgentina(now)),
        eq(sales.invoiceStatus, "pending"),
      ),
    )
    .orderBy(desc(sales.paidOn), desc(sales.createdAt), desc(sales.id))
    .limit(limit + 1);
  return { rows: rows.slice(0, limit).map(toSaleRow), truncated: rows.length > limit };
}
