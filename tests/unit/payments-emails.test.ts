import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import { getPublicEmailSetup, sendPublicEmail, sendTallamiEmail, type EmailMessage } from "@/email/send";
import { SITE_URL } from "@/lib/site-url";
import { applyProviderPayment, type ApplyOutcome } from "@/payments/apply";
import { notifyPaymentOutcome } from "@/payments/emails";
import { createTestDb } from "../helpers/db";
import { insertTestOrder, testPayment, type TestOrder } from "../helpers/orders";

const TALLAMI_EMAIL = "tallami-privado@example.com";
const BUYER_EMAIL = "ana@example.com";
const ALERT_FROM = "Panel <onboarding@resend.dev>";
const PUBLIC_FROM = "Tallami <hola@tallami.example>";
const NOW = new Date("2026-11-05T12:00:00.000-03:00");
const MESSAGE: EmailMessage = { to: BUYER_EMAIL, subject: "Asunto", text: "Texto" };

type Sent = EmailMessage & { from: string };

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  vi.stubEnv("RESEND_API_KEY", "re_clave_de_prueba");
  vi.stubEnv("ADMIN_ALERT_EMAIL", TALLAMI_EMAIL);
  vi.stubEnv("ADMIN_ALERT_FROM", ALERT_FROM);
  vi.stubEnv("PUBLIC_EMAIL_FROM", PUBLIC_FROM);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function recorder() {
  const sent: Sent[] = [];
  const transport = vi.fn(async (message: Sent) => void sent.push(message));
  return { sent, transport };
}

function loggedText(): string {
  return vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
}

async function notify(order: TestOrder, outcome: ApplyOutcome) {
  const { sent, transport } = recorder();
  await notifyPaymentOutcome(db, outcome, { transport });
  return {
    sent,
    toTallami: sent.filter((message) => message.to === TALLAMI_EMAIL),
    toBuyer: sent.filter((message) => message.to === order.buyerEmail),
  };
}

/** Aplica el pago de verdad, para que el aviso se arme con lo que quedó en la base. */
function outcomeOf(order: TestOrder, overrides: Parameters<typeof testPayment>[1]): Promise<ApplyOutcome> {
  return applyProviderPayment(db, "mercadopago", testPayment(order.id, overrides), NOW);
}

describe("getPublicEmailSetup", () => {
  test("without a key it is missing", () => {
    vi.stubEnv("RESEND_API_KEY", "");

    expect(getPublicEmailSetup()).toEqual({ kind: "missing" });
  });

  test("without a sender it is missing", () => {
    vi.stubEnv("PUBLIC_EMAIL_FROM", "  ");

    expect(getPublicEmailSetup()).toEqual({ kind: "missing" });
  });

  test.each(["onboarding@resend.dev", "Tallami <onboarding@resend.dev>", "Tallami <ONBOARDING@RESEND.DEV>"])(
    "the test sender of Resend (%s) is not enough: it only delivers to the owner of the account",
    (from) => {
      vi.stubEnv("PUBLIC_EMAIL_FROM", from);

      expect(getPublicEmailSetup()).toEqual({ kind: "test-sender" });
    },
  );

  test("a sender of an own domain is ready", () => {
    expect(getPublicEmailSetup()).toEqual({ kind: "ready", apiKey: "re_clave_de_prueba", from: PUBLIC_FROM });
  });
});

