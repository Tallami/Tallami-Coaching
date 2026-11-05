import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import { orders, portalAccounts, sales } from "@/db/schema";
import { SITE_URL } from "@/lib/site-url";
import { getPaymentAvailability } from "@/payments/availability";
import { reconcileOrder, startCheckout } from "@/payments/checkout";
import { notifyPaymentOutcome } from "@/payments/emails";
import { cancelOrder, createOrder, hasUnconfirmedOrder, orderForAccount } from "@/payments/orders";
import { savePesosPerDollar } from "@/payments/pricing";
import type { PaymentProviderClient, ProviderPayment } from "@/payments/provider";
import { getAccount, type PortalAccount } from "@/portal/accounts";
import { createTestDb } from "../helpers/db";
import { insertTestOrder, testPayment } from "../helpers/orders";
import { insertTestAccount } from "../helpers/portal";

// El envío de verdad se prueba en `payments-emails.test.ts`: acá importa si se manda y cuándo.
vi.mock("@/payments/emails", () => ({ notifyPaymentOutcome: vi.fn(async () => undefined) }));

const NOW = new Date("2026-11-05T12:00:00.000-03:00");
const ONE_HOUR_LATER = new Date("2026-11-05T13:00:00.000-03:00");
const ORIGIN = "http://localhost:3100";
const CHECKOUT_URL = "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=1";
/** USD 30 a 1500 pesos por dólar: ARS 45.000, en centavos. */
const VOD_ARS_MINOR = 4_500_000;
const OTHER_ORDER = "00000000-0000-4000-8000-000000000000";

let db: Db;
let account: PortalAccount;

function stubReadyEnv(): void {
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-token");
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "clave-de-los-avisos");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("PUBLIC_EMAIL_FROM", "Tallami <pagos@tallami.example>");
  vi.stubEnv("VERCEL", "");
}

function fakeClient(overrides: Partial<PaymentProviderClient> = {}) {
  return {
    id: "mercadopago" as const,
    createCheckout: vi.fn<PaymentProviderClient["createCheckout"]>(async () => ({ redirectUrl: CHECKOUT_URL })),
    fetchPayment: vi.fn<PaymentProviderClient["fetchPayment"]>(async () => null),
    findPaymentForOrder: vi.fn<PaymentProviderClient["findPaymentForOrder"]>(async () => null),
    ...overrides,
  };
}

function checkout(client: PaymentProviderClient, overrides: Partial<Parameters<typeof startCheckout>[2]> = {}) {
  return startCheckout(
    db,
    client,
    {
      account,
      item: "vodRecorded",
      adultConfirmed: true,
      shownArsMinor: VOD_ARS_MINOR,
      linkToken: null,
      locale: "es",
      returnOrigin: ORIGIN,
      ...overrides,
    },
    NOW,
  );
}

async function allOrders() {
  return db.select().from(orders);
}

/** Lo que `createCheckout` recibió en su única llamada. */
function requestSentTo(client: PaymentProviderClient) {
  const { calls } = vi.mocked(client.createCheckout).mock;
  expect(calls).toHaveLength(1);
  return calls[0][0];
}

