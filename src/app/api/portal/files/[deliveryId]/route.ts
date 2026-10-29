import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { getAccount } from "@/portal/accounts";
import { deliveryForStudent } from "@/portal/deliveries";
import { dbFileStore, fileNotFoundResponse, pdfResponse } from "@/portal/files";
import { PORTAL_COOKIE, readPortalSession } from "@/portal/sessions";

/**
 * El PDF de una entrega, para el alumno dueño y nadie más. Lee la sesión de la cookie del
 * pedido (esta ruta está fuera de next-intl y de las páginas del portal), busca la entrega
 * solo entre las compras de ese alumno y, si no es suya, no existe, no es un PDF o no hay
 * sesión, contesta lo mismo en todos los casos: 404 sin cuerpo. Quien cambia el id en la
 * dirección no aprende nada. Sin cookie ni siquiera se abre la base.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/portal/files/[deliveryId]">,
): Promise<Response> {
  const token = request.cookies.get(PORTAL_COOKIE)?.value;
  if (!token) return fileNotFoundResponse();

  const { deliveryId } = await context.params;
  const db = await getDb();
  const session = await readPortalSession(db, token);
  const account = session ? await getAccount(db, session.accountId) : null;
  if (!account?.customerId) return fileNotFoundResponse();

  const delivery = await deliveryForStudent(db, deliveryId, account.customerId);
  if (!delivery?.fileId) return fileNotFoundResponse();
  const file = await dbFileStore.get(db, delivery.fileId);
  return file ? pdfResponse(file) : fileNotFoundResponse();
}
