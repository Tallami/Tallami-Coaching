"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/admin/auth/require-admin";
import { InvoiceNotAllowedError, markInvoicePending } from "@/admin/billing/invoicing";
import { invoiceUndoPath, type InvoiceUndoOutcome } from "@/admin/billing/saved-notice";
import { searchCustomers, type CustomerOption } from "@/admin/customers/repository";
import type { SaleFormState } from "@/admin/sales/form-state";
import { saveSale } from "@/admin/sales/save-sale";
import { getDb } from "@/db/client";
import { isUuid } from "@/db/uuid";

/** La lista de ventas: adonde se vuelve si el id de la venta no es un id. */
const LIST_PATH = "/admin/ventas";
/** Dónde se vuelve después de guardar; la lista muestra el aviso según `guardada`. */
const CREATED_PATH = "/admin/ventas?guardada=creada";
const EDITED_PATH = "/admin/ventas?guardada=editada";

const MAX_SEARCH_LENGTH = 100;
const searchSchema = z.string().max(MAX_SEARCH_LENGTH);

/** Alta de una venta. Las acciones del panel verifican la sesión antes de todo. */
export async function createSaleAction(
  _previous: SaleFormState,
  formData: FormData,
): Promise<SaleFormState> {
  await requireAdmin();
  const outcome = await saveSale(await getDb(), formData);
  if (!outcome.saved) return outcome.state;
  redirect(CREATED_PATH);
}

/** Edición de la venta `saleId` (se pasa con `.bind(null, id)`). */
export async function updateSaleAction(
  saleId: string,
  _previous: SaleFormState,
  formData: FormData,
): Promise<SaleFormState> {
  await requireAdmin();
  const outcome = await saveSale(await getDb(), formData, saleId);
  if (!outcome.saved) return outcome.state;
  redirect(EDITED_PATH);
}

/** Búsqueda de alumnos por nombre o Discord, para elegir uno al cargar una venta. */
export async function searchCustomersAction(query: string): Promise<CustomerOption[]> {
  await requireAdmin();
  const text = searchSchema.safeParse(query);
  if (!text.success) return [];
  return searchCustomers(await getDb(), text.data);
}

/**
 * Devuelve la factura de la venta `saleId` a pendiente: el deshacer de marcarla
 * como facturada o como "no requiere factura" (se pasa con `.bind(null, id)`).
 * Vuelve a la ficha de la venta con un aviso. El id se revisa antes de tocar la
 * base: lo que no es un id vuelve a la lista.
 */
export async function markInvoicePendingAction(saleId: string): Promise<void> {
  await requireAdmin();
  if (!isUuid(saleId)) redirect(LIST_PATH);

  let outcome: InvoiceUndoOutcome = "done";
  try {
    await markInvoicePending(await getDb(), saleId);
  } catch (error) {
    if (!(error instanceof InvoiceNotAllowedError)) throw error;
    outcome = "refused";
  }
  // `redirect` interrumpe tirando un error: va fuera del `try`.
  redirect(invoiceUndoPath(saleId, outcome));
}
