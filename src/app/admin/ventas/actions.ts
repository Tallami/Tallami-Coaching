"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/admin/auth/require-admin";
import { searchCustomers, type CustomerOption } from "@/admin/customers/repository";
import type { SaleFormState } from "@/admin/sales/form-state";
import { saveSale } from "@/admin/sales/save-sale";
import { getDb } from "@/db/client";

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
