// El cliente de Mercado Pago (Checkout Pro). Verificado en su documentación oficial:
//
// - `POST /checkout/preferences` crea la preferencia y devuelve `init_point`, la
//   dirección a la que se manda al comprador.
// - `GET /v1/payments/{id}` y `GET /v1/payments/search?external_reference=…` dan el
//   pago. Sus estados: approved, authorized, in_process, in_mediation, pending,
//   rejected, cancelled, refunded, charged_back; `status_detail: partially_refunded`
//   llega con el estado `approved`.
// - El aviso (webhook) firma `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` con
//   HMAC-SHA256 en hexadecimal; el encabezado `x-signature` es `ts=…,v1=…`.
//
// El estado de un pago sale siempre de consultarlo acá: nunca se le cree al cuerpo
// de un aviso ni a los parámetros de vuelta. Los logs no llevan datos de personas,
// tokens ni montos: solo el paso y el código HTTP.

import { createHmac, timingSafeEqual } from "node:crypto";
import { STATEMENT_DESCRIPTOR } from "./policy";
import type {
  CheckoutRequest,
  PaymentProviderClient,
  PaymentStatus,
  ProviderPayment,
} from "./provider";

const DEFAULT_API_BASE = "https://api.mercadopago.com";
/** Lo máximo que se espera a Mercado Pago en cada pedido. */
const REQUEST_TIMEOUT_MS = 10_000;
const PAYMENT_ID = /^\d{1,20}$/;
const MINOR_UNITS = 100;

/** El valor de una variable sin los espacios de los costados, o `null` si falta o está vacía. */
function readEnv(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function accessToken(): string | null {
  return readEnv("MERCADOPAGO_ACCESS_TOKEN");
}

/** ¿Hay con qué hablar con Mercado Pago? */
export function isMercadoPagoConfigured(): boolean {
  return accessToken() !== null;
}

/** ¿Ya se avisó en este proceso que la base de prueba se ignora? */
let warnedTestBaseIgnored = false;

/**
 * La base de la API. `MERCADOPAGO_API_BASE` es solo para tests y desarrollo (un servidor
 * falso local) y en Vercel se ignora con un aviso, igual que `PORTAL_OAUTH_TEST_ISSUER`:
 * una variable de prueba olvidada ahí mandaría los cobros a otro lado.
 */
function apiBase(): string {
  const override = readEnv("MERCADOPAGO_API_BASE");
  if (!override) return DEFAULT_API_BASE;
  if (process.env.VERCEL) {
    if (!warnedTestBaseIgnored) {
      warnedTestBaseIgnored = true;
      console.warn("MERCADOPAGO_API_BASE se ignora en Vercel (VERCEL está definida). Sacá la variable.");
    }
    return DEFAULT_API_BASE;
  }
  const base = override.replace(/\/+$/, "");
  if (!URL.canParse(base)) return DEFAULT_API_BASE;
  const { protocol } = new URL(base);
  return protocol === "http:" || protocol === "https:" ? base : DEFAULT_API_BASE;
}

/** Igualdad en tiempo constante de dos textos (falso enseguida si el largo difiere). */
function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface WebhookSignatureInput {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
}

/** Las partes `clave=valor` de `x-signature` (`ts=1700,v1=…`). */
function signatureParts(header: string): Map<string, string> {
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const separator = piece.indexOf("=");
    if (separator > 0) parts.set(piece.slice(0, separator).trim(), piece.slice(separator + 1).trim());
  }
  return parts;
}

/**
 * ¿Firmó Mercado Pago este aviso con nuestro secreto? Arma el texto
 * `id:<dataId en minúsculas>;request-id:<x-request-id>;ts:<ts>;`, le saca el HMAC-SHA256
 * y lo compara con `v1` en tiempo constante. Cualquier dato que falte da `false`; nunca tira.
 */
export function verifyWebhookSignature({ xSignature, xRequestId, dataId, secret }: WebhookSignatureInput): boolean {
  if (!xSignature || !xRequestId || !dataId || !secret) return false;
  const parts = signatureParts(xSignature);
  const ts = parts.get("ts");
  const received = parts.get("v1");
  if (!ts || !received) return false;
  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  return sameText(received.toLowerCase(), expected);
}