describe("sendPublicEmail", () => {
  test("sends from the public sender and says it went out", async () => {
    const { sent, transport } = recorder();

    await expect(sendPublicEmail(MESSAGE, { transport })).resolves.toBe(true);

    expect(sent).toEqual([{ ...MESSAGE, from: PUBLIC_FROM }]);
  });

  test.each([
    ["no key", "RESEND_API_KEY", ""],
    ["no sender", "PUBLIC_EMAIL_FROM", ""],
    ["the test sender", "PUBLIC_EMAIL_FROM", "onboarding@resend.dev"],
  ])("with %s it does not try, says false and leaves a line in the log", async (_name, variable, value) => {
    vi.stubEnv(variable, value);
    const { transport } = recorder();

    await expect(sendPublicEmail(MESSAGE, { transport })).resolves.toBe(false);

    expect(transport).not.toHaveBeenCalled();
    expect(loggedText().length).toBeGreaterThan(0);
    expect(loggedText()).not.toContain(BUYER_EMAIL);
  });

  test("a transport that throws is a false, and the log has no personal data", async () => {
    const transport = vi.fn(async () => {
      throw new Error(`Rechazado para ${BUYER_EMAIL} con la clave re_clave_de_prueba`);
    });

    await expect(sendPublicEmail(MESSAGE, { transport })).resolves.toBe(false);

    expect(loggedText().length).toBeGreaterThan(0);
    expect(loggedText()).not.toContain(BUYER_EMAIL);
    expect(loggedText()).not.toContain("re_clave_de_prueba");
    expect(loggedText()).not.toContain("Asunto");
  });
});

describe("sendTallamiEmail", () => {
  test("goes to ADMIN_ALERT_EMAIL, from the sender of the alerts", async () => {
    const { sent, transport } = recorder();

    await expect(sendTallamiEmail({ subject: "S", text: "T" }, { transport })).resolves.toBe(true);

    expect(sent).toEqual([{ subject: "S", text: "T", to: TALLAMI_EMAIL, from: ALERT_FROM }]);
  });

  test("works with the test sender of Resend: it reaches the owner of the account, who is Tallami", async () => {
    vi.stubEnv("PUBLIC_EMAIL_FROM", "");
    vi.stubEnv("ADMIN_ALERT_FROM", "");
    const { sent, transport } = recorder();

    await expect(sendTallamiEmail({ subject: "S", text: "T" }, { transport })).resolves.toBe(true);

    expect(sent[0].from).toContain("@resend.dev");
  });

  test.each([
    ["no destination", "ADMIN_ALERT_EMAIL", ""],
    ["a destination that is not an address", "ADMIN_ALERT_EMAIL", "no-es-un-email"],
    ["no key", "RESEND_API_KEY", ""],
  ])("with %s it does not try and says false", async (_name, variable, value) => {
    vi.stubEnv(variable, value);
    const { transport } = recorder();

    await expect(sendTallamiEmail({ subject: "S", text: "T" }, { transport })).resolves.toBe(false);

    expect(transport).not.toHaveBeenCalled();
    expect(loggedText()).not.toContain("no-es-un-email");
  });

  test("a transport that throws is a false, and the log has no address", async () => {
    const transport = vi.fn(async () => {
      throw new Error(`Rechazado para ${TALLAMI_EMAIL}`);
    });

    await expect(sendTallamiEmail({ subject: "S", text: "T" }, { transport })).resolves.toBe(false);

    expect(loggedText()).not.toContain(TALLAMI_EMAIL);
  });
});

