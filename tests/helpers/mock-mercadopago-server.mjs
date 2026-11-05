// Servidor falso de Mercado Pago (y de Resend) para los e2e de la compra: lo que el sitio ve
// con `MERCADOPAGO_API_BASE` y `RESEND_BASE_URL`. Node puro, sin dependencias; lo arranca
// Playwright (`playwright.config.ts`) y nunca es parte de la web.
//
//   node tests/helpers/mock-mercadopago-server.mjs    # puerto MOCK_MERCADOPAGO_PORT (3111 por defecto)
//
// Lo que usa el sitio, con `Authorization: Bearer …`:
//
//   POST /checkout/preferences   Guarda la preferencia y devuelve `{ id, init_point }`.
//   GET  /v1/payments/:id        El pago, o 404.
//   GET  /v1/payments/search     `?external_reference=…`: los pagos del pedido, el más nuevo primero.
//   POST /emails                 Imita a Resend: guarda el email y devuelve `{ id }`.
//
// Lo que ve el comprador:
//
//   GET  /pay/:id                La pantalla de pago: botones Aprobar, Rechazar y "Aprobar sin aviso".
//   POST /pay/:id/:choice        Crea el pago, manda el aviso **firmado** a
//                                `{APP_BASE}/api/payments/mercadopago?data.id=…&type=payment` (salvo
//                                "Aprobar sin aviso") y vuelve (303) a `back_urls` con `payment_id` y `status`.
//
// Lo que usan los tests:
//
//   POST /test/payments/:id      `{ status, status_detail? }`: cambia el estado del pago y avisa.
//   GET  /test/preferences       Las preferencias recibidas.
//   GET  /test/emails            Los emails recibidos.
//   GET  /health                 200: Playwright espera esta dirección para saber que arrancó.
//
// Escucha solo en esta máquina (127.0.0.1 y ::1).

import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_MERCADOPAGO_PORT ?? 3111);
const APP_BASE = process.env.APP_BASE ?? "http://localhost:3100";
const WEBHOOK_SECRET = process.env.MERCADOPAGO_WEBHOOK_SECRET ?? "";
const BASE = `http://localhost:${PORT}`;
const MAX_BODY_BYTES = 64 * 1024;

/** Cada botón de la pantalla de pago: el estado del pago, a qué `back_urls` vuelve y si avisa. */
const CHOICES = {
  approve: { status: "approved", detail: "accredited", back: "success", notifies: true },
  reject: { status: "rejected", detail: "cc_rejected_other_reason", back: "failure", notifies: true },
  "approve-silent": { status: "approved", detail: "accredited", back: "success", notifies: false },
};