beforeEach(async () => {
  db = await createTestDb();
  stubReadyEnv();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.mocked(notifyPaymentOutcome).mockClear();
  await savePesosPerDollar(db, "1500");
  const id = await insertTestAccount(db, {
    provider: "discord",
    displayName: "Ana",
    email: "ana@example.com",
    providerHandle: "ana_fn",
  });
  account = (await getAccount(db, id)) as PortalAccount;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("startCheckout", () => {
  test("the 3-game VOD at 1500 creates the order with the prices of the server and goes to Mercado Pago", async () => {
    const client = fakeClient();

    const result = await checkout(client);

    expect(result).toEqual({ kind: "redirect", url: CHECKOUT_URL });
    const [order] = await allOrders();
    expect(order).toMatchObject({
      provider: "mercadopago",
      accountId: account.id,
      buyerName: "Ana",
      buyerEmail: "ana@example.com",
      buyerHandle: "ana_fn",
      item: "vodRecorded",
      amountUsdMinor: 3000,
      arsPerUsd: "1500.0000",
      amountArsMinor: 4_500_000,
      status: "created",
      locale: "es",
    });
    expect(order.adultConfirmedAt).toEqual(NOW);
    expect(order.expiresAt).toEqual(ONE_HOUR_LATER);
  });

  test("tells Mercado Pago the amount of the order, the buyer's email, when it expires and a title with the name of the service", async () => {
    const client = fakeClient();

    await checkout(client);

    const [order] = await allOrders();
    expect(requestSentTo(client)).toEqual({
      orderId: order.id,
      title: "Tallami Coaching: VOD review de 3 partidas",
      amountArsMinor: 4_500_000,
      payerEmail: "ana@example.com",
      expiresAt: ONE_HOUR_LATER,
      returnUrl: `${ORIGIN}/es/portal?compra=${order.id}`,
    });
  });

  test.each([
    ["tournamentReview", 9_000_000, 6000],
    ["vodLive", 6_750_000, 4500],
    ["gamePlan", 18_000_000, 12_000],
  ] as const)("%s costs what the list says, in pesos and dollars", async (item, ars, usd) => {
    await checkout(fakeClient(), { item, shownArsMinor: ars });

    expect((await allOrders())[0]).toMatchObject({ item, amountArsMinor: ars, amountUsdMinor: usd });
  });

  test("the title goes in the language of the buyer", async () => {
    const client = fakeClient();

    await checkout(client, { item: "tournamentReview", shownArsMinor: 9_000_000, locale: "pt" });

    expect(requestSentTo(client).title).toBe("Tallami Coaching: VOD review de torneio completo");
    expect((await allOrders())[0].locale).toBe("pt");
  });

  test("an account without a handle or an email leaves them empty, and the name of nobody else fills them", async () => {
    const id = await insertTestAccount(db, { provider: "google", displayName: "Sin datos", email: null });
    const client = fakeClient();

    await checkout(client, { account: (await getAccount(db, id)) as PortalAccount });

    expect((await allOrders())[0]).toMatchObject({ buyerName: "Sin datos", buyerEmail: null, buyerHandle: null });
    expect(requestSentTo(client).payerEmail).toBeNull();
  });

  test("without the box ticked: `adult`, no order and nothing sent to Mercado Pago", async () => {
    const client = fakeClient();

    const result = await checkout(client, { adultConfirmed: false });

    expect(result).toEqual({ kind: "error", reason: "adult" });
    expect(await allOrders()).toEqual([]);
    expect(client.createCheckout).not.toHaveBeenCalled();
  });

  test("an amount that is not the one of today: `price-changed`, no order and nothing sent to Mercado Pago", async () => {
    const client = fakeClient();

    const result = await checkout(client, { shownArsMinor: VOD_ARS_MINOR - 100 });

    expect(result).toEqual({ kind: "error", reason: "price-changed" });
    expect(await allOrders()).toEqual([]);
    expect(client.createCheckout).not.toHaveBeenCalled();
  });

  test("the rate changes with the screen open: the old amount is refused, and the new one charges the new rate", async () => {
    await savePesosPerDollar(db, "1600");
    const client = fakeClient();

    expect(await checkout(client)).toEqual({ kind: "error", reason: "price-changed" });
    expect(await allOrders()).toEqual([]);

    expect(await checkout(client, { shownArsMinor: 4_800_000 })).toEqual({ kind: "redirect", url: CHECKOUT_URL });
    expect((await allOrders())[0]).toMatchObject({ arsPerUsd: "1600.0000", amountArsMinor: 4_800_000 });
  });

  test("a rate with decimals rounds to the whole peso, with the rate saved as it was", async () => {
    await savePesosPerDollar(db, "1234,567");

    await checkout(fakeClient(), { shownArsMinor: 3_703_700 });

    expect((await allOrders())[0]).toMatchObject({ arsPerUsd: "1234.5670", amountArsMinor: 3_703_700 });
  });

  test.each([
    ["the access token", "MERCADOPAGO_ACCESS_TOKEN"],
    ["the secret of the notices", "MERCADOPAGO_WEBHOOK_SECRET"],
    ["the Resend key", "RESEND_API_KEY"],
    ["the sender", "PUBLIC_EMAIL_FROM"],
  ])("without %s: `unavailable` and no order", async (_label, name) => {
    vi.stubEnv(name, "");
    const client = fakeClient();

    expect(await checkout(client)).toEqual({ kind: "error", reason: "unavailable" });
    expect(await allOrders()).toEqual([]);
    expect(client.createCheckout).not.toHaveBeenCalled();
  });

  test("without a rate: `unavailable` and no order", async () => {
    const empty = await createTestDb();
    const id = await insertTestAccount(empty, { displayName: "Otra" });
    const client = fakeClient();

    const result = await startCheckout(
      empty,
      client,
      {
        account: (await getAccount(empty, id)) as PortalAccount,
        item: "vodRecorded",
        adultConfirmed: true,
        shownArsMinor: VOD_ARS_MINOR,
        linkToken: null,
        locale: "es",
        returnOrigin: ORIGIN,
      },
      NOW,
    );

    expect(result).toEqual({ kind: "error", reason: "unavailable" });
    expect(await empty.select().from(orders)).toEqual([]);
  });

  test("Mercado Pago fails: `provider`, the order stays cancelled, and it never throws or logs the details", async () => {
    const client = fakeClient({
      createCheckout: vi.fn(async () => {
        throw new TypeError("token TEST-secreto rechazado para ana@example.com");
      }),
    });

    const result = await checkout(client);

    expect(result).toEqual({ kind: "error", reason: "provider" });
    expect((await allOrders())[0].status).toBe("cancelled");
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toMatch(/TEST-secreto|ana@example/);
  });

  test("the database fails while cancelling that order: still `provider`, it never throws", async () => {
    const client = fakeClient({
      createCheckout: vi.fn(async () => {
        throw new Error("caído");
      }),
    });
    const brokenCancel = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "update") {
          return () => {
            throw new Error("se cayó la base");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const result = await startCheckout(
      brokenCancel,
      client,
      {
        account,
        item: "vodRecorded",
        adultConfirmed: true,
        shownArsMinor: VOD_ARS_MINOR,
        linkToken: null,
        locale: "es",
        returnOrigin: ORIGIN,
      },
      NOW,
    );

    expect(result).toEqual({ kind: "error", reason: "provider" });
  });

  test("two calls make two orders: each attempt has its own", async () => {
    const client = fakeClient();

    await checkout(client);
    await checkout(client);

    const rows = await allOrders();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(({ id }) => id)).size).toBe(2);
    expect(client.createCheckout).toHaveBeenCalledTimes(2);
  });

  test("on Vercel the return address is always the public site, whatever origin the request claims", async () => {
    vi.stubEnv("VERCEL", "1");
    const client = fakeClient();

    await checkout(client, { returnOrigin: "https://evil.example", locale: "en" });

    const [order] = await allOrders();
    expect(requestSentTo(client).returnUrl).toBe(`${SITE_URL}/en/portal?compra=${order.id}`);
  });

  test("Temporada Pro without a valid link: `link-invalid` and no order", async () => {
    const client = fakeClient();

    const result = await checkout(client, { item: "proSeason", shownArsMinor: 375_000_000, linkToken: null });

    expect(result).toEqual({ kind: "error", reason: "link-invalid" });
    expect(await allOrders()).toEqual([]);
  });
});

describe("getPaymentAvailability", () => {
  test("with credentials, rate and sender it can pay, and gives the rate", async () => {
    expect(await getPaymentAvailability(db)).toEqual({ canPay: true, rate: "1500.0000", missing: [] });
  });

  test("without a rate it cannot pay, and says that is what is missing", async () => {
    const empty = await createTestDb();

    expect(await getPaymentAvailability(empty)).toEqual({ canPay: false, rate: null, missing: ["rate"] });
  });

  test.each(["MERCADOPAGO_ACCESS_TOKEN", "MERCADOPAGO_WEBHOOK_SECRET"])("without %s, the credentials are missing", async (name) => {
    vi.stubEnv(name, "   ");

    expect(await getPaymentAvailability(db)).toEqual({ canPay: false, rate: "1500.0000", missing: ["credentials"] });
  });

  test.each([
    ["no sender", { PUBLIC_EMAIL_FROM: "" }],
    ["no Resend key", { RESEND_API_KEY: "" }],
    ["the test sender of Resend, which only reaches the owner of the account", { PUBLIC_EMAIL_FROM: "Tallami <onboarding@resend.dev>" }],
  ])("with %s, the sender is missing", async (_label, env) => {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);

    expect(await getPaymentAvailability(db)).toEqual({ canPay: false, rate: "1500.0000", missing: ["sender"] });
  });

  test("says everything that is missing at once", async () => {
    const empty = await createTestDb();
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "");
    vi.stubEnv("PUBLIC_EMAIL_FROM", "");

    expect(await getPaymentAvailability(empty)).toEqual({
      canPay: false,
      rate: null,
      missing: ["credentials", "rate", "sender"],
    });
  });
});