describe("notifyPaymentOutcome: a new sale", () => {
  test("tells Tallami who, what, pesos, dollars and the link to the sale", async () => {
    const order = await insertTestOrder(db);
    const outcome = await outcomeOf(order, {});
    if (outcome.kind !== "sale-created") throw new Error("Sin venta.");

    const { toTallami } = await notify(order, outcome);

    expect(toTallami).toHaveLength(1);
    const [email] = toTallami;
    expect(email.from).toBe(ALERT_FROM);
    expect(email.subject).toContain("VOD review de 3 partidas");
    expect(email.text).toContain("Ana Compradora");
    expect(email.text).toContain("ana_fn");
    expect(email.text).toContain(BUYER_EMAIL);
    expect(email.text).toContain("VOD review de 3 partidas");
    expect(email.text).toContain("$ 45.000,00");
    expect(email.text).toContain("USD 30,00");
    expect(email.text).toContain(`${SITE_URL}/admin/ventas/${outcome.saleId}`);
  });

  test.each([
    ["es", "VOD review de 3 partidas", "ARS 45.000", /confirmado/, /Tenés 10 días/],
    ["pt", "VOD review de 3 partidas", "ARS 45.000", /confirmado/, /Você tem 10 dias/],
    ["en", "3-game VOD review", "ARS 45,000", /confirmed/, /You have 10 days/],
  ])("tells the buyer in the language of the order (%s)", async (locale, service, amount, confirmed, refund) => {
    const order = await insertTestOrder(db, { locale });

    const { toBuyer } = await notify(order, await outcomeOf(order, {}));

    expect(toBuyer).toHaveLength(1);
    const [email] = toBuyer;
    expect(email.from).toBe(PUBLIC_FROM);
    expect(email.subject).toContain(service);
    expect(email.subject).toMatch(confirmed);
    expect(email.text).toContain(service);
    expect(email.text).toContain(amount);
    expect(email.text).toContain("TALLAMI");
    expect(email.text).toContain(`${SITE_URL}/${locale}/portal`);
    expect(email.text).toMatch(refund);
  });

  test("no text for the buyer has the address of Tallami, or says that there are no refunds", async () => {
    for (const locale of ["es", "pt", "en"]) {
      const order = await insertTestOrder(db, { locale });
      const { toBuyer } = await notify(order, await outcomeOf(order, { providerPaymentId: `pago-${locale}` }));

      expect(toBuyer).toHaveLength(1);
      const written = `${toBuyer[0].subject} ${toBuyer[0].text} ${toBuyer[0].from}`;
      expect(written).not.toContain(TALLAMI_EMAIL);
      expect(written).not.toMatch(/sin reembolsos?|sem reembolsos?|no refunds?|non-refundable/i);
    }
  });

  test("without an email of the buyer it only goes to Tallami", async () => {
    const order = await insertTestOrder(db, { buyerEmail: null });

    const { sent, toTallami } = await notify(order, await outcomeOf(order, {}));

    expect(toTallami).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  test("a sale born refunded only goes to Tallami, and says so: nobody confirms a purchase already returned", async () => {
    const order = await insertTestOrder(db);

    const { sent, toTallami } = await notify(order, await outcomeOf(order, { status: "refunded" }));

    expect(sent).toHaveLength(1);
    expect(toTallami[0].text).toMatch(/reembolsada/i);
    expect(toTallami[0].text).toContain("Ana Compradora");
  });

  test("the buyer still gets it when the email to Tallami fails, and the other way around", async () => {
    const order = await insertTestOrder(db);
    const outcome = await outcomeOf(order, {});
    const attempted: string[] = [];

    await notifyPaymentOutcome(db, outcome, {
      transport: async (message) => {
        attempted.push(message.to);
        throw new Error("Resend caído");
      },
    });

    expect(attempted.sort()).toEqual([BUYER_EMAIL, TALLAMI_EMAIL].sort());
  });
});

describe("notifyPaymentOutcome: what only Tallami hears about", () => {
  test("a mismatch names the order and says that no sale was created", async () => {
    const order = await insertTestOrder(db);

    const { sent, toTallami } = await notify(order, { kind: "mismatch", orderId: order.id });

    expect(sent).toHaveLength(1);
    expect(toTallami[0].text).toContain(order.id);
    expect(toTallami[0].text).toContain("Ana Compradora");
    expect(toTallami[0].text).toContain("$ 45.000,00");
    expect(toTallami[0].text).toMatch(/no cre[oó] ninguna venta/i);
  });

  test("a second payment on an order that already has a sale also links to that sale", async () => {
    const order = await insertTestOrder(db);
    const first = await outcomeOf(order, {});
    if (first.kind !== "sale-created") throw new Error("Sin venta.");

    const { toTallami } = await notify(order, { kind: "mismatch", orderId: order.id });

    expect(toTallami[0].text).toContain(`${SITE_URL}/admin/ventas/${first.saleId}`);
  });

  test.each([
    ["in_mediation", /mediaci[oó]n/i],
    ["partially_refunded", /reembolso parcial/i],
    ["charged_back", /contracargo/i],
    ["refunded", /reembolso/i],
  ] as const)("%s goes only to Tallami, with the link to the sale", async (status, word) => {
    const order = await insertTestOrder(db);
    const created = await outcomeOf(order, {});
    if (created.kind !== "sale-created") throw new Error("Sin venta.");
    const outcome = await outcomeOf(order, { status });

    const { sent, toTallami } = await notify(order, outcome);

    expect(outcome.kind).toBe("sale-updated");
    expect(sent).toHaveLength(1);
    expect(toTallami[0].subject).toMatch(word);
    expect(toTallami[0].text).toContain(`${SITE_URL}/admin/ventas/${created.saleId}`);
    expect(toTallami[0].text).toContain("Ana Compradora");
  });
});

describe("notifyPaymentOutcome: several attempts on one order", () => {
  const OTHER_ATTEMPT = "987654321";

  test("a late rejected attempt on an approved order sends nothing", async () => {
    const order = await insertTestOrder(db);
    await outcomeOf(order, {});

    const outcome = await outcomeOf(order, { providerPaymentId: OTHER_ATTEMPT, status: "rejected", approvedAt: null });
    const { sent } = await notify(order, outcome);

    expect(outcome.kind).toBe("no-change");
    expect(sent).toEqual([]);
  });

  test("another approved payment on an approved order sends one email, to Tallami", async () => {
    const order = await insertTestOrder(db);
    await outcomeOf(order, {});

    const outcome = await outcomeOf(order, { providerPaymentId: OTHER_ATTEMPT });
    const { sent, toTallami } = await notify(order, outcome);

    expect(outcome.kind).toBe("mismatch");
    expect(sent).toHaveLength(1);
    expect(toTallami).toHaveLength(1);
  });
});

describe("notifyPaymentOutcome: what nobody hears about", () => {
  test.each(["no-change", "order-updated"] as const)("%s sends nothing", async (kind) => {
    const order = await insertTestOrder(db);
    const outcome: ApplyOutcome =
      kind === "no-change" ? { kind, orderId: order.id } : { kind, orderId: order.id, status: "rejected" };

    const { sent } = await notify(order, outcome);

    expect(sent).toEqual([]);
  });

  test("an unknown order sends nothing: the account can get payments that are not from the web", async () => {
    const order = await insertTestOrder(db);

    const { sent } = await notify(order, { kind: "unknown-order" });

    expect(sent).toEqual([]);
  });

  test("an order that is gone sends nothing and does not break", async () => {
    const order = await insertTestOrder(db);

    const { sent } = await notify(order, { kind: "mismatch", orderId: "00000000-0000-4000-8000-000000000000" });

    expect(sent).toEqual([]);
  });
});

describe("notifyPaymentOutcome: it never breaks anything", () => {
  test("a transport that throws does not break it", async () => {
    const order = await insertTestOrder(db);
    const outcome = await outcomeOf(order, {});
    const transport = vi.fn(async () => {
      throw new Error(`Rechazado para ${BUYER_EMAIL}`);
    });

    await expect(notifyPaymentOutcome(db, outcome, { transport })).resolves.toBeUndefined();

    expect(transport).toHaveBeenCalledTimes(2);
    expect(loggedText()).not.toContain(BUYER_EMAIL);
  });

  test("a database that fails does not break it either, and the log has only the kind of error", async () => {
    const broken = {
      select: () => {
        throw new Error("postgres://usuario:clave@base no responde");
      },
    } as unknown as Db;

    await expect(
      notifyPaymentOutcome(broken, { kind: "mismatch", orderId: "00000000-0000-4000-8000-000000000000" }),
    ).resolves.toBeUndefined();

    expect(loggedText().length).toBeGreaterThan(0);
    expect(loggedText()).not.toContain("clave@base");
  });
});
