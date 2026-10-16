import type { NextRequest } from "next/server";
import { requireAdmin } from "@/admin/auth/require-admin";
import { salesExportResponse } from "@/admin/export/exports";
import { getDb } from "@/db/client";

/**
 * Descarga de las ventas que filtra la lista de ventas, como CSV. Respeta los
 * mismos filtros de la dirección (`desde`, `hasta`, `servicio`, `estado`, `medio`,
 * `factura`, `q`); lo que no se reconoce se ignora. Como toda ruta del panel,
 * verifica la sesión antes de todo.
 */
export async function GET(request: NextRequest): Promise<Response> {
  await requireAdmin();
  return salesExportResponse(await getDb(), request.nextUrl.searchParams, new Date());
}
