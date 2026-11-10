import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import { orders, sales } from "@/db/schema";
import { notifyPaymentOutcome } from "@/payments/emails";
import type { PaymentProviderClient, ProviderPayment } from "@/payments/provider";
import { handleMercadoPagoWebhook } from "@/payments/webhook";
import { createTestDb } from "../helpers/db";
import { insertTestOrder, testPayment, PAYMENT_ID } from "../helpers/orders";

// El envío de verdad se prueba en `payments-emails.test.ts`: acá importa cuándo se programa.
vi.mock("@/payments/emails", () => ({ notifyPaymentOutcome: vi.fn(async () => undefined) }));

const SECRET = "clave-secreta-de-los-avisos";
const REQUEST_ID = "pedido-de-mercado-pago-1";
const TS = "1700000000";
const URL_BASE = "https://tallami.example/api/payments/mercadopago";
const CHARGEBACK_ID = "217000061307271000";
const MAX_BODY_BYTES = 64 * 1024;
const NOW = new Date("2026-11-05T12:00:00.000-03:00");

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "");
  vi.stubEnv("MERCADOPAGO_API_BASE", "");
  vi.stubEnv("VERCEL", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(notifyPaymentOutcome).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sign(dataId: string, secret: string = SECRET): string {
  const manifest = `id:${dataId};request-id:${REQUEST_ID};ts:${TS};`;
  return `ts=${TS},v1=${createHmac("sha256", secret).update(manifest).digest("hex")}`;
}

interface NoticeOptions {
  dataId?: string;
  body?: unknown;
  signature?: string | null;
  headers?: Record<string, string>;
}

/** Un aviso como los de Mercado Pago: `data.id` en la consulta, firmado, y el cuerpo en JSON. */
function notice({ dataId = PAYMENT_ID, body, signature, headers = {} }: NoticeOptions = {}): Request {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? { type: "payment", data: { id: dataId } });
  const signed = signature === undefined ? sign(dataId) : signature;
  return new Request(`${URL_BASE}?data.id=${dataId}&type=payment`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-request-id": REQUEST_ID,
      ...(signed === null ? {} : { "x-signature": signed }),
      ...headers,
    },
    body: text,
  });
}

function fakeClient(fetchPayment: (id: string) => Promise<ProviderPayment | null>) {
  const spy = vi.fn(fetchPayment);
  const client: PaymentProviderClient = {
    id: "mercadopago",
    createCheckout: vi.fn(),
    fetchPayment: spy,
    findPaymentForOrder: vi.fn(),
  };
  return { client, fetchPayment: spy };
}

function setup(fetchPayment: (id: string) => Promise<ProviderPayment | null> = async () => null) {
  const { client, fetchPayment: spy } = fakeClient(fetchPayment);
  const getDb = vi.fn(async () => db);
  const tasks: (() => Promise<void>)[] = [];
  const schedule = vi.fn((task: () => Promise<void>) => void tasks.push(task));
  return {
    fetchPayment: spy,
    getDb,
    tasks,
    schedule,
    deps: { getDb, client, schedule, now: () => NOW },
  };
}

