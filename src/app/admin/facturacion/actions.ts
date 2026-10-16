"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/admin/auth/require-admin";
import type { InvoicingFormState } from "@/admin/billing/form-state";
import { invoicingResultPath } from "@/admin/billing/saved-notice";
import { saveInvoicing } from "@/admin/billing/save-invoicing";
import { getDb } from "@/db/client";

/**
 * Marca las ventas elegidas como facturadas o como "no requiere factura".
 * Las acciones del panel verifican la sesión antes de todo. Si marca, vuelve a
 * la pantalla con un aviso; si no, devuelve el estado con los errores.
 */
export async function invoicingAction(
  _previous: InvoicingFormState,
  formData: FormData,
): Promise<InvoicingFormState> {
  await requireAdmin();
  const outcome = await saveInvoicing(await getDb(), formData);
  if (!outcome.saved) return outcome.state;
  redirect(invoicingResultPath(outcome.intent, outcome.updated));
}
