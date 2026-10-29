import type { NextRequest } from "next/server";
import { requireAdmin } from "@/admin/auth/require-admin";
import { getDb } from "@/db/client";
import { getDeliveryOfSale } from "@/portal/deliveries";
import { dbFileStore, fileNotFoundResponse, pdfResponse } from "@/portal/files";

/**
 * El PDF de una entrega, para ver desde la ficha de la venta. Como toda ruta del panel,
 * verifica la sesión antes de todo. La entrega se busca dentro de la venta de la dirección:
 * con el id de otra venta, o si no es un PDF, contesta 404 sin cuerpo.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext<"/admin/ventas/[id]/entregas/[deliveryId]">,
): Promise<Response> {
  await requireAdmin();
  const { id, deliveryId } = await context.params;
  const db = await getDb();

  const delivery = await getDeliveryOfSale(db, id, deliveryId);
  if (!delivery?.fileId) return fileNotFoundResponse();
  const file = await dbFileStore.get(db, delivery.fileId);
  return file ? pdfResponse(file) : fileNotFoundResponse();
}