describe("handleMercadoPagoWebhook: the signature", () => {
  test("a bad signature is a 401 and nothing is looked up", async () => {
    const { deps, fetchPayment, getDb } = setup();

    const response = await handleMercadoPagoWebhook(notice({ signature: sign(PAYMENT_ID, "otra-clave") }), deps);

    expect(response.status).toBe(401);
    expect(fetchPayment).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  test("no signature at all is a 401", async () => {
    const { deps, fetchPayment } = setup();

    const response = await handleMercadoPagoWebhook(notice({ signature: null }), deps);

    expect(response.status).toBe(401);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  test("a signature made for another payment is a 401: `data.id` of the query is what is signed", async () => {
    const { deps, fetchPayment } = setup();

    const response = await handleMercadoPagoWebhook(notice({ dataId: "111", signature: sign("222") }), deps);

    expect(response.status).toBe(401);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  test("`data.id` only in the body does not count: 401", async () => {
    const { deps, fetchPayment } = setup();
    const request = new Request(URL_BASE, {
      method: "POST",
      headers: { "x-request-id": REQUEST_ID, "x-signature": sign(PAYMENT_ID) },
      body: JSON.stringify({ type: "payment", data: { id: PAYMENT_ID } }),
    });

    const response = await handleMercadoPagoWebhook(request, deps);

    expect(response.status).toBe(401);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  test.each(["", "   "])("without the secret configured (%j) it is a 503, whatever comes", async (secret) => {
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", secret);
    const { deps, fetchPayment } = setup();

    const response = await handleMercadoPagoWebhook(notice(), deps);

    expect(response.status).toBe(503);
    expect(fetchPayment).not.toHaveBeenCalled();
  });
});

describe("handleMercadoPagoWebhook: what to look up", () => {
  test("`type: payment` looks up `data.id` of the query, applies it and answers 200", async () => {
    const order = await insertTestOrder(db);
    const { deps, fetchPayment } = setup(async () => testPayment(order.id));

    const response = await handleMercadoPagoWebhook(notice(), deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(fetchPayment).toHaveBeenCalledTimes(1);
    expect(fetchPayment).toHaveBeenCalledWith(PAYMENT_ID);
    const [sale] = await db.select().from(sales);
    expect(sale.status).toBe("paid");
    const [saved] = await db.select().from(orders);
    expect(saved.status).toBe("approved");
  });

  test("`topic_chargebacks_wh`: the signature uses `data.id` of the query and the payment is `data.payment_id` of the body", async () => {
    const order = await insertTestOrder(db);
    const { deps, fetchPayment } = setup(async () => testPayment(order.id, { status: "charged_back" }));
    const body = {
      type: "topic_chargebacks_wh",
      data: { id: 217000061307271000, payment_id: Number(PAYMENT_ID) },
    };

    const response = await handleMercadoPagoWebhook(notice({ dataId: CHARGEBACK_ID, body }), deps);

    expect(response.status).toBe(200);
    expect(fetchPayment).toHaveBeenCalledTimes(1);
    expect(fetchPayment).toHaveBeenCalledWith(PAYMENT_ID);
    const [saved] = await db.select().from(orders);
    expect(saved.status).toBe("charged_back");
  });

  test("a chargeback whose payment id comes as text is looked up the same", async () => {
    const { deps, fetchPayment } = setup();
    const body = { type: "topic_chargebacks_wh", data: { id: CHARGEBACK_ID, payment_id: PAYMENT_ID } };

    const response = await handleMercadoPagoWebhook(notice({ dataId: CHARGEBACK_ID, body }), deps);

    expect(response.status).toBe(200);
    expect(fetchPayment).toHaveBeenCalledWith(PAYMENT_ID);
  });

  test.each([
    ["without a payment id", { type: "topic_chargebacks_wh", data: { id: CHARGEBACK_ID } }],
    ["without data", { type: "topic_chargebacks_wh" }],
    ["with a payment id that is not an id", { type: "topic_chargebacks_wh", data: { payment_id: { a: 1 } } }],
    ["with a number too large to be exact", { type: "topic_chargebacks_wh", data: { payment_id: 2 ** 60 } }],
  ])("a chargeback %s is a broken body: 400 without looking anything up", async (_name, body) => {
    const { deps, fetchPayment } = setup();

    const response = await handleMercadoPagoWebhook(notice({ dataId: CHARGEBACK_ID, body }), deps);

    expect(response.status).toBe(400);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  test.each([
    ["another type", { type: "merchant_order", data: { id: PAYMENT_ID } }],
    ["no type", { data: { id: PAYMENT_ID } }],
  ])("%s is a 200 without looking anything up", async (_name, body) => {
    const { deps, fetchPayment, getDb } = setup();

    const response = await handleMercadoPagoWebhook(notice({ body }), deps);

    expect(response.status).toBe(200);
    expect(fetchPayment).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });

  test("what the body says about status or amount is ignored: the API says what happened", async () => {
    const order = await insertTestOrder(db);
    const { deps, fetchPayment } = setup(async () => testPayment(order.id, { status: "rejected", approvedAt: null }));
    const body = {
      type: "payment",
      status: "approved",
      transaction_amount: 1,
      external_reference: "otro-pedido",
      data: { id: "999", status: "approved", transaction_amount: 1 },
    };

    const response = await handleMercadoPagoWebhook(notice({ body }), deps);

    expect(response.status).toBe(200);
    expect(fetchPayment).toHaveBeenCalledWith(PAYMENT_ID);
    expect(await db.select().from(sales)).toEqual([]);
    const [saved] = await db.select().from(orders);
    expect(saved.status).toBe("rejected");
  });
});

describe("handleMercadoPagoWebhook: broken bodies", () => {
  test.each([
    ["not JSON", "{esto no es json"],
    ["empty", ""],
    ["a JSON that is not an object", "[1, 2]"],
    ["null", "null"],
  ])("%s is a 400", async (_name, body) => {
    const { deps, fetchPayment } = setup();

    const response = await handleMercadoPagoWebhook(notice({ body }), deps);

    expect(response.status).toBe(400);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  test("more than 64 KB is a 413", async () => {
    const { deps, fetchPayment } = setup();
    const body = JSON.stringify({ type: "payment", padding: "x".repeat(MAX_BODY_BYTES) });

    const response = await handleMercadoPagoWebhook(notice({ body }), deps);

    expect(response.status).toBe(413);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  test("declaring more than 64 KB is a 413 without reading it", async () => {
    const { deps } = setup();

    const response = await handleMercadoPagoWebhook(
      notice({ headers: { "content-length": String(MAX_BODY_BYTES + 1) } }),
      deps,
    );

    expect(response.status).toBe(413);
  });

  test("exactly 64 KB is read", async () => {
    const { deps } = setup();
    const prefix = JSON.stringify({ type: "otro", padding: "" });
    const padding = "x".repeat(MAX_BODY_BYTES - prefix.length);
    const body = JSON.stringify({ type: "otro", padding });

    const response = await handleMercadoPagoWebhook(notice({ body }), deps);

    expect(response.status).toBe(200);
  });

  test("a body that breaks while it is being read is a 400", async () => {
    const { deps, fetchPayment } = setup();
    const request = new Request(`${URL_BASE}?data.id=${PAYMENT_ID}`, {
      method: "POST",
      headers: { "x-request-id": REQUEST_ID, "x-signature": sign(PAYMENT_ID) },
      body: new ReadableStream({
        pull(controller) {
          controller.error(new Error("La conexión se cortó."));
        },
      }),
      duplex: "half",
    } as RequestInit);

    const response = await handleMercadoPagoWebhook(request, deps);

    expect(response.status).toBe(400);
    expect(fetchPayment).not.toHaveBeenCalled();
  });

  test("a bad signature does not even read the body", async () => {
    const { deps } = setup();
    const body = "x".repeat(MAX_BODY_BYTES + 1);

    const response = await handleMercadoPagoWebhook(notice({ body, signature: sign(PAYMENT_ID, "otra") }), deps);

    expect(response.status).toBe(401);
  });
});

describe("handleMercadoPagoWebhook: failures", () => {
  test("`fetchPayment` throwing is a 500, so Mercado Pago retries", async () => {
    const { deps, getDb } = setup(async () => {
      throw new Error("Mercado Pago: consultar el pago respondió 500.");
    });

    const response = await handleMercadoPagoWebhook(notice(), deps);

    expect(response.status).toBe(500);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("`fetchPayment` returning null is a 200: there is nothing to do and nothing to retry", async () => {
    const { deps, getDb, schedule } = setup(async () => null);

    const response = await handleMercadoPagoWebhook(notice(), deps);

    expect(response.status).toBe(200);
    expect(getDb).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  test("a payment that does not match its order leaves one line in the log, with ids only, and still schedules the email", async () => {
    const order = await insertTestOrder(db);
    const { deps, schedule } = setup(async () => testPayment(order.id, { amountMinor: 7_070_707 }));

    const response = await handleMercadoPagoWebhook(notice(), deps);

    expect(response.status).toBe(200);
    expect(schedule).toHaveBeenCalledTimes(1);
    const lines = vi.mocked(console.error).mock.calls.map((call) => call.map(String).join(" "));
    expect(lines).toEqual([`[mercadopago] el pago ${PAYMENT_ID} no coincide con el pedido ${order.id}`]);
    expect(lines[0]).not.toContain("70707");
    expect(lines[0]).not.toContain(order.buyerName);
  });

  test("the database failing is a 500, and the error text goes nowhere near the log", async () => {
    const order = await insertTestOrder(db);
    const { deps } = setup(async () => testPayment(order.id));
    deps.getDb = vi.fn(async () => {
      throw new Error("postgres://usuario:clave@base no responde");
    });

    const response = await handleMercadoPagoWebhook(notice(), deps);

    expect(response.status).toBe(500);
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).not.toContain("clave@base");
  });

  test("without a client (`null`) it is a 503, so Mercado Pago retries when it is configured", async () => {
    const { deps } = setup();

    const response = await handleMercadoPagoWebhook(notice(), { ...deps, client: null });

    expect(response.status).toBe(503);
  });

  test("without a `client` it uses the real one, which is a 503 when there is no token", async () => {
    const { deps } = setup();

    const response = await handleMercadoPagoWebhook(notice(), { getDb: deps.getDb, schedule: deps.schedule });

    expect(response.status).toBe(503);
  });

  test("without a `client` it uses the real one, with the token configured", async () => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "APP_USR-token-de-prueba");
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const { deps } = setup();

    const response = await handleMercadoPagoWebhook(notice(), { getDb: deps.getDb, schedule: deps.schedule });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toContain(`/v1/payments/${PAYMENT_ID}`);
  });
});

describe("handleMercadoPagoWebhook: the emails", () => {
  test("are scheduled, not awaited: nothing is sent until the scheduled task runs", async () => {
    const order = await insertTestOrder(db);
    const { deps, schedule, tasks } = setup(async () => testPayment(order.id));

    const response = await handleMercadoPagoWebhook(notice(), deps);

    expect(response.status).toBe(200);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(notifyPaymentOutcome).not.toHaveBeenCalled();

    await tasks[0]();

    expect(notifyPaymentOutcome).toHaveBeenCalledTimes(1);
    const [usedDb, outcome] = vi.mocked(notifyPaymentOutcome).mock.calls[0];
    expect(usedDb).toBe(db);
    expect(outcome).toMatchObject({ kind: "sale-created", orderId: order.id, status: "paid" });
  });

  test("the second notice of the same payment finds nothing to tell", async () => {
    const order = await insertTestOrder(db);
    const { deps, tasks } = setup(async () => testPayment(order.id));

    await handleMercadoPagoWebhook(notice(), deps);
    const repeated = await handleMercadoPagoWebhook(notice(), deps);

    expect(repeated.status).toBe(200);
    expect(await db.select().from(sales)).toHaveLength(1);
    for (const task of tasks) await task();
    const kinds = vi.mocked(notifyPaymentOutcome).mock.calls.map(([, outcome]) => outcome.kind);
    expect(kinds.filter((kind) => kind === "sale-created")).toHaveLength(1);
  });

  test("a scheduler that fails does not undo a payment already applied: still a 200", async () => {
    const order = await insertTestOrder(db);
    const { deps } = setup(async () => testPayment(order.id));

    const response = await handleMercadoPagoWebhook(notice(), {
      ...deps,
      schedule: () => {
        throw new Error("`after` was called outside a request scope");
      },
    });

    expect(response.status).toBe(200);
    expect(await db.select().from(sales)).toHaveLength(1);
  });

  test("without a scheduler they still go out, and the answer does not depend on them", async () => {
    const order = await insertTestOrder(db);
    const { deps } = setup(async () => testPayment(order.id));

    const response = await handleMercadoPagoWebhook(notice(), { getDb: deps.getDb, client: deps.client, now: deps.now });

    expect(response.status).toBe(200);
    expect(notifyPaymentOutcome).toHaveBeenCalledTimes(1);
  });

  test("uses the clock it was given", async () => {
    const order = await insertTestOrder(db);
    const { deps } = setup(async () => testPayment(order.id, { approvedAt: null }));

    await handleMercadoPagoWebhook(notice(), deps);

    const [sale] = await db.select().from(sales);
    expect(sale.paidOn).toBe("2026-11-05");
  });
});

describe("POST /api/payments/mercadopago", () => {
  test("is a thin wrapper: hands the request to the handler, with `after` as the scheduler", async () => {
    vi.resetModules();
    const handler = vi.fn(async () => new Response(null, { status: 200 }));
    vi.doMock("@/payments/webhook", () => ({ handleMercadoPagoWebhook: handler }));
    try {
      const { POST } = await import("@/app/api/payments/mercadopago/route");
      const { after } = await import("next/server");
      const { getDb } = await import("@/db/client");
      const request = new Request(URL_BASE, { method: "POST" });

      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(handler).toHaveBeenCalledWith(request, { getDb, schedule: after });
    } finally {
      vi.doUnmock("@/payments/webhook");
      vi.resetModules();
    }
  });
});
