import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ORDER_STATUSES,
  ORDER_TTL_MS,
  PAYMENT_PROVIDERS,
  PRO_APPLICATION_STATUSES,
  PRO_LINK_TTL_MS,
  PUBLIC_RECORD_RETENTION_MONTHS,
  PURCHASE_EXPIRY_DAYS,
  REPLAY_CODES_MAX_LENGTH,
  REPLAY_DELIVERY_HOURS,
  SITE_REQUEST_KINDS,
  SITE_REQUEST_STATUSES,
  STATEMENT_DESCRIPTOR,
  UNPAID_ORDER_RETENTION_DAYS,
} from "@/payments/policy";
import {
  getMercadoPagoClient,
  isMercadoPagoConfigured,
  verifyWebhookSignature,
} from "@/payments/mercadopago";

const TOKEN = "APP_USR-token-de-prueba";
const ORDER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const RETURN_URL = "https://tallami.example/es/compra/volver";
const EXPIRES_AT = new Date("2026-11-04T13:00:00.000Z");

beforeEach(() => {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", TOKEN);
  vi.stubEnv("MERCADOPAGO_API_BASE", "");
  vi.stubEnv("VERCEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function fakeFetch(response: Response | (() => Response)): ReturnType<typeof vi.fn> & typeof fetch {
  return vi.fn(async () => (typeof response === "function" ? response() : response)) as never;
}

function paymentBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 123456789,
    status: "approved",
    status_detail: "accredited",
    transaction_amount: 45000,
    currency_id: "ARS",
    external_reference: ORDER_ID,
    date_approved: "2026-11-04T12:30:00.000-03:00",
    ...overrides,
  };
}

describe("payment policy", () => {
  test("states the closed lists and the numbers of the design", () => {
    expect(PAYMENT_PROVIDERS).toEqual(["mercadopago"]);
    expect(ORDER_STATUSES).toEqual([
      "created",
      "pending",
      "approved",
      "rejected",
      "cancelled",
      "refunded",
      "charged_back",
    ]);
    expect(PRO_APPLICATION_STATUSES).toEqual(["new", "talking", "accepted", "rejected"]);
    expect(SITE_REQUEST_KINDS).toEqual(["withdrawal", "cancellation", "contact"]);
    expect(SITE_REQUEST_STATUSES).toEqual(["new", "handled"]);
    expect(ORDER_TTL_MS).toBe(60 * 60 * 1000);
    expect(PRO_LINK_TTL_MS).toBe(14 * 24 * 60 * 60 * 1000);
    expect(REPLAY_DELIVERY_HOURS).toEqual({ vodRecorded: 72, tournamentReview: 96 });
    expect(PURCHASE_EXPIRY_DAYS).toBe(150);
    expect(REPLAY_CODES_MAX_LENGTH).toBe(4000);
    expect(UNPAID_ORDER_RETENTION_DAYS).toBe(90);
    expect(PUBLIC_RECORD_RETENTION_MONTHS).toBe(24);
    expect(STATEMENT_DESCRIPTOR).toBe("TALLAMI");
  });
});

describe("configuration", () => {
  test("is configured only with an access token", () => {
    expect(isMercadoPagoConfigured()).toBe(true);
    expect(getMercadoPagoClient()?.id).toBe("mercadopago");

    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "  ");
    expect(isMercadoPagoConfigured()).toBe(false);
    expect(getMercadoPagoClient()).toBeNull();
  });

  test("uses the test base outside Vercel and ignores it on Vercel", async () => {
    vi.stubEnv("MERCADOPAGO_API_BASE", "http://localhost:3120/");
    const local = fakeFetch(jsonResponse(paymentBody()));
    await getMercadoPagoClient(local)?.fetchPayment("1");
    expect(vi.mocked(local).mock.calls[0][0]).toBe("http://localhost:3120/v1/payments/1");

    vi.stubEnv("VERCEL", "1");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const remote = fakeFetch(jsonResponse(paymentBody()));
    await getMercadoPagoClient(remote)?.fetchPayment("1");
    expect(vi.mocked(remote).mock.calls[0][0]).toBe("https://api.mercadopago.com/v1/payments/1");
  });
});

