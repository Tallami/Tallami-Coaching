import { notFound } from "next/navigation";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AccountBar } from "@/components/portal/account-bar";
import { MessagesCard } from "@/components/portal/messages-card";
import { MessageView } from "@/components/portal/message-view";
import { PortalContent } from "@/components/portal/portal-content";
import { PortalNotice } from "@/components/portal/portal-notice";
import { PurchaseList } from "@/components/portal/purchase-list";
import { SignInButtons } from "@/components/portal/sign-in-buttons";
import { SignInView } from "@/components/portal/sign-in-view";
import { StripInviteFromUrl } from "@/components/portal/strip-invite-from-url";
import { UnlinkedView } from "@/components/portal/unlinked-view";
import { after } from "next/server";
import { unreadForStudent } from "@/chat/conversations";
import { reconcileOrder } from "@/payments/checkout";
import { getMercadoPagoClient } from "@/payments/mercadopago";
import { accountOrderState, orderForAccount, type Order } from "@/payments/orders";
import { getAccount, type PortalAccount } from "@/portal/accounts";
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
  after: vi.fn(),
}));
vi.mock("@/portal/current", () => ({ getCurrentStudent: vi.fn() }));
vi.mock("@/portal/accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/portal/accounts")>()),
  getAccount: vi.fn(),
}));
vi.mock("@/payments/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/payments/orders")>()),
  orderForAccount: vi.fn(),
  accountOrderState: vi.fn(),
}));
vi.mock("@/payments/checkout", () => ({ reconcileOrder: vi.fn(async () => undefined) }));
vi.mock("@/payments/mercadopago", () => ({ getMercadoPagoClient: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/portal/purchases", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/portal/purchases")>()),
  listStudentPurchases: vi.fn(),
}));
vi.mock("@/chat/conversations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/chat/conversations")>()),
  unreadForStudent: vi.fn(),
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
  handle: null,
  locale: "es",
};
const UNLINKED: PortalAccount = { ...ACCOUNT, customerId: null };

const currentStudent = vi.mocked(getCurrentStudent);
const purchasesOf = vi.mocked(listStudentPurchases);
const orderOf = vi.mocked(orderForAccount);
const stateOfAccount = vi.mocked(accountOrderState);
const reconcile = vi.mocked(reconcileOrder);
const accountNow = vi.mocked(getAccount);
const providerClient = vi.mocked(getMercadoPagoClient);
const unreadOf = vi.mocked(unreadForStudent);

const ORDER_ID = "33333333-0000-4000-8000-000000000001";
const PROVIDER = { id: "mercadopago" } as NonNullable<ReturnType<typeof getMercadoPagoClient>>;
/** Los pedidos de estos tests vencen dentro de una hora, salvo el que prueba lo contrario. */
const WITHIN_THE_HOUR = new Date(Date.now() + 60 * 60 * 1000);
const PAST_THE_HOUR = new Date(Date.now() - 60 * 1000);

