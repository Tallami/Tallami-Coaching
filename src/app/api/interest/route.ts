import { handleInterestRequest } from "@/admin/interest/endpoint";
import { getDb } from "@/db/client";

/**
 * Aviso anónimo de que alguien tocó un botón de reserva del sitio público.
 * Solo `POST`: Next contesta 405 a cualquier otro método. El contrato completo
 * (códigos, límites, qué se descarta) está en `src/admin/interest/endpoint.ts`.
 */
export async function POST(request: Request): Promise<Response> {
  return handleInterestRequest(request, { getDb });
}
