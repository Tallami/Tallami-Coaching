import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import { orders, proApplications, proPaymentLinks, sales } from "@/db/schema";
import { SITE_URL } from "@/lib/site-url";
import { applyProviderPayment } from "@/payments/apply";
import { startCheckout } from "@/payments/checkout";
import { PRO_LINK_TTL_MS } from "@/payments/policy";
import { savePesosPerDollar } from "@/payments/pricing";
import type { PaymentProviderClient } from "@/payments/provider";
import {
  collectedForApplication,
  createProPaymentLink,
  markProPaymentLinkPaid,
  proPaymentLinkUrl,
  readProPaymentLink,
} from "@/pro/payment-links";
import type { PortalAccount } from "@/portal/accounts";
import { getAccount } from "@/portal/accounts";
import { createTestDb } from "../helpers/db";
import { insertTestOrder, testPayment } from "../helpers/orders";
import { insertTestAccount } from "../helpers/portal";

vi.mock("@/payments/emails", () => ({ notifyPaymentOutcome: vi.fn(async () => undefined) }));

const NOW = new Date("2026-11-05T12:00:00.000-03:00");
const DAY_MS = 24 * 60 * 60 * 1000;
const URL_SAFE_32_BYTES = /^[A-Za-z0-9_-]{43}$/;

let db: Db;
let applicationId: string;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

beforeEach(async () => {
  db = await createTestDb();
  const [application] = await db
    .insert(proApplications)
    .values({ name: "Equipo", discord: "d", teamMembers: "t", results: "r", locale: "es" })
    .returning({ id: proApplications.id });
  applicationId = application.id;
});