function orderWith(status: Order["status"], item = "vodRecorded", expiresAt = WITHIN_THE_HOUR): Order {
  return { id: ORDER_ID, status, item, expiresAt } as Order;
}

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
  orderOf.mockReset();
  orderOf.mockResolvedValue(null);
  stateOfAccount.mockReset();
  stateOfAccount.mockResolvedValue(null);
  reconcile.mockClear();
  accountNow.mockReset();
  providerClient.mockReset();
  providerClient.mockReturnValue(PROVIDER);
  unreadOf.mockReset();
  unreadOf.mockResolvedValue(0);
  vi.mocked(after).mockClear();
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

  test("a linked account that opens an invitation link is told its account is already linked, keeps its own purchases and has the token taken off the bar", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    purchasesOf.mockResolvedValue([]);

    const tree = await page({ invitacion: TOKEN });

    expect(propsOf(tree, PortalNotice)).toEqual({ notice: { key: "inviteOtherAccount", tone: "info" } });
    expect(propsOf(tree, StripInviteFromUrl)).toBeDefined();
    expect(propsOf(tree, PurchaseList)).toEqual({ purchases: [] });
    expect(propsOf(tree, AccountBar)).toMatchObject({ account: ACCOUNT });
    expect(propsOf(tree, SignInView)).toBeUndefined();
  });

  test("the notice for a linked account with an invitation link is announced without interrupting, says the account is already linked and what to do if the invitation is for another", async () => {
    const html = renderToStaticMarkup(await PortalNotice({ notice: { key: "inviteOtherAccount", tone: "info" } }));

    expect(html).toContain('role="status"');
    expect(html).toContain("Tu cuenta ya está vinculada. Si esta invitación es para otra cuenta, salí y entrá con esa.");
    expect(es.Portal.account.signOut).toBe("Salir");
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

describe("the card of the messages with Tallami", () => {
  test("a linked account sees the card above its purchases, with the unread messages of its own student", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    purchasesOf.mockResolvedValue([]);
    unreadOf.mockResolvedValue(2);

    const tree = await page({}, "pt");

    expect(unreadOf).toHaveBeenCalledTimes(1);
    expect(unreadOf.mock.calls[0][1]).toBe(CUSTOMER_ID);
    expect(propsOf(tree, MessagesCard)).toEqual({ unread: 2, locale: "pt" });
    const order = elementsOf(tree).map((element) => element.type);
    expect(order.indexOf(MessagesCard)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(MessagesCard)).toBeLessThan(order.indexOf(PurchaseList));
  });

  test.each([
    ["an account that is not linked", UNLINKED],
    ["someone without a session", null],
  ] as const)("%s sees no card, and nothing of the messages is read", async (_label, account) => {
    currentStudent.mockResolvedValue(account);

    const tree = await page();

    expect(propsOf(tree, MessagesCard)).toBeUndefined();
    expect(unreadOf).not.toHaveBeenCalled();
  });

  test("when only the unread messages cannot be read, the purchases and the card are shown, without a number, and the log has only the type", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    purchasesOf.mockResolvedValue([]);
    unreadOf.mockRejectedValue(new TypeError("conexión a postgres://usuario:clave-secreta@db"));

    const tree = await page({}, "es");

    expect(propsOf(tree, MessageView)).toBeUndefined();
    expect(propsOf(tree, PurchaseList)).toEqual({ purchases: [] });
    expect(propsOf(tree, MessagesCard)).toEqual({ unread: 0, locale: "es" });
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("TypeError");
    expect(logged).not.toMatch(/clave-secreta|postgres:\/\//);
  });

  test("a control-flow error of Next in the unread count goes through", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    purchasesOf.mockResolvedValue([]);
    unreadOf.mockImplementation(async () => notFound());

    await expect(page()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  test.each([
    [0, "Sin mensajes nuevos"],
    [1, "1 mensaje sin leer"],
    [3, "3 mensajes sin leer"],
  ] as const)("with %i unread it says %j and links to the messages page in the language of the page", async (unread, text) => {
    const html = renderToStaticMarkup(await MessagesCard({ unread, locale: "es" }));

    expect(html).toContain(es.Chat.card.title);
    expect(html).toContain(text);
    expect(html).toContain('href="/es/portal/mensajes"');
    expect(html).toContain(es.Chat.card.open);
    expect(html).not.toContain("<article");
  });
});

describe("PortalContent when the buyer comes back from paying", () => {
  beforeEach(() => {
    purchasesOf.mockResolvedValue([]);
  });

  test("an address without a purchase does not read any order or ask Mercado Pago", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);

    await page();

    expect(orderOf).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  test("without a session nothing of the order is read", async () => {
    currentStudent.mockResolvedValue(null);

    const tree = await page({ compra: ORDER_ID, payment_id: "123" });

    expect(orderOf).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(propsOf(tree, PortalNotice)).toBeUndefined();
    expect(propsOf(tree, SignInView)).toBeDefined();
  });

  test("the order asked for is looked up among those of the account in session", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);

    await page({ compra: ORDER_ID });

    expect(orderOf.mock.calls[0].slice(1)).toEqual([ORDER_ID, ACCOUNT.id]);
  });

  test("the order of someone else: no notice, nothing asked to Mercado Pago, and the page shows only what is its own", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    orderOf.mockResolvedValue(null);

    const tree = await page({ compra: ORDER_ID, payment_id: "123" });

    expect(propsOf(tree, PortalNotice)).toBeUndefined();
    expect(reconcile).not.toHaveBeenCalled();
    expect(propsOf(tree, PurchaseList)).toEqual({ purchases: [] });
  });

  test("an order without confirming is looked up once with the payment of the address, and the notice comes from what is there after that", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    accountNow.mockResolvedValue(ACCOUNT);
    orderOf.mockResolvedValueOnce(orderWith("created")).mockResolvedValueOnce(orderWith("approved"));

    const tree = await page({ compra: ORDER_ID, payment_id: "123", status: "rejected" });

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls[0].slice(1, 4)).toEqual([PROVIDER, orderWith("created"), "123"]);
    expect(propsOf(tree, PortalNotice)).toMatchObject({ notice: { key: "paymentApproved", tone: "success" } });
  });

  test("the emails of that lookup go out after the response", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    accountNow.mockResolvedValue(ACCOUNT);
    orderOf.mockResolvedValue(orderWith("created"));

    await page({ compra: ORDER_ID });

    const schedule = reconcile.mock.calls[0][5];
    const task = async () => undefined;
    schedule?.(task);
    expect(after).toHaveBeenCalledWith(task);
  });

  test("the payment that creates the student links the account in that same moment: the page shows the purchases, not the unlinked view", async () => {
    currentStudent.mockResolvedValue(UNLINKED);
    accountNow.mockResolvedValue(ACCOUNT);
    orderOf.mockResolvedValueOnce(orderWith("created")).mockResolvedValueOnce(orderWith("approved"));

    const tree = await page({ compra: ORDER_ID });

    expect(propsOf(tree, UnlinkedView)).toBeUndefined();
    expect(propsOf(tree, PurchaseList)).toEqual({ purchases: [] });
    expect(purchasesOf.mock.calls[0][1]).toBe(CUSTOMER_ID);
    expect(propsOf(tree, AccountBar)).toMatchObject({ account: ACCOUNT });
  });

  test("an order that already went through says so without asking Mercado Pago", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    accountNow.mockResolvedValue(ACCOUNT);
    orderOf.mockResolvedValue(orderWith("approved"));

    const tree = await page({ compra: ORDER_ID });

    expect(reconcile).not.toHaveBeenCalled();
    expect(propsOf(tree, PortalNotice)).toMatchObject({ notice: { key: "paymentApproved" } });
  });

  test("without a client of Mercado Pago the page still answers, with what the database says", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    accountNow.mockResolvedValue(ACCOUNT);
    providerClient.mockReturnValue(null);
    orderOf.mockResolvedValue(orderWith("pending"));

    const tree = await page({ compra: ORDER_ID });

    expect(reconcile).not.toHaveBeenCalled();
    expect(propsOf(tree, PortalNotice)).toMatchObject({ notice: { key: "paymentPending" } });
  });

  test("a failed payment offers to try the same service again, in the language of the page", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    accountNow.mockResolvedValue(ACCOUNT);
    orderOf.mockResolvedValue(orderWith("rejected", "gamePlan"));

    const tree = await page({ compra: ORDER_ID }, "pt");

    expect(propsOf(tree, PortalNotice)).toEqual({
      notice: { key: "paymentFailed", tone: "error" },
      retryHref: "/pt/comprar/plan-de-juego",
    });
    const html = renderToStaticMarkup(await PortalNotice({ notice: { key: "paymentFailed", tone: "error" }, retryHref: "/es/comprar/vod-torneo" }));
    expect(html).toContain('href="/es/comprar/vod-torneo"');
    expect(html).toContain(es.Portal.notices.paymentFailed);
    expect(html).toContain(es.Portal.retryPayment);
  });

  test("an order that reached its hour with no payment says it failed and offers the retry, after asking Mercado Pago", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    accountNow.mockResolvedValue(ACCOUNT);
    orderOf.mockResolvedValue(orderWith("created", "vodLive", PAST_THE_HOUR));

    const tree = await page({ compra: ORDER_ID });

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(propsOf(tree, PortalNotice)).toEqual({
      notice: { key: "paymentFailed", tone: "error" },
      retryHref: "/es/comprar/vod-en-vivo",
    });
  });

  test("an order past its hour that Mercado Pago says was paid is a confirmed purchase", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    accountNow.mockResolvedValue(ACCOUNT);
    orderOf.mockResolvedValueOnce(orderWith("created", "vodLive", PAST_THE_HOUR)).mockResolvedValueOnce(orderWith("approved"));

    expect(propsOf(await page({ compra: ORDER_ID }), PortalNotice)).toMatchObject({ notice: { key: "paymentApproved" } });
  });

  test("an order with no payment seen keeps saying it is waiting, and offers a way back to whoever did not get to pay", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    accountNow.mockResolvedValue(ACCOUNT);
    orderOf.mockResolvedValue(orderWith("created", "gamePlan"));

    expect(propsOf(await page({ compra: ORDER_ID }, "pt"), PortalNotice)).toEqual({
      notice: { key: "paymentPending", tone: "info" },
      retryHref: "/pt/comprar/plan-de-juego",
    });
  });

  test("an order with a payment in course says it is waiting and offers no way back: paying again could charge twice", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    accountNow.mockResolvedValue(ACCOUNT);
    orderOf.mockResolvedValue(orderWith("pending", "gamePlan"));

    const notice = propsOf(await page({ compra: ORDER_ID }), PortalNotice);

    expect(notice).toMatchObject({ notice: { key: "paymentPending", tone: "info" } });
    expect(notice?.retryHref).toBeUndefined();
  });

  test("coming back with a payment id while the order still has no payment seen offers no way back: that buyer just paid", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    accountNow.mockResolvedValue(ACCOUNT);
    // La consulta falló o todavía no ve el pago, y el aviso no llegó: el pedido sigue `created`.
    orderOf.mockResolvedValue(orderWith("created", "gamePlan"));

    const notice = propsOf(await page({ compra: ORDER_ID, payment_id: "123" }), PortalNotice);

    expect(notice).toMatchObject({ notice: { key: "paymentPending", tone: "info" } });
    expect(notice?.retryHref).toBeUndefined();
  });

  test("the waiting notice words the link for someone who may just not have paid, and keeps its text", async () => {
    const html = renderToStaticMarkup(
      await PortalNotice({ notice: { key: "paymentPending", tone: "info" }, retryHref: "/es/comprar/vod-torneo" }),
    );

    expect(html).toContain(es.Portal.notices.paymentPending);
    expect(html).toContain('href="/es/comprar/vod-torneo"');
    expect(html).toContain(es.Portal.retryUnpaid);
    expect(html).not.toContain(es.Portal.retryPayment);
  });

  test("the failed notice keeps its own wording for the link", async () => {
    const html = renderToStaticMarkup(
      await PortalNotice({ notice: { key: "paymentFailed", tone: "error" }, retryHref: "/es/comprar/vod-torneo" }),
    );

    expect(html).toContain(es.Portal.retryPayment);
    expect(html).not.toContain(es.Portal.retryUnpaid);
  });

  test("an approved payment offers no retry", async () => {
    currentStudent.mockResolvedValue(ACCOUNT);
    accountNow.mockResolvedValue(ACCOUNT);
    orderOf.mockResolvedValue(orderWith("approved"));

    expect(propsOf(await page({ compra: ORDER_ID }), PortalNotice)?.retryHref).toBeUndefined();
  });

  test.each([
    ["failed", "rejected", "paymentFailed"],
    ["waiting", "created", "paymentPending"],
  ] as const)("a %s Temporada Pro payment has no public screen to go back to: no retry link", async (_label, status, key) => {
    currentStudent.mockResolvedValue(ACCOUNT);
    accountNow.mockResolvedValue(ACCOUNT);
    orderOf.mockResolvedValue(orderWith(status, "proSeason"));

    const tree = await page({ compra: ORDER_ID });

    expect(propsOf(tree, PortalNotice)).toMatchObject({ notice: { key } });
    expect(propsOf(tree, PortalNotice)?.retryHref).toBeUndefined();
  });
});