function requestInit(init: RequestInit): RequestInit {
  return { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const json: unknown = await response.json();
    return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** El error de un pedido que Mercado Pago no aceptó: solo el paso y el código HTTP. */
function failure(step: string, status: number): Error {
  return new Error(`Mercado Pago: ${step} respondió ${status}.`);
}

function toStatus(status: unknown, detail: unknown): PaymentStatus {
  switch (status) {
    case "approved":
      return detail === "partially_refunded" ? "partially_refunded" : "approved";
    case "in_process":
    case "authorized":
    case "pending":
      return "pending";
    case "rejected":
    case "cancelled":
    case "refunded":
    case "in_mediation":
    case "charged_back":
      return status;
    default:
      throw new Error("Mercado Pago: el pago trae un estado desconocido.");
  }
}

function normalizePayment(body: Record<string, unknown>): ProviderPayment {
  const amount = body.transaction_amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    throw new Error("Mercado Pago: el pago no trae un monto válido.");
  }
  const id = body.id;
  if (typeof id !== "number" && typeof id !== "string") throw new Error("Mercado Pago: el pago no trae id.");
  const reference = body.external_reference;
  const approved = typeof body.date_approved === "string" ? new Date(body.date_approved) : null;
  return {
    providerPaymentId: String(id),
    orderId: typeof reference === "string" && reference ? reference : null,
    status: toStatus(body.status, body.status_detail),
    amountMinor: Math.round(amount * MINOR_UNITS),
    currency: typeof body.currency_id === "string" ? body.currency_id : "",
    approvedAt: approved && !Number.isNaN(approved.getTime()) ? approved : null,
  };
}

function preferenceBody(request: CheckoutRequest): Record<string, unknown> {
  return {
    items: [
      {
        id: request.orderId,
        title: request.title,
        quantity: 1,
        unit_price: request.amountArsMinor / MINOR_UNITS,
        currency_id: "ARS",
      },
    ],
    external_reference: request.orderId,
    back_urls: { success: request.returnUrl, failure: request.returnUrl, pending: request.returnUrl },
    auto_return: "approved",
    statement_descriptor: STATEMENT_DESCRIPTOR,
    payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 },
    expires: true,
    expiration_date_to: request.expiresAt.toISOString(),
    ...(request.payerEmail ? { payer: { email: request.payerEmail } } : {}),
  };
}

/**
 * El cliente de Mercado Pago, o `null` si falta `MERCADOPAGO_ACCESS_TOKEN`. `fetchWith`
 * es para los tests. Todo método tira ante una respuesta que no sea la esperada o una
 * red caída: quien llama decide qué hacer (el aviso, por ejemplo, responde 500 para que
 * Mercado Pago reintente).
 */
export function getMercadoPagoClient(fetchWith: typeof fetch = globalThis.fetch): PaymentProviderClient | null {
  const token = accessToken();
  if (!token) return null;
  const base = apiBase();
  const authorization = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  async function readPayment(url: string, step: string): Promise<Record<string, unknown> | null> {
    const response = await fetchWith(url, requestInit({ method: "GET", headers: authorization }));
    if (response.status === 404) return null;
    if (!response.ok) throw failure(step, response.status);
    return readJson(response);
  }

  return {
    id: "mercadopago",

    async createCheckout(request) {
      const response = await fetchWith(
        `${base}/checkout/preferences`,
        requestInit({
          method: "POST",
          headers: { ...authorization, "Content-Type": "application/json" },
          body: JSON.stringify(preferenceBody(request)),
        }),
      );
      if (!response.ok) throw failure("crear la preferencia", response.status);
      const initPoint = (await readJson(response))?.init_point;
      if (typeof initPoint !== "string" || !initPoint) {
        throw new Error("Mercado Pago: la preferencia no trae la dirección de pago.");
      }
      return { redirectUrl: initPoint };
    },

    async fetchPayment(paymentId) {
      if (!PAYMENT_ID.test(paymentId)) return null;
      const body = await readPayment(`${base}/v1/payments/${paymentId}`, "consultar el pago");
      return body ? normalizePayment(body) : null;
    },

    async findPaymentForOrder(orderId) {
      const query = new URLSearchParams({ external_reference: orderId, sort: "date_created", criteria: "desc" });
      const body = await readPayment(`${base}/v1/payments/search?${query.toString()}`, "buscar el pago");
      const first: unknown = Array.isArray(body?.results) ? body.results[0] : undefined;
      if (typeof first !== "object" || first === null) return null;
      return normalizePayment(first as Record<string, unknown>);
    },
  };
}