describe("createCheckout", () => {
  const request = {
    orderId: ORDER_ID,
    title: "VOD review de 3 partidas",
    amountArsMinor: 4_500_000,
    payerEmail: "ana@example.com",
    expiresAt: EXPIRES_AT,
    returnUrl: RETURN_URL,
  };

  test("posts the exact preference and returns the init point", async () => {
    const fetchWith = fakeFetch(jsonResponse({ id: "pref-1", init_point: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1" }, 201));

    const result = await getMercadoPagoClient(fetchWith)?.createCheckout(request);

    expect(result).toEqual({ redirectUrl: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1" });
    const [url, init] = vi.mocked(fetchWith).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/checkout/preferences");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      items: [{ id: ORDER_ID, title: request.title, quantity: 1, unit_price: 45000, currency_id: "ARS" }],
      external_reference: ORDER_ID,
      back_urls: { success: RETURN_URL, failure: RETURN_URL, pending: RETURN_URL },
      auto_return: "approved",
      statement_descriptor: "TALLAMI",
      payment_methods: { excluded_payment_types: [{ id: "ticket" }], installments: 1 },
      expires: true,
      expiration_date_to: "2026-11-04T13:00:00.000Z",
      payer: { email: "ana@example.com" },
    });
  });

  test("leaves the payer out without an email", async () => {
    const fetchWith = fakeFetch(jsonResponse({ init_point: "https://mp.example/x" }, 201));

    await getMercadoPagoClient(fetchWith)?.createCheckout({ ...request, payerEmail: null });

    const body = JSON.parse((vi.mocked(fetchWith).mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty("payer");
  });

  test("throws, without leaking the answer, when Mercado Pago refuses or does not answer well", async () => {
    const refused = fakeFetch(jsonResponse({ message: "secreto interno" }, 400));
    await expect(getMercadoPagoClient(refused)?.createCheckout(request)).rejects.toThrow(/400/);
    await expect(getMercadoPagoClient(refused)?.createCheckout(request)).rejects.not.toThrow(/secreto/);

    const noPoint = fakeFetch(jsonResponse({ id: "x" }, 201));
    await expect(getMercadoPagoClient(noPoint)?.createCheckout(request)).rejects.toThrow();

    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(getMercadoPagoClient(down)?.createCheckout(request)).rejects.toThrow();
  });
});

describe("fetchPayment", () => {
  async function statusOf(status: string, detail?: string): Promise<string | undefined> {
    const fetchWith = fakeFetch(jsonResponse(paymentBody({ status, status_detail: detail })));
    return (await getMercadoPagoClient(fetchWith)?.fetchPayment("123456789"))?.status;
  }

  test("gets the payment with the bearer token and normalizes it", async () => {
    const fetchWith = fakeFetch(jsonResponse(paymentBody()));

    const payment = await getMercadoPagoClient(fetchWith)?.fetchPayment("123456789");

    expect(payment).toEqual({
      providerPaymentId: "123456789",
      orderId: ORDER_ID,
      status: "approved",
      amountMinor: 4_500_000,
      currency: "ARS",
      approvedAt: new Date("2026-11-04T15:30:00.000Z"),
    });
    const [url, init] = vi.mocked(fetchWith).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/v1/payments/123456789");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  test("maps every Mercado Pago status", async () => {
    expect(await statusOf("approved", "accredited")).toBe("approved");
    expect(await statusOf("approved", "partially_refunded")).toBe("partially_refunded");
    expect(await statusOf("in_process")).toBe("pending");
    expect(await statusOf("authorized")).toBe("pending");
    expect(await statusOf("pending")).toBe("pending");
    for (const same of ["rejected", "cancelled", "refunded", "in_mediation", "charged_back"]) {
      expect(await statusOf(same), same).toBe(same);
    }
  });

  test("keeps an order reference and an approval date that are missing as null", async () => {
    const fetchWith = fakeFetch(
      jsonResponse(paymentBody({ status: "pending", external_reference: "", date_approved: null })),
    );

    const payment = await getMercadoPagoClient(fetchWith)?.fetchPayment("123456789");

    expect(payment).toMatchObject({ orderId: null, approvedAt: null });
  });

  test("returns null on 404 and for an id that is not a number, without asking", async () => {
    const missing = fakeFetch(jsonResponse({ message: "not found" }, 404));
    expect(await getMercadoPagoClient(missing)?.fetchPayment("1")).toBeNull();

    const never = fakeFetch(jsonResponse(paymentBody()));
    expect(await getMercadoPagoClient(never)?.fetchPayment("../1")).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });

  test("throws on a server error, on a down network and on a status it does not know", async () => {
    await expect(getMercadoPagoClient(fakeFetch(jsonResponse({}, 500)))?.fetchPayment("1")).rejects.toThrow(/500/);
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    await expect(getMercadoPagoClient(down)?.fetchPayment("1")).rejects.toThrow();
    await expect(
      getMercadoPagoClient(fakeFetch(jsonResponse(paymentBody({ status: "nuevo" }))))?.fetchPayment("1"),
    ).rejects.toThrow();
    await expect(
      getMercadoPagoClient(fakeFetch(jsonResponse(paymentBody({ transaction_amount: "x" }))))?.fetchPayment("1"),
    ).rejects.toThrow();
  });
});

describe("findPaymentForOrder", () => {
  test("searches by external reference, newest first, and returns the first", async () => {
    const fetchWith = fakeFetch(
      jsonResponse({
        results: [paymentBody({ id: 2, status: "approved" }), paymentBody({ id: 1, status: "rejected" })],
      }),
    );

    const payment = await getMercadoPagoClient(fetchWith)?.findPaymentForOrder(ORDER_ID);

    expect(payment).toMatchObject({ providerPaymentId: "2", status: "approved" });
    expect(vi.mocked(fetchWith).mock.calls[0][0]).toBe(
      `https://api.mercadopago.com/v1/payments/search?external_reference=${ORDER_ID}&sort=date_created&criteria=desc`,
    );
  });

  test("returns null without results and throws on a server error", async () => {
    expect(
      await getMercadoPagoClient(fakeFetch(jsonResponse({ results: [] })))?.findPaymentForOrder(ORDER_ID),
    ).toBeNull();
    await expect(
      getMercadoPagoClient(fakeFetch(jsonResponse({}, 503)))?.findPaymentForOrder(ORDER_ID),
    ).rejects.toThrow(/503/);
  });
});

describe("verifyWebhookSignature", () => {
  const SECRET = "secreto-del-aviso";
  const hashFor = (dataId: string, requestId = "abc", ts = "1700", secret = SECRET) =>
    createHmac("sha256", secret).update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest("hex");
  const input = (overrides: Record<string, unknown> = {}) => ({
    xSignature: `ts=1700,v1=${hashFor("123")}`,
    xRequestId: "abc",
    dataId: "123",
    secret: SECRET,
    ...overrides,
  });

  test("accepts the signature of the documented manifest", () => {
    expect(verifyWebhookSignature(input())).toBe(true);
  });

  test("rejects another hash, data id, request id, secret or ts", () => {
    expect(verifyWebhookSignature(input({ xSignature: `ts=1700,v1=${hashFor("999")}` }))).toBe(false);
    expect(verifyWebhookSignature(input({ dataId: "124" }))).toBe(false);
    expect(verifyWebhookSignature(input({ xRequestId: "otro" }))).toBe(false);
    expect(verifyWebhookSignature(input({ secret: "otro-secreto" }))).toBe(false);
    expect(verifyWebhookSignature(input({ xSignature: `ts=1701,v1=${hashFor("123")}` }))).toBe(false);
  });

  test("rejects a header without ts or v1, and nulls", () => {
    expect(verifyWebhookSignature(input({ xSignature: `v1=${hashFor("123")}` }))).toBe(false);
    expect(verifyWebhookSignature(input({ xSignature: "ts=1700" }))).toBe(false);
    expect(verifyWebhookSignature(input({ xSignature: null }))).toBe(false);
    expect(verifyWebhookSignature(input({ xRequestId: null }))).toBe(false);
    expect(verifyWebhookSignature(input({ dataId: null }))).toBe(false);
    expect(verifyWebhookSignature(input({ secret: "" }))).toBe(false);
  });

  test("rejects a hash of another length without throwing", () => {
    expect(verifyWebhookSignature(input({ xSignature: "ts=1700,v1=abcd" }))).toBe(false);
    expect(verifyWebhookSignature(input({ xSignature: `ts=1700,v1=${hashFor("123")}00` }))).toBe(false);
  });

  test("compares an alphanumeric data id in lowercase", () => {
    expect(
      verifyWebhookSignature(input({ xSignature: `ts=1700,v1=${hashFor("abc123")}`, dataId: "ABC123" })),
    ).toBe(true);
  });
});
