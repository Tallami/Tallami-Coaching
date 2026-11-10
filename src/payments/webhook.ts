// `POST /api/payments/mercadopago`: el aviso de Mercado Pago de que algo le pasó a un pago. La
// ruta (`src/app/api/payments/mercadopago/route.ts`) solo llama a esta función; vive acá para
// probarla con un `Request` real, una base en memoria y un cliente falso.
//
// Contrato:
//   200  aplicado; también lo que no hay que procesar (otro `type`, un pago que no existe)
//   400  cuerpo que no es un objeto JSON, o un contracargo sin el id del pago
//   401  firma que no da. No se consulta nada
//   413  cuerpo de más de `MAX_BODY_BYTES`
//   500  falló la consulta a Mercado Pago o la base: Mercado Pago reintenta
//   503  falta el secreto o el token: Mercado Pago reintenta, y llega cuando se configuren
//
// La firma cubre `data.id` de la consulta, `x-request-id` y `ts`, y no cubre el cuerpo: del
// cuerpo solo se lee qué consultar (`type` y, en un contracargo, `data.payment_id`). Estado y
// monto salen siempre de consultar el pago con el token privado, así que un aviso repetido o
// un cuerpo cambiado no pueden hacer más que pedir que se mire de nuevo un pago.
//
// Los logs llevan solo el paso y el tipo de error, y de un pago que no coincide con su pedido, los dos ids.

import { readLimitedText } from "@/admin/interest/endpoint";
import type { Db } from "@/db/client";
import { applyProviderPayment } from "./apply";
import { notifyPaymentOutcome } from "./emails";
import { getMercadoPagoClient, verifyWebhookSignature } from "./mercadopago";
import type { PaymentProviderClient, ProviderPayment } from "./provider";

/** Un aviso real mide menos de 1 KB; 64 KB sobra y corta cualquier abuso. */
const MAX_BODY_BYTES = 64 * 1024;
const PAYMENT_NOTICE = "payment";
const CHARGEBACK_NOTICE = "topic_chargebacks_wh";
const HEADERS = { "Cache-Control": "no-store" } as const;

export interface MercadoPagoWebhookDeps {
  getDb: () => Promise<Db>;
  /** Por defecto, `getMercadoPagoClient()`. `null` es que no está configurado. */
  client?: PaymentProviderClient | null;
  now?: () => Date;
  /** Corre una tarea después de responder. La ruta pasa `after`. */
  schedule?: (task: () => Promise<void>) => void;
}

function ok(): Response {
  return new Response(null, { status: 200, headers: HEADERS });
}

/** Un error con cuerpo fijo: el código dice qué pasó, nunca lo que llegó. */
function failure(status: number, code: string): Response {
  return Response.json({ error: code }, { status, headers: HEADERS });
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** El id del pago de un contracargo, en `data.payment_id`, como número exacto o como texto. */
function chargebackPaymentId(body: Record<string, unknown>): string | null {
  const data = body.data;
  if (typeof data !== "object" || data === null) return null;
  const id = (data as Record<string, unknown>).payment_id;
  if (typeof id === "number" && Number.isSafeInteger(id)) return String(id);
  return typeof id === "string" && id ? id : null;
}

/** Lee el cuerpo y decide qué pago consultar: `null` si no hay nada que consultar, o la respuesta si el cuerpo no sirve. */
async function paymentToLookUp(request: Request, signedDataId: string): Promise<string | null | Response> {
  let text: string | null;
  try {
    text = await readLimitedText(request, MAX_BODY_BYTES);
  } catch (error) {
    console.error("[mercadopago] no se pudo leer el aviso:", errorName(error));
    return failure(400, "invalid_request");
  }
  if (text === null) return failure(413, "payload_too_large");
  const body = parseObject(text);
  if (body === null) return failure(400, "invalid_request");

  if (body.type === PAYMENT_NOTICE) return signedDataId;
  if (body.type === CHARGEBACK_NOTICE) return chargebackPaymentId(body) ?? failure(400, "invalid_request");
  return null;
}

/** Programa los emails. Si ni eso se puede, el pago igual quedó aplicado: va al log y se responde 200. */
function scheduleEmails(deps: MercadoPagoWebhookDeps, task: () => Promise<void>): void {
  const schedule = deps.schedule ?? ((scheduled) => void scheduled());
  try {
    schedule(task);
  } catch (error) {
    console.error("[mercadopago] no se pudieron programar los emails:", errorName(error));
  }
}

/** Consulta el pago y lo aplica. Un fallo acá es un 500: nada quedó hecho y Mercado Pago reintenta. */
async function lookUpAndApply(
  client: PaymentProviderClient,
  paymentId: string,
  deps: MercadoPagoWebhookDeps,
): Promise<Response> {
  let payment: ProviderPayment | null;
  try {
    payment = await client.fetchPayment(paymentId);
  } catch (error) {
    console.error("[mercadopago] no se pudo consultar el pago:", errorName(error));
    return failure(500, "unavailable");
  }
  if (payment === null) return ok();

  try {
    const db = await deps.getDb();
    const outcome = await applyProviderPayment(db, client.id, payment, deps.now?.() ?? new Date());
    if (outcome.kind === "unknown-order") console.warn("[mercadopago] aviso de un pago sin pedido conocido.");
    if (outcome.kind === "mismatch") {
      // Solo ids: un cobro doble o un monto distinto queda en el log aunque el email no salga.
      console.error(`[mercadopago] el pago ${outcome.providerPaymentId} no coincide con el pedido ${outcome.orderId}`);
    }
    scheduleEmails(deps, () => notifyPaymentOutcome(db, outcome));
    return ok();
  } catch (error) {
    console.error("[mercadopago] no se pudo aplicar el pago:", errorName(error));
    return failure(500, "unavailable");
  }
}

/** Atiende un aviso de Mercado Pago. */
export async function handleMercadoPagoWebhook(request: Request, deps: MercadoPagoWebhookDeps): Promise<Response> {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  if (!secret) return failure(503, "not_configured");

  const dataId = new URL(request.url).searchParams.get("data.id");
  const signed = verifyWebhookSignature({
    xSignature: request.headers.get("x-signature"),
    xRequestId: request.headers.get("x-request-id"),
    dataId,
    secret,
  });
  if (!signed || dataId === null) return failure(401, "invalid_signature");

  const paymentId = await paymentToLookUp(request, dataId);
  if (paymentId instanceof Response) return paymentId;
  if (paymentId === null) return ok();

  const client = deps.client === undefined ? getMercadoPagoClient() : deps.client;
  if (client === null) return failure(503, "not_configured");

  return lookUpAndApply(client, paymentId, deps);
}
