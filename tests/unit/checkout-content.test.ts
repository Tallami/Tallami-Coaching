import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CheckoutContent } from "@/components/checkout/checkout-content";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { CheckoutLegal } from "@/components/checkout/checkout-legal";
import { CheckoutNotice } from "@/components/checkout/checkout-notice";
import { CheckoutSignIn } from "@/components/checkout/checkout-sign-in";
import { CheckoutSummary } from "@/components/checkout/checkout-summary";
import { CheckoutUnavailable } from "@/components/checkout/checkout-unavailable";
import { getDb, type Db } from "@/db/client";
import { savePesosPerDollar } from "@/payments/pricing";
import type { PortalAccount } from "@/portal/accounts";
import { getCurrentStudent } from "@/portal/current";
import { createTestDb } from "../helpers/db";
import es from "../../messages/es.json";

// Lo que decide la pantalla de confirmación según la sesión, lo que falta para cobrar y lo que dice su
// dirección. La parte del e2e comparte el valor de pesos por dólar con el resto de los tests, así que
// lo que depende de que no haya valor se mira acá, con una base propia.

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));
vi.mock("@/portal/current", () => ({ getCurrentStudent: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../messages/es.json")).default;
  return {
    getTranslations: async (arg: string | { namespace: string }) =>
      createTranslator({ locale: "es", messages, namespace: (typeof arg === "string" ? arg : arg.namespace) as "Checkout" }),
    getLocale: async () => "es",
  };
});

const LINK = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const ACCOUNT: PortalAccount = {
  id: "22222222-0000-4000-8000-000000000001",
  provider: "google",
  displayName: "Ana",
  email: "ana@example.com",
  customerId: null,
  handle: null,
  locale: "es",
};

const currentStudent = vi.mocked(getCurrentStudent);
let db: Db;

function elementsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const { children } = node.props as { children?: ReactNode };
  return [node as ReactElement<Record<string, unknown>>, ...elementsOf(children)];
}

function propsOf(tree: ReactNode, component: unknown): Record<string, unknown> | undefined {
  return elementsOf(tree).find((element) => element.type === component)?.props;
}

function screen(searchParams: Record<string, string | string[] | undefined> = {}) {
  return CheckoutContent({ locale: "es", item: "vodRecorded", searchParams: Promise.resolve(searchParams) });
}

beforeEach(async () => {
  db = await createTestDb();
  vi.mocked(getDb).mockResolvedValue(db);
  await savePesosPerDollar(db, "1500");
  currentStudent.mockReset();
  currentStudent.mockResolvedValue(null);
  for (const name of ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET", "VERCEL", "VERCEL_ENV", "DATABASE_URL"]) {
    vi.stubEnv(name, "");
  }
  vi.stubEnv("PORTAL_SESSION_SECRET", "secreto-del-portal-de-prueba-de-mas-de-32-caracteres");
  vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3110");
  vi.stubEnv("MERCADOPAGO_ACCESS_TOKEN", "TEST-token");
  vi.stubEnv("MERCADOPAGO_WEBHOOK_SECRET", "clave-de-los-avisos");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("PUBLIC_EMAIL_FROM", "Tallami <pagos@tallami.example>");
  vi.stubEnv("ADMIN_ALERT_EMAIL", "avisos@example.test");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the purchase screen", () => {
  test("without a session it shows the price in both currencies and the ways to sign in, coming back to this same screen, and no form", async () => {
    const tree = await screen();

    expect(propsOf(tree, CheckoutSummary)).toEqual({ priceUsd: 30, rate: "1500.0000", locale: "es" });
    expect(propsOf(tree, CheckoutSignIn)).toEqual({
      providers: ["test"],
      locale: "es",
      checkout: { slug: "vod-3-partidas", linkToken: null },
    });
    expect(propsOf(tree, CheckoutForm)).toBeUndefined();
  });

  test("with a session it shows the form with the amount the server calculated, the service and the language, and no ways to sign in", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);

    const tree = await screen();

    expect(propsOf(tree, CheckoutForm)).toEqual({
      account: ACCOUNT,
      slug: "vod-3-partidas",
      locale: "es",
      shownArsMinor: 4_500_000,
      linkToken: null,
    });
    expect(propsOf(tree, CheckoutSignIn)).toBeUndefined();
  });

  test.each([
    ["without the rate", async () => createTestDb(), {}],
    ["without credentials", async () => db, { MERCADOPAGO_ACCESS_TOKEN: "" }],
    ["without a sender", async () => db, { PUBLIC_EMAIL_FROM: "" }],
  ])("%s it says it cannot be paid yet, offers the contact and shows no form or sign-in", async (_label, database, env) => {
    vi.mocked(getDb).mockResolvedValue(await database());
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    currentStudent.mockResolvedValue(ACCOUNT);

    const tree = await screen();

    expect(propsOf(tree, CheckoutUnavailable)).toEqual({ locale: "es" });
    expect(propsOf(tree, CheckoutForm)).toBeUndefined();
    expect(propsOf(tree, CheckoutSignIn)).toBeUndefined();
  });

  test("without a rate the summary shows dollars only", async () => {
    vi.mocked(getDb).mockResolvedValue(await createTestDb());

    expect(propsOf(await screen(), CheckoutSummary)).toMatchObject({ rate: null });
  });

  test("the unavailable message comes from the catalog and leads to the contact form", async () => {
    const html = renderToStaticMarkup(await CheckoutUnavailable({ locale: "pt" }));

    expect(html).toContain(es.Checkout.unavailable.title);
    expect(html).toContain('href="/pt/contacto"');
  });

  test("while the portal is not configured nobody can sign in: it says it cannot be paid yet, and never reads the session", async () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", "");

    const tree = await screen();

    expect(propsOf(tree, CheckoutUnavailable)).toBeDefined();
    expect(currentStudent).not.toHaveBeenCalled();
  });

  test("if the database does not answer it says it cannot be paid and logs only the name of the error", async () => {
    vi.mocked(getDb).mockRejectedValue(new TypeError("postgres://usuario:clave@host/base no responde"));

    const tree = await screen();

    expect(propsOf(tree, CheckoutUnavailable)).toBeDefined();
    expect(propsOf(tree, CheckoutSummary)).toMatchObject({ rate: null });
    const logged = vi.mocked(console.error).mock.calls.flat().map(String).join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("clave@host");
  });

  test("always leads to the terms, refunds and privacy", async () => {
    expect(propsOf(await screen(), CheckoutLegal)).toEqual({ locale: "es" });
  });

  test("the legal links and the line for who is not in Argentina go where they should, in the language of the page", async () => {
    const html = renderToStaticMarkup(await CheckoutLegal({ locale: "en" }));

    for (const path of ["/en/terminos", "/en/reembolsos", "/en/privacidad", "/en/contacto"]) {
      expect(html).toContain(`href="${path}"`);
    }
    expect(html).toContain(es.Checkout.legal.outsideArgentina);
  });
});

