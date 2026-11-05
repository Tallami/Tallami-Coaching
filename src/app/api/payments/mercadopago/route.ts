import { after } from "next/server";
import { getDb } from "@/db/client";
import { handleMercadoPagoWebhook } from "@/payments/webhook";

/**
 * El aviso firmado de Mercado Pago. Solo `POST`: Next contesta 405 a cualquier otro método.
 * El contrato completo (códigos, firma, qué se ignora) está en `src/payments/webhook.ts`.
 * Los emails salen con `after`, cuando Mercado Pago ya tiene su respuesta.
 */
export async function POST(request: Request): Promise<Response> {
  return handleMercadoPagoWebhook(request, { getDb, schedule: after });
}