describe("createProPaymentLink / readProPaymentLink", () => {
  test("returns a token of 32 random bytes in base64url, different every time", async () => {
    const first = await createProPaymentLink(db, applicationId, 100_000, NOW);
    const second = await createProPaymentLink(db, applicationId, 100_000, NOW);

    expect(first).toMatch(URL_SAFE_32_BYTES);
    expect(second).toMatch(URL_SAFE_32_BYTES);
    expect(second).not.toBe(first);
  });

  test("the database never has the token in the clear, only its SHA-256", async () => {
    const token = await createProPaymentLink(db, applicationId, 100_000, NOW);

    const [row] = await db.select().from(proPaymentLinks);
    expect(row.tokenHash).toBe(sha256Hex(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt).toEqual(new Date(NOW.getTime() + PRO_LINK_TTL_MS));
    expect(row.paidAt).toBeNull();
  });

  test("reads the link while it is valid: 13 days yes, exactly 14 days no", async () => {
    const token = await createProPaymentLink(db, applicationId, 150_000, NOW);

    expect(await readProPaymentLink(db, token, new Date(NOW.getTime() + 13 * DAY_MS))).toEqual({
      id: expect.any(String),
      amountUsdMinor: 150_000,
    });
    expect(await readProPaymentLink(db, token, new Date(NOW.getTime() + 14 * DAY_MS))).toBeNull();
  });

  test("marking a link says whether it marked it: the first time yes, the second no, and the first date stays", async () => {
    const token = await createProPaymentLink(db, applicationId, 100_000, NOW);
    const link = await readProPaymentLink(db, token, NOW);
    const later = new Date(NOW.getTime() + DAY_MS);

    expect(await db.transaction((tx) => markProPaymentLinkPaid(tx, link!.id, NOW))).toBe(true);
    expect(await db.transaction((tx) => markProPaymentLinkPaid(tx, link!.id, later))).toBe(false);

    const [row] = await db.select().from(proPaymentLinks);
    expect(row.paidAt).toEqual(NOW);
  });

  test("a paid link, an unknown token and garbage read as null", async () => {
    const token = await createProPaymentLink(db, applicationId, 100_000, NOW);
    const link = await readProPaymentLink(db, token, NOW);
    await db.transaction((tx) => markProPaymentLinkPaid(tx, link!.id, NOW));

    expect(await readProPaymentLink(db, token, NOW)).toBeNull();
    expect(await readProPaymentLink(db, "x".repeat(43), NOW)).toBeNull();
    expect(await readProPaymentLink(db, "", NOW)).toBeNull();
  });

  test.each([0, -100, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects the amount %s", async (amount) => {
    await expect(createProPaymentLink(db, applicationId, amount, NOW)).rejects.toThrow();
    expect(await db.select().from(proPaymentLinks)).toEqual([]);
  });

  test("several links of one application live together", async () => {
    const first = await createProPaymentLink(db, applicationId, 100_000, NOW);
    const second = await createProPaymentLink(db, applicationId, 150_000, NOW);

    expect((await readProPaymentLink(db, first, NOW))?.amountUsdMinor).toBe(100_000);
    expect((await readProPaymentLink(db, second, NOW))?.amountUsdMinor).toBe(150_000);
  });

  test("the address of the link is the purchase screen of Temporada Pro, in the language asked", () => {
    expect(proPaymentLinkUrl("abc", "pt")).toBe(`${SITE_URL}/pt/comprar/temporada-pro?link=abc`);
  });
});

describe("paying a link", () => {
  let account: PortalAccount;

  function fakeClient(): PaymentProviderClient {
    return {
      id: "mercadopago",
      createCheckout: vi.fn(async () => ({ redirectUrl: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=1" })),
      fetchPayment: vi.fn(async () => null),
      findPaymentForOrder: vi.fn(async () => null),
    };
  }

  function checkout(client: PaymentProviderClient, linkToken: string | null, shownArsMinor: number) {
    return startCheckout(
      db,
      client,
      { account, item: "proSeason", adultConfirmed: true, shownArsMinor, linkToken, locale: "es", returnOrigin: "http://localhost:3100" },
      NOW,
    );
  }

  beforeEach(async () => {
    vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-token");
    vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "clave");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("PUBLIC_EMAIL_FROM", "Tallami <pagos@tallami.example>");
    vi.stubEnv("ADMIN_ALERT_EMAIL", "avisos@example.test");
    vi.stubEnv("PORTAL_SESSION_SECRET", "secreto-del-portal-de-los-tests-0123456789");
    vi.stubEnv("DISCORD_CLIENT_ID", "id-de-discord");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secreto-de-discord");
    vi.stubEnv("VERCEL", "");
    await savePesosPerDollar(db, "1500");
    account = (await getAccount(db, await insertTestAccount(db)))!;
  });

  test("`proSeason` without a link, with garbage or with an unknown token is `link-invalid`, and makes no order", async () => {
    const client = fakeClient();

    for (const token of [null, "corto", "x".repeat(43)]) {
      expect(await checkout(client, token, 150_000_000)).toEqual({ kind: "error", reason: "link-invalid" });
    }
    expect(await db.select().from(orders)).toEqual([]);
    expect(client.createCheckout).not.toHaveBeenCalled();
  });

  test("a valid link charges the amount of the link, in pesos, and ties the order to the link", async () => {
    const token = await createProPaymentLink(db, applicationId, 100_000, NOW);
    const client = fakeClient();

    // USD 1.000 a 1500: ARS 1.500.000, en centavos.
    const result = await checkout(client, token, 150_000_000);

    expect(result.kind).toBe("redirect");
    const [order] = await db.select().from(orders);
    const [link] = await db.select().from(proPaymentLinks);
    expect(order).toMatchObject({ item: "proSeason", amountUsdMinor: 100_000, amountArsMinor: 150_000_000, proPaymentLinkId: link.id });
    expect(vi.mocked(client.createCheckout).mock.calls[0][0]).toMatchObject({ amountArsMinor: 150_000_000 });
  });

  test("a different amount shown than the one of the link is `price-changed`", async () => {
    const token = await createProPaymentLink(db, applicationId, 100_000, NOW);

    expect(await checkout(fakeClient(), token, 375_000_000)).toEqual({ kind: "error", reason: "price-changed" });
  });

  test("an expired link is `link-invalid`", async () => {
    const token = await createProPaymentLink(db, applicationId, 100_000, new Date(NOW.getTime() - 14 * DAY_MS));

    expect(await checkout(fakeClient(), token, 150_000_000)).toEqual({ kind: "error", reason: "link-invalid" });
  });

  test("an approved order marks only its own link and makes a `proSeason` sale for the amount of the link", async () => {
    const first = await createProPaymentLink(db, applicationId, 100_000, NOW);
    const second = await createProPaymentLink(db, applicationId, 150_000, NOW);
    await checkout(fakeClient(), first, 150_000_000);
    const [order] = await db.select().from(orders);

    const outcome = await applyProviderPayment(
      db,
      "mercadopago",
      testPayment(order.id, { amountMinor: order.amountArsMinor }),
      NOW,
    );

    expect(outcome.kind).toBe("sale-created");
    const links = await db.select().from(proPaymentLinks);
    const paid = links.filter(({ paidAt }) => paidAt !== null);
    expect(paid).toHaveLength(1);
    expect(paid[0].amountUsdMinor).toBe(100_000);
    expect(paid[0].paidAt).toEqual(NOW);
    expect(await readProPaymentLink(db, first, NOW)).toBeNull();
    expect(await readProPaymentLink(db, second, NOW)).not.toBeNull();
    const [sale] = await db.select().from(sales);
    expect(sale).toMatchObject({ item: "proSeason", amountUsdMinor: 100_000 });
  });

  test("an unpaid order does not use the link", async () => {
    const token = await createProPaymentLink(db, applicationId, 100_000, NOW);
    await checkout(fakeClient(), token, 150_000_000);
    const [order] = await db.select().from(orders);

    await applyProviderPayment(db, "mercadopago", testPayment(order.id, { amountMinor: order.amountArsMinor, status: "rejected" }), NOW);

    expect(await readProPaymentLink(db, token, NOW)).not.toBeNull();
  });

  /** Dos pedidos armados con el mismo link, antes de que se pague ninguno: el link no bloquea el segundo. */
  async function twoOrdersOnOneLink() {
    const token = await createProPaymentLink(db, applicationId, 100_000, NOW);
    await checkout(fakeClient(), token, 150_000_000);
    await checkout(fakeClient(), token, 150_000_000);
    const [first, second] = await db.select().from(orders);
    return { token, first, second };
  }

  function pay(order: { id: string; amountArsMinor: number }, overrides: Parameters<typeof testPayment>[1] = {}) {
    return applyProviderPayment(db, "mercadopago", testPayment(order.id, { amountMinor: order.amountArsMinor, ...overrides }), NOW);
  }

  test("a link paid by two people makes two sales, and the second outcome says the link was already paid", async () => {
    const { first, second } = await twoOrdersOnOneLink();

    const one = await pay(first, { providerPaymentId: "111" });
    const two = await pay(second, { providerPaymentId: "222" });

    expect(one).toEqual({ kind: "sale-created", orderId: first.id, saleId: expect.any(String), status: "paid" });
    expect(two).toEqual({ kind: "sale-created", orderId: second.id, saleId: expect.any(String), status: "paid", linkAlreadyPaid: true });
    expect(await db.select().from(sales)).toHaveLength(2);
  });

  test("the same approval twice is not a second payment of the link", async () => {
    const { first } = await twoOrdersOnOneLink();

    await pay(first);

    expect(await pay(first)).toEqual({ kind: "no-change", orderId: first.id });
  });

  test.each(["refunded", "charged_back", "partially_refunded", "in_mediation"] as const)(
    "a payment that took money (%s) before its approval arrived also uses the link",
    async (status) => {
      const { token, first, second } = await twoOrdersOnOneLink();

      await pay(first, { status });

      expect(await readProPaymentLink(db, token, NOW)).toBeNull();
      const outcome = await pay(second, { providerPaymentId: "222" });
      expect(outcome).toMatchObject({ kind: "sale-created", linkAlreadyPaid: true });
    },
  );

  test.each(["rejected", "cancelled", "pending"] as const)("a %s payment leaves the link usable", async (status) => {
    const { token, first } = await twoOrdersOnOneLink();

    await pay(first, { status, approvedAt: null });

    expect(await readProPaymentLink(db, token, NOW)).not.toBeNull();
  });

  test("an order without a link leaves the links alone", async () => {
    const token = await createProPaymentLink(db, applicationId, 100_000, NOW);
    const order = await insertTestOrder(db);

    await applyProviderPayment(db, "mercadopago", testPayment(order.id), NOW);

    expect(await readProPaymentLink(db, token, NOW)).not.toBeNull();
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe("approved");
  });
});

describe("collectedForApplication", () => {
  async function linkSale(status: "paid" | "delivered" | "refunded" | "cancelled" | "pending", amountUsdMinor: number, application = applicationId) {
    const token = await createProPaymentLink(db, application, amountUsdMinor, NOW);
    const link = await readProPaymentLink(db, token, NOW);
    const order = await insertTestOrder(db, { item: "proSeason", amountUsdMinor, proPaymentLinkId: link!.id });
    const outcome = await applyProviderPayment(db, "mercadopago", testPayment(order.id, { providerPaymentId: order.id }), NOW);
    if (outcome.kind !== "sale-created") throw new Error("Sin venta.");
    await db.update(sales).set({ status }).where(eq(sales.id, outcome.saleId));
    return { link, order };
  }

  test("without sales it is zero", async () => {
    expect(await collectedForApplication(db, applicationId)).toBe(0);
  });

  test("adds the sales of its link orders that count as income, in dollar cents", async () => {
    await linkSale("paid", 100_000);
    await linkSale("delivered", 150_000);
    await linkSale("refunded", 70_000);
    await linkSale("cancelled", 30_000);

    expect(await collectedForApplication(db, applicationId)).toBe(250_000);
  });

  test("two payments on one link count twice, and a refund drops out", async () => {
    const { link } = await linkSale("paid", 250_000);
    const again = await insertTestOrder(db, { item: "proSeason", amountUsdMinor: 250_000, proPaymentLinkId: link!.id });
    const outcome = await applyProviderPayment(db, "mercadopago", testPayment(again.id, { providerPaymentId: again.id }), NOW);
    if (outcome.kind !== "sale-created") throw new Error("Sin venta.");

    expect(await collectedForApplication(db, applicationId)).toBe(500_000);

    await db.update(sales).set({ status: "refunded" }).where(eq(sales.id, outcome.saleId));
    expect(await collectedForApplication(db, applicationId)).toBe(250_000);
  });

  test("another application's sales do not count", async () => {
    const [other] = await db
      .insert(proApplications)
      .values({ name: "Otro", discord: "d", teamMembers: "t", results: "r", locale: "es" })
      .returning({ id: proApplications.id });
    await linkSale("paid", 100_000, other.id);

    expect(await collectedForApplication(db, applicationId)).toBe(0);
    expect(await collectedForApplication(db, other.id)).toBe(100_000);
  });
});