describe("what the address of the screen says", () => {
  test.each(["adult", "price-changed", "unavailable", "link-invalid", "provider"] as const)("`error=%s` shows its notice", async (reason) => {
    expect(propsOf(await screen({ error: reason }), CheckoutNotice)).toEqual({ reason });
  });

  test.each(["hackeado", "", "<script>", "__proto__", "ADULT"])("`error=%s` is not a reason: no notice", async (reason) => {
    expect(propsOf(await screen({ error: reason }), CheckoutNotice)).toBeUndefined();
  });

  test("each notice has its text in the catalog, and it is an alert", async () => {
    for (const reason of ["adult", "price-changed", "unavailable", "link-invalid", "provider"] as const) {
      const html = renderToStaticMarkup(await CheckoutNotice({ reason }));

      expect(html).toContain('role="alert"');
      expect(html).toContain(es.Checkout.errors[reason]);
    }
  });

  test("a payment link with the right shape goes to the sign-in and to the form", async () => {
    expect(propsOf(await screen({ link: LINK }), CheckoutSignIn)).toMatchObject({
      checkout: { slug: "vod-3-partidas", linkToken: LINK },
    });

    currentStudent.mockResolvedValue(ACCOUNT);
    expect(propsOf(await screen({ link: LINK }), CheckoutForm)).toMatchObject({ linkToken: LINK });
  });

  test("a link with another shape is ignored", async () => {
    expect(propsOf(await screen({ link: "corto" }), CheckoutSignIn)).toMatchObject({
      checkout: { slug: "vod-3-partidas", linkToken: null },
    });
  });
});

describe("the form of the screen", () => {
  async function formHtml(linkToken: string | null = null) {
    return renderToStaticMarkup(
      await CheckoutForm({ account: ACCOUNT, slug: "vod-3-partidas", locale: "es", shownArsMinor: 4_500_000, linkToken }),
    );
  }

  /** La etiqueta `<input>` del campo `name`, sea cual sea el orden de sus atributos. */
  function field(html: string, name: string): string {
    return new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? "";
  }

  test("is a plain form: the box is required, and the amount it showed goes in a hidden field", async () => {
    const html = await formHtml();

    expect(field(html, "adult")).toContain('type="checkbox"');
    expect(field(html, "adult")).toContain("required");
    for (const [name, value] of [
      ["shownArsMinor", "4500000"],
      ["service", "vod-3-partidas"],
      ["locale", "es"],
    ]) {
      expect(field(html, name), name).toContain('type="hidden"');
      expect(field(html, name), name).toContain(`value="${value}"`);
    }
    expect(html).toContain(es.Checkout.form.pay);
  });

  test("sends the link only if there is one", async () => {
    expect(await formHtml()).not.toContain('name="link"');
    expect(field(await formHtml(LINK), "link")).toContain(`value="${LINK}"`);
  });

  test("the box has its label joined to it", async () => {
    const html = await formHtml();

    expect(html).toContain(es.Checkout.form.adult);
    expect(/<label[^>]*>[\s\S]*name="adult"[\s\S]*<\/label>/.test(html)).toBe(true);
  });
});
