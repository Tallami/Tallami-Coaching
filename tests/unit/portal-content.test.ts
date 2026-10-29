import { notFound } from "next/navigation";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AccountBar } from "@/components/portal/account-bar";
import { MessageView } from "@/components/portal/message-view";
import { PortalContent } from "@/components/portal/portal-content";
import { PortalNotice } from "@/components/portal/portal-notice";
import { PurchaseList } from "@/components/portal/purchase-list";
import { SignInButtons } from "@/components/portal/sign-in-buttons";
import { SignInView } from "@/components/portal/sign-in-view";
import { StripInviteFromUrl } from "@/components/portal/strip-invite-from-url";
import { UnlinkedView } from "@/components/portal/unlinked-view";
import type { PortalAccount } from "@/portal/accounts";
import { getCurrentStudent } from "@/portal/current";
import { listStudentPurchases } from "@/portal/purchases";
import es from "../../messages/es.json";

// Lo que decide `PortalContent` (qué vista y qué aviso le toca a cada estado) y cómo se dibujan las vistas
// que el e2e no puede armar porque dependen de variables de entorno o de una base que falla: el portal sin
// configurar, la base caída, los botones de Discord y de Google. Las páginas de servidor son funciones
// `async` que devuelven elementos: se miran los elementos que devuelve `PortalContent` y las vistas simples
// se dibujan a HTML con los textos reales del catálogo en español.

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));
vi.mock("@/portal/current", () => ({ getCurrentStudent: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/portal/purchases", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/portal/purchases")>()),
  listStudentPurchases: vi.fn(),
}));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../messages/es.json")).default;
  return {
    getTranslations: async (arg: string | { namespace: string }) =>
      createTranslator({ locale: "es", messages, namespace: (typeof arg === "string" ? arg : arg.namespace) as "Portal" }),
    getLocale: async () => "es",
  };
});

const SECRET = "secreto-del-portal-de-prueba-de-mas-de-32-caracteres";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const CUSTOMER_ID = "11111111-0000-4000-8000-000000000001";
const ACCOUNT: PortalAccount = {
  id: "22222222-0000-4000-8000-000000000001",
  provider: "discord",
  displayName: "Ana",
  email: null,
  customerId: CUSTOMER_ID,
};
const UNLINKED: PortalAccount = { ...ACCOUNT, customerId: null };

const currentStudent = vi.mocked(getCurrentStudent);
const purchasesOf = vi.mocked(listStudentPurchases);

/** Todos los elementos de un árbol de React, incluidos los de adentro de los fragmentos. */
function elementsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const { children } = node.props as { children?: ReactNode };
  return [node as ReactElement<Record<string, unknown>>, ...elementsOf(children)];
}

/** Las propiedades del elemento de ese componente, o `undefined` si el árbol no lo tiene. */
function propsOf(tree: ReactNode, component: unknown): Record<string, unknown> | undefined {
  return elementsOf(tree).find((element) => element.type === component)?.props;
}