/** Preferencias recibidas: id → cuerpo. */
const preferences = new Map();
/** Pagos creados: id → pago, en el orden en que se crearon. */
const payments = new Map();
const emails = [];
let nextPaymentId = 9_000_000_000;

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "Cache-Control": "no-store", ...headers });
  response.end(body);
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), { "Content-Type": "application/json" });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("cuerpo demasiado grande"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function hasToken(request) {
  const [scheme, value] = (request.headers.authorization ?? "").split(" ");
  return scheme === "Bearer" && Boolean(value);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** ¿Es una dirección de vuelta de esta máquina? El servidor falso no vuelve a ningún otro lado. */
function isLocalUrl(value) {
  if (typeof value !== "string" || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

async function createPreference(request, response) {
  const body = JSON.parse(await readBody(request));
  const urls = Object.values(body.back_urls ?? {});
  if (urls.length === 0 || !urls.every(isLocalUrl)) return sendJson(response, 400, { error: "invalid_back_urls" });
  const id = randomUUID();
  preferences.set(id, body);
  return sendJson(response, 201, { id, init_point: `${BASE}/pay/${id}` });
}

function payPage(response, id) {
  const preference = preferences.get(id);
  if (!preference) return send(response, 404, "no existe");
  const [item] = preference.items;
  const button = (choice, label) =>
    `<form method="post" action="/pay/${id}/${choice}"><button type="submit">${label}</button></form>`;
  return send(
    response,
    200,
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Mercado Pago de prueba</title></head><body>
<h1>Mercado Pago de prueba</h1>
<p data-testid="title">${escapeHtml(item.title)}</p>
<p data-testid="amount">${escapeHtml(item.unit_price)} ${escapeHtml(item.currency_id)}</p>
${button("approve", "Aprobar")}
${button("reject", "Rechazar")}
${button("approve-silent", "Aprobar sin aviso")}
</body></html>`,
    { "Content-Type": "text/html; charset=utf-8" },
  );
}

/** El aviso de Mercado Pago, firmado como manda su documentación: HMAC-SHA256 en hexadecimal. */
async function notify(paymentId) {
  const ts = String(Math.floor(Date.now() / 1000));
  const requestId = randomUUID();
  const manifest = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", WEBHOOK_SECRET).update(manifest).digest("hex");
  const url = new URL("/api/payments/mercadopago", APP_BASE);
  url.searchParams.set("data.id", paymentId);
  url.searchParams.set("type", "payment");
  try {
    const answered = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
      body: JSON.stringify({ action: "payment.updated", type: "payment", data: { id: paymentId } }),
    });
    return answered.status;
  } catch {
    return 0;
  }
}

async function choose(response, id, choiceName) {
  const preference = preferences.get(id);
  const choice = Object.hasOwn(CHOICES, choiceName) ? CHOICES[choiceName] : undefined;
  if (!preference || !choice) return send(response, 404, "no existe");

  const paymentId = String(nextPaymentId);
  nextPaymentId += 1;
  const [item] = preference.items;
  const now = new Date().toISOString();
  payments.set(paymentId, {
    id: Number(paymentId),
    status: choice.status,
    status_detail: choice.detail,
    external_reference: preference.external_reference,
    transaction_amount: item.unit_price,
    currency_id: item.currency_id,
    date_created: now,
    date_approved: choice.status === "approved" ? now : null,
  });
  if (choice.notifies) await notify(paymentId);

  const back = new URL(preference.back_urls[choice.back]);
  back.searchParams.set("payment_id", paymentId);
  back.searchParams.set("status", choice.status);
  back.searchParams.set("external_reference", preference.external_reference);
  back.searchParams.set("preference_id", id);
  return send(response, 303, "", { Location: back.toString() });
}

function searchPayments(url, response) {
  const reference = url.searchParams.get("external_reference");
  const results = [...payments.values()].filter((payment) => payment.external_reference === reference).reverse();
  return sendJson(response, 200, { results, paging: { total: results.length, limit: 30, offset: 0 } });
}

async function changePayment(request, response, id) {
  const payment = payments.get(id);
  if (!payment) return sendJson(response, 404, { error: "not_found" });
  const { status, status_detail: detail } = JSON.parse(await readBody(request));
  payments.set(id, { ...payment, status, status_detail: detail ?? payment.status_detail });
  return sendJson(response, 200, { noticeStatus: await notify(id) });
}

async function receiveEmail(request, response) {
  emails.push(JSON.parse(await readBody(request)));
  return sendJson(response, 200, { id: randomUUID() });
}

/** Lo que pide el sitio con su token. `null` si no es ninguna de esas rutas. */
function siteRoute(request, url, response) {
  const route = `${request.method} ${url.pathname}`;
  if (route === "POST /checkout/preferences") return createPreference(request, response);
  if (route === "POST /emails") return receiveEmail(request, response);
  if (route === "GET /v1/payments/search") return searchPayments(url, response);
  const payment = /^\/v1\/payments\/(\d+)$/.exec(url.pathname);
  if (request.method === "GET" && payment) {
    const found = payments.get(payment[1]);
    return found ? sendJson(response, 200, found) : sendJson(response, 404, { error: "not_found" });
  }
  return null;
}

async function handle(request, response) {
  const url = new URL(request.url ?? "/", BASE);
  const route = `${request.method} ${url.pathname}`;
  try {
    if (route === "GET /health") return send(response, 200, "ok");
    if (route === "GET /test/preferences") return sendJson(response, 200, [...preferences.values()]);
    if (route === "GET /test/emails") return sendJson(response, 200, emails);

    const pay = /^\/pay\/([\w-]+)$/.exec(url.pathname);
    if (request.method === "GET" && pay) return payPage(response, pay[1]);
    const choice = /^\/pay\/([\w-]+)\/([\w-]+)$/.exec(url.pathname);
    if (request.method === "POST" && choice) return await choose(response, choice[1], choice[2]);
    const change = /^\/test\/payments\/(\d+)$/.exec(url.pathname);
    if (request.method === "POST" && change) return await changePayment(request, response, change[1]);

    const isApi = url.pathname === "/checkout/preferences" || url.pathname === "/emails" || url.pathname.startsWith("/v1/");
    if (isApi && !hasToken(request)) return sendJson(response, 401, { error: "unauthorized" });
    const answered = await siteRoute(request, url, response);
    if (answered === null) return send(response, 404, "no existe");
    return answered;
  } catch {
    if (!response.headersSent) send(response, 400, "pedido inválido");
  }
}

// Las dos direcciones de esta máquina: `localhost` puede ser una u otra según el sistema.
for (const host of ["127.0.0.1", "::1"]) {
  const server = createServer((request, response) => void handle(request, response));
  server.on("error", (error) => {
    // Sin IPv6 en la máquina, alcanza con IPv4.
    if (host === "::1" && error.code === "EADDRNOTAVAIL") return;
    console.error(`Servidor falso de Mercado Pago: no pudo escuchar en ${host}:${PORT} (${error.code ?? error.name}).`);
    process.exit(1);
  });
  server.listen(PORT, host);
}