describe("the unlinked view of someone who is buying", () => {
  test.each(["unconfirmed", "failed"] as const)(
    "without an order in the address, an account whose orders are %s gets that view: the page knows from the database",
    async (state) => {
      currentStudent.mockResolvedValue(UNLINKED);
      stateOfAccount.mockResolvedValue(state);

      const tree = await page();

      expect(propsOf(tree, UnlinkedView)).toMatchObject({ orderState: state });
      expect(stateOfAccount.mock.calls[0][1]).toBe(UNLINKED.id);
      expect(purchasesOf).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["rejected", "rejected", WITHIN_THE_HOUR, "failed"],
    ["cancelled", "cancelled", WITHIN_THE_HOUR, "failed"],
    ["armed and past its hour", "created", PAST_THE_HOUR, "failed"],
    ["armed within its hour", "created", WITHIN_THE_HOUR, "unconfirmed"],
    ["pending and past its hour", "pending", PAST_THE_HOUR, "unconfirmed"],
  ] as const)(
    "coming back with an order that is %s gets the view that matches the notice above it, whatever the other orders say",
    async (_label, status, expiresAt, state) => {
      currentStudent.mockResolvedValue(UNLINKED);
      accountNow.mockResolvedValue(UNLINKED);
      orderOf.mockResolvedValue(orderWith(status, "vodRecorded", expiresAt));
      stateOfAccount.mockResolvedValue(state === "failed" ? "unconfirmed" : "failed");

      expect(propsOf(await page({ compra: ORDER_ID }), UnlinkedView)).toMatchObject({ orderState: state });
    },
  );

  test("an account with no orders stays as it was", async () => {
    currentStudent.mockResolvedValue(UNLINKED);

    expect(propsOf(await page(), UnlinkedView)).toMatchObject({ orderState: null });
  });

  describe("what each view says", () => {
    const base = { providers: [], locale: "es", inviteToken: null } as const;

    test("waiting for a payment: it appears here when confirmed, with no invitation", async () => {
      const html = renderToStaticMarkup(await UnlinkedView({ ...base, orderState: "unconfirmed" }));

      expect(html).toContain(es.Portal.unlinked.orderTitle);
      expect(html).toContain(es.Portal.unlinked.orderBody);
      expect(html).not.toMatch(/invitación/i);
    });

    test("a failed payment: it does not invite to wait or ask for an invitation", async () => {
      const html = renderToStaticMarkup(await UnlinkedView({ ...base, orderState: "failed" }));

      expect(html).toContain(es.Portal.unlinked.failedTitle);
      expect(html).toContain(es.Portal.unlinked.failedBody);
      expect(html).not.toMatch(/invitación/i);
      expect(html).not.toContain(es.Portal.unlinked.orderTitle);
      expect(html).not.toContain(es.Portal.unlinked.orderBody);
    });

    test("no orders: it asks for the invitation", async () => {
      const html = renderToStaticMarkup(await UnlinkedView({ ...base, orderState: null }));

      expect(html).toContain(es.Portal.unlinked.title);
      expect(html).toContain(es.Portal.unlinked.body);
    });

    test.each(["unconfirmed", "failed", null] as const)("with %s, it offers the services", async (orderState) => {
      const html = renderToStaticMarkup(await UnlinkedView({ ...base, orderState }));

      expect(html).toContain('href="/es#services"');
      expect(html).toContain(es.Portal.unlinked.services);
    });
  });

  test("an invitation in the address still comes first", async () => {
    const view = await UnlinkedView({ providers: ["discord"], locale: "es", inviteToken: TOKEN, orderState: "failed" });

    expect(propsOf(view, SignInButtons)).toMatchObject({ inviteToken: TOKEN });
    const texts = elementsOf(view).flatMap((element) => (element.type === "p" ? [element.props.children] : []));
    expect(texts).toEqual([es.Portal.unlinked.withInvite]);
  });
});