function stubPortalEnv(env: Record<string, string> = {}): void {
  for (const name of [
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "PORTAL_OAUTH_TEST_ISSUER",
    "VERCEL",
    "VERCEL_ENV",
    "DATABASE_URL",
  ]) {
    vi.stubEnv(name, "");
  }
  vi.stubEnv("PORTAL_SESSION_SECRET", SECRET);
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

const BOTH_PROVIDERS = {
  DISCORD_CLIENT_ID: "id-de-discord",
  DISCORD_CLIENT_SECRET: "secreto-de-discord",
  GOOGLE_CLIENT_ID: "id-de-google",
  GOOGLE_CLIENT_SECRET: "secreto-de-google",
};

function page(searchParams: Record<string, string | string[] | undefined> = {}, locale: "es" | "pt" | "en" = "es") {
  return PortalContent({ locale, searchParams: Promise.resolve(searchParams) });
}

beforeEach(() => {
  stubPortalEnv(BOTH_PROVIDERS);
  currentStudent.mockReset();
  purchasesOf.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("PortalContent without configuration", () => {
  test("says the portal is not available yet, and never opens the session or the database", async () => {
    stubPortalEnv(); // sin Discord ni Google ni proveedor de prueba

    const tree = await page();

    expect(propsOf(tree, MessageView)).toEqual({ messageKey: "unavailable" });
    expect(currentStudent).not.toHaveBeenCalled();
    expect(purchasesOf).not.toHaveBeenCalled();
  });

  test("says the same when there is no portal secret, whatever providers are set", async () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", "corto");

    expect(propsOf(await page(), MessageView)).toEqual({ messageKey: "unavailable" });
  });

  test("says the same on Vercel without a database", async () => {
    vi.stubEnv("VERCEL", "1");

    expect(propsOf(await page(), MessageView)).toEqual({ messageKey: "unavailable" });
    expect(currentStudent).not.toHaveBeenCalled();
  });

  test("the message is the one of the catalog, with no data of anyone", () => {
    return MessageView({ messageKey: "unavailable" }).then((view) => {
      const html = renderToStaticMarkup(view);

      expect(html).toContain(es.Portal.unavailable.title);
      expect(html).toContain(es.Portal.unavailable.body);
    });
  });
});

describe("PortalContent when the database does not answer", () => {
  test("shows 'no pudimos cargar tu portal' and logs only the name of the error, never its message", async () => {
    currentStudent.mockRejectedValue(new TypeError("conexión a postgres://usuario:clave-secreta@db.example.com falló"));

    const tree = await page();

    expect(propsOf(tree, MessageView)).toEqual({ messageKey: "loadFailed" });
    expect(propsOf(tree, SignInView)).toBeUndefined();
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toMatch(/clave-secreta|postgres:\/\//);
  });

  test("shows the same when the purchases cannot be read", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    purchasesOf.mockRejectedValue(new Error("se cayó la base"));

    const tree = await page();

    expect(propsOf(tree, MessageView)).toEqual({ messageKey: "loadFailed" });
    expect(propsOf(tree, PurchaseList)).toBeUndefined();
  });

  test("lets the control-flow errors of Next through: they are not a failure of the database", async () => {
    currentStudent.mockImplementation(async () => notFound());

    await expect(page()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    expect(console.error).not.toHaveBeenCalled();
  });

  test("the message is the one of the catalog", async () => {
    const html = renderToStaticMarkup(await MessageView({ messageKey: "loadFailed" }));

    expect(html).toContain(es.Portal.loadFailed.title);
    expect(html).toContain(es.Portal.loadFailed.body);
  });
});

describe("PortalContent without a session", () => {
  beforeEach(() => {
    currentStudent.mockResolvedValue(null);
  });

  test("offers Discord and then Google when those two are configured, and nothing else", async () => {
    const tree = await page();

    expect(propsOf(tree, SignInView)).toEqual({ providers: ["discord", "google"], locale: "es", inviteToken: null });
    expect(propsOf(tree, AccountBar)).toBeUndefined();
    expect(purchasesOf).not.toHaveBeenCalled();
  });

  test("offers only the providers whose id and secret are both set", async () => {
    stubPortalEnv({ GOOGLE_CLIENT_ID: "id-de-google", GOOGLE_CLIENT_SECRET: "secreto-de-google", DISCORD_CLIENT_ID: "solo-el-id" });

    expect(propsOf(await page(), SignInView)?.providers).toEqual(["google"]);
  });

  test("puts the test provider last, only when its issuer is set", async () => {
    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3110");

    expect(propsOf(await page(), SignInView)?.providers).toEqual(["discord", "google", "test"]);
  });

  test("never offers the test provider in production on Vercel", async () => {
    stubPortalEnv({ ...BOTH_PROVIDERS, PORTAL_OAUTH_TEST_ISSUER: "http://localhost:3110", VERCEL: "1", VERCEL_ENV: "production", DATABASE_URL: "postgres://x" });

    expect(propsOf(await page(), SignInView)?.providers).toEqual(["discord", "google"]);
  });

  test("the language of the page goes to the buttons", async () => {
    expect(propsOf(await page({}, "pt"), SignInView)?.locale).toBe("pt");
  });

  test("the invitation of the link goes to the buttons, takes it off the address bar and asks to sign in", async () => {
    const tree = await page({ invitacion: TOKEN });

    expect(propsOf(tree, SignInView)).toMatchObject({ inviteToken: TOKEN });
    expect(propsOf(tree, StripInviteFromUrl)).toBeDefined();
    expect(propsOf(tree, PortalNotice)).toEqual({ notice: { key: "inviteToSignIn", tone: "info" } });
  });

  test("an address without an invitation does not touch the address bar", async () => {
    const tree = await page({ ingreso: "fallido" });

    expect(propsOf(tree, StripInviteFromUrl)).toBeUndefined();
    expect(propsOf(tree, PortalNotice)).toEqual({ notice: { key: "signInFailed", tone: "error" } });
  });

  test("an outcome of the invitation typed by hand is not shown", async () => {
    expect(propsOf(await page({ invitacion: "vinculada" }), PortalNotice)).toBeUndefined();
  });
});

describe("PortalContent with a session", () => {
  test("an account that is not linked sees who it is, the way to link it and no purchases, and the database of purchases stays closed", async () => {
    currentStudent.mockResolvedValue(UNLINKED);

    const tree = await page();

    expect(propsOf(tree, AccountBar)).toMatchObject({ account: UNLINKED, locale: "es" });
    expect(propsOf(tree, UnlinkedView)).toMatchObject({ inviteToken: null });
    expect(propsOf(tree, PurchaseList)).toBeUndefined();
    expect(purchasesOf).not.toHaveBeenCalled();
  });

  test("an account that is not linked and opens an invitation link is asked to sign in again with it", async () => {
    currentStudent.mockResolvedValue(UNLINKED);

    const tree = await page({ invitacion: TOKEN });

    expect(propsOf(tree, UnlinkedView)).toMatchObject({ inviteToken: TOKEN, providers: ["discord", "google"] });
    expect(propsOf(tree, StripInviteFromUrl)).toBeDefined();
    expect(propsOf(tree, PortalNotice)).toBeUndefined();
  });

  test("a linked account with no purchases sees the empty list, and the purchases asked for are those of its own student", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    purchasesOf.mockResolvedValue([]);

    const tree = await page();

    expect(purchasesOf).toHaveBeenCalledTimes(1);
    expect(purchasesOf.mock.calls[0][1]).toBe(CUSTOMER_ID);
    expect(propsOf(tree, PurchaseList)).toEqual({ purchases: [] });
    expect(propsOf(tree, AccountBar)).toMatchObject({ account: ACCOUNT });
    const html = renderToStaticMarkup(await PurchaseList({ purchases: [] }));
    expect(html).toContain(es.Portal.purchases.title);
    expect(html).toContain(es.Portal.purchases.empty);
    expect(html).not.toContain("<article");
  });

  test("a linked account that opens an invitation link again only has the token taken off the bar", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    purchasesOf.mockResolvedValue([]);

    const tree = await page({ invitacion: TOKEN });

    expect(propsOf(tree, StripInviteFromUrl)).toBeDefined();
    expect(propsOf(tree, PortalNotice)).toBeUndefined();
    expect(propsOf(tree, SignInView)).toBeUndefined();
  });

  test.each([
    ["vinculada", "linked", "success"],
    ["invalida", "alreadyLinked", "info"],
    ["ocupada", "inviteTaken", "error"],
  ] as const)("a linked account that comes back with `%s` gets the %s notice", async (outcome, key, tone) => {
    currentStudent.mockResolvedValue(ACCOUNT);
    purchasesOf.mockResolvedValue([]);

    expect(propsOf(await page({ invitacion: outcome }), PortalNotice)).toEqual({ notice: { key, tone } });
  });
});

describe("SignInButtons", () => {
  async function html(providers: ("discord" | "google" | "test")[], inviteToken: string | null = null, locale: "es" | "pt" = "es") {
    return renderToStaticMarkup(await SignInButtons({ providers, locale, inviteToken }));
  }

  test("writes one link per provider, in the order given, with the label of the catalog", async () => {
    const markup = await html(["discord", "google", "test"]);

    const labels = [...markup.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((match) => match[1]);
    expect(labels).toEqual([
      es.Portal.providers.discord.button,
      es.Portal.providers.google.button,
      es.Portal.providers.test.button,
    ]);
    expect(es.Portal.providers.discord.button).toBe("Entrar con Discord");
    expect(es.Portal.providers.google.button).toBe("Entrar con Google");
    expect(es.Portal.providers.test.button).toMatch(/prueba/);
  });

  test("each link starts the sign-in of its provider in the language of the page", async () => {
    const markup = await html(["discord", "google"], null, "pt");

    expect(markup).toContain('href="/api/portal/auth/discord?locale=pt"');
    expect(markup).toContain('href="/api/portal/auth/google?locale=pt"');
    expect(markup).not.toContain("invitacion");
  });

  test("the invitation travels in every link, and only there", async () => {
    const markup = await html(["discord", "google"], TOKEN);

    expect(markup).toContain(`href="/api/portal/auth/discord?locale=es&amp;invitacion=${TOKEN}"`);
    expect(markup).toContain(`href="/api/portal/auth/google?locale=es&amp;invitacion=${TOKEN}"`);
    expect(markup.split(TOKEN)).toHaveLength(3);
  });

  test("the list has a name and the links are plain links, not buttons that need JavaScript", async () => {
    const markup = await html(["discord"]);

    expect(markup).toContain(`aria-label="${es.Portal.signIn.providersLabel}"`);
    expect(markup).not.toContain("<button");
  });
});

describe("PortalNotice", () => {
  test.each([
    ["error", "alert"],
    ["info", "status"],
    ["success", "status"],
  ] as const)("a %s notice is announced as `%s`, with the text of the catalog", async (tone, role) => {
    const html = renderToStaticMarkup(await PortalNotice({ notice: { key: "alreadyLinked", tone } }));

    expect(html).toContain(`role="${role}"`);
    expect(html).toContain(es.Portal.notices.alreadyLinked);
  });
});