describe("orders", () => {
  test("createOrder saves what it gets and returns the row", async () => {
    const order = await createOrder(db, {
      provider: "mercadopago",
      accountId: account.id,
      buyerName: "Ana",
      item: "gamePlan",
      amountUsdMinor: 12_000,
      arsPerUsd: "1500.0000",
      amountArsMinor: 18_000_000,
      adultConfirmedAt: NOW,
      locale: "pt",
      expiresAt: ONE_HOUR_LATER,
    });

    expect(order.id).toBeTruthy();
    expect((await allOrders())[0]).toEqual(order);
  });

  test("orderForAccount gives the order only to the account that made it", async () => {
    const order = await insertTestOrder(db, { accountId: account.id });
    const other = await insertTestAccount(db);

    expect((await orderForAccount(db, order.id, account.id))?.id).toBe(order.id);
    expect(await orderForAccount(db, order.id, other)).toBeNull();
  });

  test("orderForAccount gives nothing for an order nobody knows, or for something that is not an id", async () => {
    expect(await orderForAccount(db, OTHER_ORDER, account.id)).toBeNull();
    expect(await orderForAccount(db, "no-es-un-id", account.id)).toBeNull();
  });

  test("an order whose account was deleted belongs to nobody", async () => {
    const order = await insertTestOrder(db, { accountId: account.id });
    await db.delete(portalAccounts).where(eq(portalAccounts.id, account.id));

    expect(await orderForAccount(db, order.id, account.id)).toBeNull();
  });

  test("cancelOrder cancels an order that has no payment yet", async () => {
    const order = await insertTestOrder(db);

    await cancelOrder(db, order.id);

    expect((await allOrders())[0].status).toBe("cancelled");
  });

  test.each(["pending", "approved", "refunded"] as const)("cancelOrder leaves an order that is %s as it was", async (status) => {
    const order = await insertTestOrder(db, { status });

    await cancelOrder(db, order.id);

    expect((await allOrders())[0].status).toBe(status);
  });

  describe("hasUnconfirmedOrder", () => {
    const unconfirmed = () => hasUnconfirmedOrder(db, account.id, NOW);

    test("an account with no orders has none", async () => {
      expect(await unconfirmed()).toBe(false);
    });

    test("a payment in course counts, even after the hour of the order", async () => {
      await insertTestOrder(db, { accountId: account.id, status: "pending", expiresAt: new Date(NOW.getTime() - 1000) });

      expect(await unconfirmed()).toBe(true);
    });

    test("an order armed within the hour counts; one that expired does not", async () => {
      await insertTestOrder(db, { accountId: account.id, status: "created", expiresAt: new Date(NOW.getTime() - 1000) });
      expect(await unconfirmed()).toBe(false);

      await insertTestOrder(db, { accountId: account.id, status: "created", expiresAt: ONE_HOUR_LATER });
      expect(await unconfirmed()).toBe(true);
    });

    test.each(["approved", "rejected", "cancelled", "refunded", "charged_back"] as const)("an order that is %s does not", async (status) => {
      await insertTestOrder(db, { accountId: account.id, status, expiresAt: ONE_HOUR_LATER });

      expect(await unconfirmed()).toBe(false);
    });

    test("the order of another account does not", async () => {
      await insertTestOrder(db, { accountId: await insertTestAccount(db), status: "pending" });

      expect(await unconfirmed()).toBe(false);
    });
  });
});

