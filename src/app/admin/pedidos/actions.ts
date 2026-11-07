"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/admin/auth/require-admin";
import { ADMIN_ROUTES } from "@/admin/routes";
import { getDb } from "@/db/client";
import { deleteSiteRequest, markSiteRequestHandled } from "@/site-requests/requests";

// Las acciones de los pedidos del sitio. Como todas las del panel, verifican la sesión antes de todo.

/** Marca el pedido `id` como atendido y vuelve a la lista. */
export async function markSiteRequestHandledAction(id: string): Promise<void> {
  await requireAdmin();
  const saved = await markSiteRequestHandled(await getDb(), id);
  redirect(saved ? `${ADMIN_ROUTES.siteRequests}?atendido=1` : ADMIN_ROUTES.siteRequests);
}

/** Borra el pedido `id` y vuelve a la lista. */
export async function deleteSiteRequestAction(id: string): Promise<void> {
  await requireAdmin();
  await deleteSiteRequest(await getDb(), id);
  redirect(`${ADMIN_ROUTES.siteRequests}?borrado=1`);
}
