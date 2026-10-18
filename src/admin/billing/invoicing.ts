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
import { isUuid } from "@/db/uuid";

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
  constructor(
    readonly rejected: number,
    message: string = `${rejected === 1 ? "Una de las ventas elegidas ya no se puede marcar" : `${rejected} de las ventas elegidas ya no se pueden marcar`}: ya tiene factura, no está cobrada o no existe. No se cambió ninguna; recargá la página y elegí de nuevo.`,
  ) {
    super(message);
    this.name = "InvoiceNotAllowedError";
  }
}

/**
 * La venta tiene factura (o "No requiere") pero no está cobrada ni entregada
 * (cancelada, reembolsada o pendiente): su factura no se vuelve a pendiente desde
 * el panel. Si ya salió en ARCA, anularla es con una nota de crédito, que se hace
 * allá. Es un `InvoiceNotAllowedError`: quien ya maneja ese rechazo lo sigue manejando.
 */
export class InvoiceNotCollectedError extends InvoiceNotAllowedError {
  constructor() {
    super(
      1,
      "La venta no está cobrada ni entregada, así que su factura no se vuelve a pendiente desde acá. Si ya la emitiste en ARCA, anularla es con una nota de crédito, que se hace en ARCA.",
    );
    this.name = "InvoiceNotCollectedError";
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
 * Devuelve una venta facturada (o marcada "no requiere factura") a pendiente y
 * borra los datos de su factura: tipo, número y fecha. Es el deshacer de
 * `markInvoiced` y de `markInvoiceNotRequired`; para corregir un número mal
 * escrito se deshace y se vuelve a marcar. No toca el cobro ni los montos.
 *
 * Solo de una venta cobrada o entregada (la misma regla que `markInvoiced`): la ficha
 * no muestra el botón en una cancelada o reembolsada, y una acción repetida a mano
 * tampoco puede deshacer su factura. Tira `InvoiceNotCollectedError` si la venta tiene
 * factura pero no está cobrada ni entregada, `InvoiceNotAllowedError` si ya está
 * pendiente o no existe, e `InvalidInvoiceError` si el id no es un uuid (nunca llega
 * a la base).
 */
export async function markInvoicePending(db: Db, id: string): Promise<{ updated: number }> {
  if (!isUuid(id)) {
    throw new InvalidInvoiceError({ ids: "La venta no es válida. Recargá la página y volvé a intentar." });
  }
  const updated = await db
    .update(sales)
    .set({ invoiceStatus: "pending", invoiceType: null, invoiceNumber: null, invoicedOn: null })
    .where(
      and(
        eq(sales.id, id.toLowerCase()),
        inArray(sales.invoiceStatus, ["issued", "not_required"]),
        inArray(sales.status, [...INCOME_STATUSES]),
      ),
    )
    .returning({ id: sales.id });
  if (updated.length === 0) {
    // Para decir el motivo: ¿tenía factura y fue el estado lo que la frenó?
    const [held] = await db
      .select({ id: sales.id })
      .from(sales)
      .where(and(eq(sales.id, id.toLowerCase()), inArray(sales.invoiceStatus, ["issued", "not_required"])))
      .limit(1);
    if (held) throw new InvoiceNotCollectedError();
    throw new InvoiceNotAllowedError(1, "Esa venta no tenía factura para quitar: ya estaba pendiente o no existe.");
  }
  return { updated: updated.length };
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