describe("SignInButtons", () => {
  async function html(providers: ("discord" | "google" | "test")[], inviteToken: string | null = null, locale: "es" | "pt" = "es") {
    return renderToStaticMarkup(await SignInButtons({ providers, locale, inviteToken }));
  }

  test("from a purchase screen, each link says which screen to come back to, and the link if there is one", async () => {
    const markup = renderToStaticMarkup(
      await SignInButtons({
        providers: ["discord", "google"],
        locale: "pt",
        inviteToken: null,
        checkout: { slug: "temporada-pro", linkToken: TOKEN },
      }),
    );

    expect(markup).toContain(`href="/api/portal/auth/discord?locale=pt&amp;comprar=temporada-pro&amp;link=${TOKEN}"`);
    expect(markup).toContain(`href="/api/portal/auth/google?locale=pt&amp;comprar=temporada-pro&amp;link=${TOKEN}"`);
  });

  test("a purchase screen without a link does not write an empty one", async () => {
    const markup = renderToStaticMarkup(
      await SignInButtons({
        providers: ["discord"],
        locale: "es",
        inviteToken: null,
        checkout: { slug: "vod-en-vivo", linkToken: null },
      }),
    );

    expect(markup).toContain('href="/api/portal/auth/discord?locale=es&amp;comprar=vod-en-vivo"');
    expect(markup).not.toContain("link=");
  });

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