describe("reconcileOrder", () => {
  async function orderOfAccount() {
    return insertTestOrder(db, { accountId: account.id });
  }

  async function orderRow(id: string) {
    const [row] = await db.select().from(orders).where(eq(orders.id, id));
    return row;
  }

  function paying(payment: ProviderPayment | null) {
    return fakeClient({ fetchPayment: vi.fn(async () => payment), findPaymentForOrder: vi.fn(async () => payment) });
  }

  test("looks up the payment of the address and applies it with the same steps as the notice: the sale exists and the emails go out", async () => {
    const order = await orderOfAccount();
    const client = paying(testPayment(order.id));

    await reconcileOrder(db, client, order, "123456789", NOW);

    expect(client.fetchPayment).toHaveBeenCalledWith("123456789");
    expect(await orderRow(order.id)).toMatchObject({ status: "approved", providerPaymentId: "123456789" });
    expect(await db.select().from(sales)).toHaveLength(1);
    expect(notifyPaymentOutcome).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyPaymentOutcome).mock.calls[0][1]).toMatchObject({ kind: "sale-created", orderId: order.id });
  });

  test("without a payment in the address, it searches for the payment of the order", async () => {
    const order = await orderOfAccount();
    const client = paying(testPayment(order.id));

    await reconcileOrder(db, client, order, null, NOW);

    expect(client.fetchPayment).not.toHaveBeenCalled();
    expect(client.findPaymentForOrder).toHaveBeenCalledWith(order.id);
    expect((await orderRow(order.id)).status).toBe("approved");
  });

  test("a payment id in the address that belongs to another order is not applied to anything, not even to that order", async () => {
    const order = await orderOfAccount();
    const stranger = await insertTestOrder(db);
    const client = fakeClient({
      fetchPayment: vi.fn(async () => testPayment(stranger.id)),
      findPaymentForOrder: vi.fn(async () => null),
    });

    await reconcileOrder(db, client, order, "123456789", NOW);

    expect((await orderRow(stranger.id)).status).toBe("created");
    expect((await orderRow(order.id)).status).toBe("created");
    expect(await db.select().from(sales)).toEqual([]);
    expect(client.findPaymentForOrder).toHaveBeenCalledWith(order.id);
    expect(notifyPaymentOutcome).not.toHaveBeenCalled();
  });

  test("a payment id in the address that Mercado Pago does not know: it searches by order instead", async () => {
    const order = await orderOfAccount();
    const client = fakeClient({
      fetchPayment: vi.fn(async () => null),
      findPaymentForOrder: vi.fn(async () => testPayment(order.id)),
    });

    await reconcileOrder(db, client, order, "999", NOW);

    expect((await orderRow(order.id)).status).toBe("approved");
  });

  test("with no payment yet nothing changes and nothing is sent", async () => {
    const order = await orderOfAccount();

    await reconcileOrder(db, paying(null), order, null, NOW);

    expect((await orderRow(order.id)).status).toBe("created");
    expect(notifyPaymentOutcome).not.toHaveBeenCalled();
  });

  test("a rejected payment leaves the order rejected, without a sale", async () => {
    const order = await orderOfAccount();

    await reconcileOrder(db, paying(testPayment(order.id, { status: "rejected", approvedAt: null })), order, "123456789", NOW);

    expect((await orderRow(order.id)).status).toBe("rejected");
    expect(await db.select().from(sales)).toEqual([]);
  });

  test("an order that was already rejected still looks: the buyer may have retried and paid", async () => {
    const order = await insertTestOrder(db, { accountId: account.id, status: "rejected", providerPaymentId: "111" });
    const client = paying(testPayment(order.id, { providerPaymentId: "222" }));

    await reconcileOrder(db, client, order, "222", NOW);

    expect(await orderRow(order.id)).toMatchObject({ status: "approved", providerPaymentId: "222" });
  });

  test("an order that already went through is not looked up again, so a repeated return makes a single sale", async () => {
    const order = await orderOfAccount();
    const client = paying(testPayment(order.id));

    await reconcileOrder(db, client, order, "123456789", NOW);
    await reconcileOrder(db, client, await orderRow(order.id), "123456789", NOW);

    expect(client.fetchPayment).toHaveBeenCalledTimes(1);
    expect(await db.select().from(sales)).toHaveLength(1);
    expect(notifyPaymentOutcome).toHaveBeenCalledTimes(1);
  });

  test("a stale copy of the order, read before the notice arrived, also makes a single sale and no second email", async () => {
    const stale = await orderOfAccount();
    const client = paying(testPayment(stale.id));

    await reconcileOrder(db, client, stale, "123456789", NOW);
    vi.mocked(notifyPaymentOutcome).mockClear();
    await reconcileOrder(db, client, stale, "123456789", NOW);

    expect(await db.select().from(sales)).toHaveLength(1);
    expect(vi.mocked(notifyPaymentOutcome).mock.calls[0][1]).toEqual({ kind: "no-change", orderId: stale.id });
  });

  test("the page can leave the emails for after the response: they do not go out until the task runs", async () => {
    const order = await orderOfAccount();
    const tasks: (() => Promise<void>)[] = [];

    await reconcileOrder(db, paying(testPayment(order.id)), order, "123456789", NOW, (task) => tasks.push(task));

    expect((await orderRow(order.id)).status).toBe("approved");
    expect(notifyPaymentOutcome).not.toHaveBeenCalled();
    expect(tasks).toHaveLength(1);
    await tasks[0]();
    expect(notifyPaymentOutcome).toHaveBeenCalledTimes(1);
  });

  test("Mercado Pago fails: it never throws, the order stays as it was and only the type of error is logged", async () => {
    const order = await orderOfAccount();
    const client = fakeClient({
      findPaymentForOrder: vi.fn(async () => {
        throw new TypeError("token TEST-secreto rechazado");
      }),
    });

    await expect(reconcileOrder(db, client, order, null, NOW)).resolves.toBeUndefined();

    expect((await orderRow(order.id)).status).toBe("created");
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("TEST-secreto");
  });

  test("the database fails while applying: it never throws", async () => {
    const order = await orderOfAccount();
    const brokenApply = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return () => {
            throw new Error("postgres://usuario:clave@host/base no responde");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(reconcileOrder(brokenApply, paying(testPayment(order.id)), order, null, NOW)).resolves.toBeUndefined();

    expect(vi.mocked(console.error).mock.calls.flat().map(String).join(" ")).not.toContain("clave@host");
  });
});
