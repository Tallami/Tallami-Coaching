import type { NextRequest } from "next/server";
import { requireAdmin } from "@/admin/auth/require-admin";
import { billingExportResponse } from "@/admin/export/exports";
import { getDb } from "@/db/client";

/**
 * Descarga para el contador: lo cobrado (con fecha de cobro hasta hoy) como CSV.
 * Respeta los filtros de la dirección (`desde`, `hasta`, `factura`, …); lo que no
 * se reconoce se ignora. Como toda ruta del panel, verifica la sesión antes de todo.
 */
export async function GET(request: NextRequest): Promise<Response> {
  await requireAdmin();
  return billingExportResponse(await getDb(), request.nextUrl.searchParams, new Date());
}
