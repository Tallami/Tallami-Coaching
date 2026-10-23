import { count, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { registrationOptions, verifyRegistration } from "@/admin/auth/ceremonies";
import { loginIpHash } from "@/admin/auth/login-ip";
import { loadLoginStep } from "@/admin/auth/login-steps";
import { FIRST_KEY_STEP_PATH, PASSKEY_STEP_PATH } from "@/admin/auth/redirect";
import { countPasskeys, insertPasskey, listPasskeys, type Passkey } from "@/admin/auth/passkeys";
import {
  PENDING_COOKIE,
  consumePendingLogin,
  createPendingLogin,
  type PendingMode,
} from "@/admin/auth/pending-logins";
import { LOGIN_MAX_FAILURES } from "@/admin/auth/rate-limit";
import { ADMIN_COOKIE, readSessionClaims } from "@/admin/auth/session";
import { getDb, type Db } from "@/db/client";
import { adminPasskeys, adminPendingLogins, adminSessions, loginAttempts } from "@/db/schema";
import { loginAction } from "@/app/admin/login/actions";
import { beginPasskeyLoginAction, finishPasskeyLoginAction } from "@/app/admin/login/llave/actions";
import { beginFirstPasskeyAction, finishFirstPasskeyAction } from "@/app/admin/login/primera-llave/actions";
import { ADMIN_TEST_PASSWORD, ADMIN_TEST_PASSWORD_HASH, ADMIN_TEST_SESSION_SECRET } from "../helpers/admin-server";
import { createTestDb } from "../helpers/db";
import { createVirtualAuthenticator, type VirtualAuthenticator } from "../helpers/virtual-authenticator";

// El ingreso en dos pasos, de punta a punta en el servidor: la contraseña deja un
// ingreso a medio camino (sin sesión) y la llave lo convierte en sesión. Las llaves
// son de un autenticador virtual con criptografía de verdad, así la librería de
// WebAuthn verifica firmas reales y no un doble.

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
// `redirect` de Next interrumpe tirando un error; el doble hace lo mismo.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));
vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
// Fuera de un pedido de Next, `connection()` tira; acá todo es un pedido de verdad.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => undefined),
}));

const ORIGIN = "http://localhost:3100";
const SITE = { rpID: "localhost", origin: ORIGIN };
const IP = "203.0.113.50";
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MINUTE_MS = 60 * 1000;
const PENDING_PATH = "/admin/login";

const EXPIRED = { ok: false, error: "expired" } as const;
const BLOCKED = { ok: false, error: "blocked" } as const;
const FAILED = { ok: false, error: "failed" } as const;

/** Las cookies del navegador como las ve el servidor: lo que guarda un paso viaja en el siguiente. */
function createCookieJar() {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn((name: string) => (values.has(name) ? { name, value: values.get(name) } : undefined)),
    // El tercer argumento (las opciones de la cookie) queda en `mock.calls`.
    set: vi.fn((...[name, value]: [name: string, value: string, options?: unknown]) => {
      values.set(name, value);
    }),
    delete: vi.fn((options: string | { name: string; path?: string }) => {
      values.delete(typeof options === "string" ? options : options.name);
    }),
  };
}

let db: Db;
let jar = createCookieJar();

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  vi.stubEnv("ADMIN_PASSWORD_HASH", ADMIN_TEST_PASSWORD_HASH);
  vi.stubEnv("ADMIN_SESSION_SECRET", ADMIN_TEST_SESSION_SECRET);
  vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", ORIGIN);
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("DATABASE_URL", "");
  vi.mocked(getDb).mockResolvedValue(db);
  jar = createCookieJar();
  vi.mocked(cookies).mockResolvedValue(jar as never);
  vi.mocked(headers).mockResolvedValue(
    new Headers({ host: "localhost:3100", "x-forwarded-for": IP, "user-agent": CHROME_WINDOWS }) as never,
  );
  // Las ceremonias rechazadas dejan su motivo en el log; acá se rechazan a propósito.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.delete(loginAttempts);
  await db.delete(adminSessions);
  await db.delete(adminPendingLogins);
  await db.delete(adminPasskeys);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Un dispositivo con su llave ya registrada en el panel. */
async function registeredDevice(name = "Celular"): Promise<{ device: VirtualAuthenticator; passkey: Passkey }> {
  const device = createVirtualAuthenticator(SITE);
  const options = await registrationOptions([]);
  const data = await verifyRegistration(device.register(options), options.challenge);
  const passkey = data ? await insertPasskey(db, { ...data, name }, { onlyIfNone: false }) : null;
  if (!passkey) throw new Error("El registro de prueba debería haber salido bien.");
  return { device, passkey };
}

/** Un ingreso a medio camino como el que deja la contraseña, con su cookie ya en el navegador. */
async function pendingLogin(
  mode: PendingMode,
  { nextPath = "/admin", createdAt = new Date() }: { nextPath?: string; createdAt?: Date } = {},
): Promise<string> {
  const id = await createPendingLogin(
    db,
    { mode, nextPath, ipHash: loginIpHash(IP), device: "Chrome en Windows" },
    createdAt,
  );
  jar.values.set(PENDING_COOKIE, id);
  return id;
}

/** Envía la contraseña y devuelve a dónde redirigió el login. */
async function submitPassword(password: string, next?: string): Promise<string> {
  const form = new FormData();
  form.set("password", password);
  if (next) form.set("next", next);
  const error = await loginAction(form).then(
    () => new Error("el login no redirigió"),
    (thrown: unknown) => thrown as Error,
  );
  return error.message;
}

/** Pide la llave y contesta con la firma de `device`. */
async function signInWith(device: VirtualAuthenticator, counter = 1) {
  const begun = await beginPasskeyLoginAction();
  if (!begun.ok) throw new Error(`No se pudo pedir la llave: ${begun.error}`);
  const response = device.authenticate(begun.options, { counter });
  return { response, result: await finishPasskeyLoginAction(response) };
}

/** Pide registrar la primera llave y contesta con el registro de `device`. */
async function registerFirstWith(device: VirtualAuthenticator, name: string) {
  const begun = await beginFirstPasskeyAction();
  if (!begun.ok) throw new Error(`No se pudo pedir el registro: ${begun.error}`);
  const response = device.register(begun.options);
  return { response, result: await finishFirstPasskeyAction(response, name) };
}

async function failedAttempts(): Promise<number> {
  const [row] = await db.select({ total: count() }).from(loginAttempts).where(eq(loginAttempts.succeeded, false));
  return row?.total ?? 0;
}

async function sessionRows() {
  return db.select().from(adminSessions);
}

async function pendingRow(id: string) {
  const [row] = await db.select().from(adminPendingLogins).where(eq(adminPendingLogins.id, id));
  return row;
}

function cookieSets(name: string) {
  return jar.set.mock.calls.filter(([cookieName]) => cookieName === name);
}

describe("loginAction, the password step", () => {
  test("with no key registered yet, a right password leads to registering the first one, and opens no session", async () => {
    expect(await submitPassword(ADMIN_TEST_PASSWORD)).toBe("NEXT_REDIRECT /admin/login/primera-llave");

    const [pending] = await db.select().from(adminPendingLogins);
    expect(pending).toMatchObject({ mode: "first-key", nextPath: "/admin", device: "Chrome en Windows", ipHash: loginIpHash(IP) });
    expect(cookieSets(PENDING_COOKIE)).toEqual([
      [PENDING_COOKIE, pending.id, { httpOnly: true, secure: false, sameSite: "strict", path: PENDING_PATH, maxAge: 300 }],
    ]);
    expect(cookieSets(ADMIN_COOKIE)).toEqual([]);
    expect(await sessionRows()).toEqual([]);
  });

  test("with a key registered, it leads to the passkey step", async () => {
    await registeredDevice();

    expect(await submitPassword(ADMIN_TEST_PASSWORD)).toBe("NEXT_REDIRECT /admin/login/llave");

    const [pending] = await db.select().from(adminPendingLogins);
    expect(pending.mode).toBe("passkey");
    expect(cookieSets(ADMIN_COOKIE)).toEqual([]);
    expect(await sessionRows()).toEqual([]);
  });

  test("keeps where you were going in the pending login, and in the address of the step", async () => {
    await registeredDevice();

    expect(await submitPassword(ADMIN_TEST_PASSWORD, "/admin/ventas?mes=2026-10")).toBe(
      "NEXT_REDIRECT /admin/login/llave?next=%2Fadmin%2Fventas%3Fmes%3D2026-10",
    );

    const [pending] = await db.select().from(adminPendingLogins);
    expect(pending.nextPath).toBe("/admin/ventas?mes=2026-10");
  });

  test("a wrong password leaves no pending login and no cookie", async () => {
    expect(await submitPassword("incorrecta")).toBe("NEXT_REDIRECT /admin/login?error=invalid");

    expect(await db.select().from(adminPendingLogins)).toEqual([]);
    expect(jar.set).not.toHaveBeenCalled();
  });
});

describe("beginPasskeyLoginAction", () => {
  test("asks the browser for any registered key, verifying the user, and keeps the challenge in the pending login", async () => {
    const { passkey } = await registeredDevice();
    const id = await pendingLogin("passkey");

    const begun = await beginPasskeyLoginAction();

    if (!begun.ok) throw new Error(begun.error);
    expect(begun.options.rpId).toBe("localhost");
    expect(begun.options.userVerification).toBe("required");
    expect(begun.options.allowCredentials?.map((credential) => credential.id)).toEqual([passkey.credentialId]);
    expect((await pendingRow(id)).challenge).toBe(begun.options.challenge);
  });

  test("is expired without a usable pending login, or with one that is waiting for the first key", async () => {
    await registeredDevice();
    expect(await beginPasskeyLoginAction()).toEqual(EXPIRED);

    jar.values.set(PENDING_COOKIE, "no-es-un-ingreso");
    expect(await beginPasskeyLoginAction()).toEqual(EXPIRED);

    await pendingLogin("passkey", { createdAt: new Date(Date.now() - 6 * MINUTE_MS) });
    expect(await beginPasskeyLoginAction()).toEqual(EXPIRED);

    const consumed = await pendingLogin("passkey");
    await consumePendingLogin(db, consumed);
    expect(await beginPasskeyLoginAction()).toEqual(EXPIRED);

    await pendingLogin("first-key");
    expect(await beginPasskeyLoginAction()).toEqual(EXPIRED);
  });

  test("is expired when the keys were removed after the password: the login has to start over", async () => {
    await pendingLogin("passkey");

    expect(await beginPasskeyLoginAction()).toEqual(EXPIRED);
  });
});

describe("finishPasskeyLoginAction", () => {
  test("the right key opens the session, uses up the pending login and swaps the cookies", async () => {
    const { device, passkey } = await registeredDevice();
    const id = await pendingLogin("passkey", { nextPath: "/admin/facturacion" });

    const { result } = await signInWith(device);

    expect(result).toEqual({ ok: true, redirectTo: "/admin/facturacion" });
    const [session] = await sessionRows();
    expect(session).toMatchObject({ passkeyId: passkey.id, device: "Chrome en Windows", revokedAt: null });
    expect(session.reauthAt).not.toBeNull();

    const [[, token, options]] = cookieSets(ADMIN_COOKIE);
    expect(await readSessionClaims(token)).toEqual({ sessionId: session.id });
    expect(options).toEqual({ httpOnly: true, secure: false, sameSite: "strict", path: "/admin", maxAge: 8 * 60 * 60 });
    expect(jar.delete).toHaveBeenCalledWith({ name: PENDING_COOKIE, path: PENDING_PATH });
    expect(jar.values.has(PENDING_COOKIE)).toBe(false);

    expect((await pendingRow(id)).consumedAt).not.toBeNull();
    expect(await failedAttempts()).toBe(0);
    const [stored] = await listPasskeys(db);
    expect(stored.counter).toBe(1);
    expect(stored.lastUsedAt).not.toBeNull();
  });

  test("sending the same answer again opens nothing: the pending login was used up", async () => {
    const { device } = await registeredDevice();
    const id = await pendingLogin("passkey");
    const { response } = await signInWith(device);

    // Sin la cookie (el navegador la borró) y con la cookie vieja puesta a mano.
    expect(await finishPasskeyLoginAction(response)).toEqual(EXPIRED);
    jar.values.set(PENDING_COOKIE, id);
    expect(await finishPasskeyLoginAction(response)).toEqual(EXPIRED);

    expect(await sessionRows()).toHaveLength(1);
    expect(cookieSets(ADMIN_COOKIE)).toHaveLength(1);
  });

  test("is expired, without counting a failure, when there is no usable pending login", async () => {
    const { device } = await registeredDevice();
    const id = await pendingLogin("passkey");
    const begun = await beginPasskeyLoginAction();
    if (!begun.ok) throw new Error(begun.error);
    const response = device.authenticate(begun.options, { counter: 1 });

    jar.values.delete(PENDING_COOKIE);
    expect(await finishPasskeyLoginAction(response)).toEqual(EXPIRED);

    await pendingLogin("passkey", { createdAt: new Date(Date.now() - 6 * MINUTE_MS) });
    expect(await finishPasskeyLoginAction(response)).toEqual(EXPIRED);

    await pendingLogin("first-key");
    expect(await finishPasskeyLoginAction(response)).toEqual(EXPIRED);

    jar.values.set(PENDING_COOKIE, id);
    await consumePendingLogin(db, id);
    expect(await finishPasskeyLoginAction(response)).toEqual(EXPIRED);

    expect(await failedAttempts()).toBe(0);
    expect(await sessionRows()).toEqual([]);
  });

  test("a key that is not registered here fails and counts as a failed attempt", async () => {
    await registeredDevice();
    const stranger = createVirtualAuthenticator(SITE);
    const id = await pendingLogin("passkey");

    const { result } = await signInWith(stranger);

    expect(result).toEqual(FAILED);
    expect(await failedAttempts()).toBe(1);
    expect(await sessionRows()).toEqual([]);
    expect((await pendingRow(id)).consumedAt).toBeNull();
  });

  test("a signature that does not verify fails and counts as a failed attempt", async () => {
    const { device } = await registeredDevice();
    await pendingLogin("passkey");
    const begun = await beginPasskeyLoginAction();
    if (!begun.ok) throw new Error(begun.error);

    const fromElsewhere = device.authenticate(begun.options, { counter: 1, origin: "https://otro-sitio.com" });

    expect(await finishPasskeyLoginAction(fromElsewhere)).toEqual(FAILED);
    expect(await failedAttempts()).toBe(1);
    expect(await sessionRows()).toEqual([]);
  });

  test("an answer that is not a key at all fails and counts too", async () => {
    await registeredDevice();
    await pendingLogin("passkey");
    await beginPasskeyLoginAction();

    expect(await finishPasskeyLoginAction({ id: "x" })).toEqual(FAILED);
    expect(await finishPasskeyLoginAction("texto")).toEqual(FAILED);
    expect(await failedAttempts()).toBe(2);
  });

  test("after a failure the challenge is gone: the next try needs a new one", async () => {
    const { device } = await registeredDevice();
    await pendingLogin("passkey");
    const first = await beginPasskeyLoginAction();
    if (!first.ok) throw new Error(first.error);
    await finishPasskeyLoginAction(device.authenticate(first.options, { counter: 1, origin: "https://otro-sitio.com" }));

    // Una firma buena sobre el desafío ya gastado no sirve.
    expect(await finishPasskeyLoginAction(device.authenticate(first.options, { counter: 1 }))).toEqual(FAILED);

    const { result } = await signInWith(device, 2);
    expect(result).toMatchObject({ ok: true });
  });

  test("the fifth failure blocks: the next begin and finish say blocked, even with the right key", async () => {
    const { device } = await registeredDevice();
    const stranger = createVirtualAuthenticator(SITE);
    await pendingLogin("passkey");

    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      expect((await signInWith(stranger)).result).toEqual(FAILED);
    }
    const begun = await beginPasskeyLoginAction();

    expect(begun).toEqual(BLOCKED);
    expect(await finishPasskeyLoginAction(device.authenticate({ challenge: "x", rpId: "localhost" }, { counter: 1 }))).toEqual(BLOCKED);
    expect(await failedAttempts()).toBe(LOGIN_MAX_FAILURES);
    expect(await sessionRows()).toEqual([]);
  });

  test("a wrong password counts toward the same limit as a wrong key", async () => {
    await registeredDevice();
    const stranger = createVirtualAuthenticator(SITE);
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES - 1; attempt += 1) {
      await submitPassword("incorrecta");
    }
    await pendingLogin("passkey");

    expect((await signInWith(stranger)).result).toEqual(FAILED);

    expect(await beginPasskeyLoginAction()).toEqual(BLOCKED);
  });
});

describe("loadLoginStep, what the pages of the second step show", () => {
  /** Lo que hace la página: lo que devuelve, o a dónde redirige. */
  async function load(page: string, next?: string): Promise<string | object> {
    return loadLoginStep(page, next).catch((thrown: Error) => thrown.message);
  }

  test("without a pending login or a session, it goes back to the login saying it expired, keeping the destination", async () => {
    expect(await load(PASSKEY_STEP_PATH, "/admin/ventas")).toBe(
      "NEXT_REDIRECT /admin/login?next=%2Fadmin%2Fventas&error=expired",
    );
    expect(await load(FIRST_KEY_STEP_PATH)).toBe("NEXT_REDIRECT /admin/login?error=expired");
    expect(await load(PASSKEY_STEP_PATH, "//otro-sitio.com")).toBe("NEXT_REDIRECT /admin/login?error=expired");
  });

  test("an expired or used pending login is the same as none", async () => {
    await pendingLogin("passkey", { createdAt: new Date(Date.now() - 6 * MINUTE_MS) });
    expect(await load(PASSKEY_STEP_PATH)).toBe("NEXT_REDIRECT /admin/login?error=expired");

    const used = await pendingLogin("passkey");
    await consumePendingLogin(db, used);
    expect(await load(PASSKEY_STEP_PATH)).toBe("NEXT_REDIRECT /admin/login?error=expired");
  });

  test("a pending login of this page shows the step", async () => {
    const id = await pendingLogin("passkey", { nextPath: "/admin/ventas" });

    expect(await load(PASSKEY_STEP_PATH)).toMatchObject({ kind: "step", pending: { id, nextPath: "/admin/ventas" } });
  });

  test("a pending login of the other kind goes to its own page, keeping the destination", async () => {
    await pendingLogin("first-key", { nextPath: "/admin/ventas" });
    expect(await load(PASSKEY_STEP_PATH)).toBe("NEXT_REDIRECT /admin/login/primera-llave?next=%2Fadmin%2Fventas");

    await pendingLogin("passkey");
    expect(await load(FIRST_KEY_STEP_PATH)).toBe("NEXT_REDIRECT /admin/login/llave");
  });

  test("with the session already open and no pending login, it says so instead of redirecting", async () => {
    // Es lo que se dibuja en la respuesta de la acción que abrió la sesión: una redirección competiría con la del navegador.
    const { device } = await registeredDevice();
    await pendingLogin("passkey");
    await signInWith(device);
    jar.values.set(ADMIN_COOKIE, cookieSets(ADMIN_COOKIE)[0][1]);

    expect(await load(PASSKEY_STEP_PATH)).toEqual({ kind: "signed-in" });
    expect(await load(FIRST_KEY_STEP_PATH)).toEqual({ kind: "signed-in" });
  });

  test("waits for a real request before touching the database, so the prerender of a prefetch stops before it", async () => {
    await pendingLogin("passkey");
    vi.mocked(connection).mockClear();
    vi.mocked(getDb).mockClear();

    await load(PASSKEY_STEP_PATH);

    const [waited] = vi.mocked(connection).mock.invocationCallOrder;
    const [opened] = vi.mocked(getDb).mock.invocationCallOrder;
    expect(waited).toBeLessThan(opened);
  });

  test("an unconfigured panel goes to the setup page", async () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "");
    await pendingLogin("passkey");

    expect(await load(PASSKEY_STEP_PATH)).toBe("NEXT_REDIRECT /admin/setup");
  });
});

describe("the first key", () => {
  test("begin asks to create a key that verifies the user, and keeps the challenge", async () => {
    const id = await pendingLogin("first-key");

    const begun = await beginFirstPasskeyAction();

    if (!begun.ok) throw new Error(begun.error);
    expect(begun.options.rp.id).toBe("localhost");
    expect(begun.options.authenticatorSelection?.userVerification).toBe("required");
    expect(begun.options.excludeCredentials).toEqual([]);
    expect((await pendingRow(id)).challenge).toBe(begun.options.challenge);
  });

  test("begin is expired for a login that is waiting for a passkey, or when a key already exists", async () => {
    expect(await beginFirstPasskeyAction()).toEqual(EXPIRED);

    await pendingLogin("passkey");
    expect(await beginFirstPasskeyAction()).toEqual(EXPIRED);

    await pendingLogin("first-key");
    await registeredDevice();
    expect(await beginFirstPasskeyAction()).toEqual(EXPIRED);
  });

  test("begin is blocked after five failures", async () => {
    await db
      .insert(loginAttempts)
      .values(Array.from({ length: LOGIN_MAX_FAILURES }, () => ({ ipHash: loginIpHash(IP), succeeded: false, createdAt: new Date() })));
    await pendingLogin("first-key");

    expect(await beginFirstPasskeyAction()).toEqual(BLOCKED);
  });

  test("finishing registers the key with its name, opens the session with it and swaps the cookies", async () => {
    const id = await pendingLogin("first-key", { nextPath: "/admin/ventas" });
    const device = createVirtualAuthenticator(SITE);

    const { result } = await registerFirstWith(device, "  PC de escritorio  ");

    expect(result).toEqual({ ok: true, redirectTo: "/admin/ventas" });
    const [passkey] = await listPasskeys(db);
    expect(passkey).toMatchObject({ name: "PC de escritorio", credentialId: device.credentialId });
    const [session] = await sessionRows();
    expect(session.passkeyId).toBe(passkey.id);
    expect(session.reauthAt).not.toBeNull();
    const [[, token]] = cookieSets(ADMIN_COOKIE);
    expect(await readSessionClaims(token)).toEqual({ sessionId: session.id });
    expect(jar.delete).toHaveBeenCalledWith({ name: PENDING_COOKIE, path: PENDING_PATH });
    expect((await pendingRow(id)).consumedAt).not.toBeNull();
    expect(await failedAttempts()).toBe(0);
  });

  test("if another tab registered the first key meanwhile, it is expired and no second key is added", async () => {
    await pendingLogin("first-key");
    const begun = await beginFirstPasskeyAction();
    if (!begun.ok) throw new Error(begun.error);
    const { passkey: winner } = await registeredDevice("Celular");

    const late = createVirtualAuthenticator(SITE);
    const result = await finishFirstPasskeyAction(late.register(begun.options), "Notebook");

    expect(result).toEqual(EXPIRED);
    expect(await countPasskeys(db)).toBe(1);
    expect((await listPasskeys(db))[0].id).toBe(winner.id);
    expect(await sessionRows()).toEqual([]);
    expect(cookieSets(ADMIN_COOKIE)).toEqual([]);
  });

  test("a registration that does not verify fails, counts, and adds no key", async () => {
    await pendingLogin("first-key");
    const begun = await beginFirstPasskeyAction();
    if (!begun.ok) throw new Error(begun.error);
    const device = createVirtualAuthenticator(SITE);

    const result = await finishFirstPasskeyAction(device.register(begun.options, { origin: "https://otro-sitio.com" }), "PC");

    expect(result).toEqual(FAILED);
    expect(await failedAttempts()).toBe(1);
    expect(await countPasskeys(db)).toBe(0);
    expect(await sessionRows()).toEqual([]);
  });

  test("a name that is empty, too long or not a text is refused before anything is checked", async () => {
    await pendingLogin("first-key");
    const begun = await beginFirstPasskeyAction();
    if (!begun.ok) throw new Error(begun.error);
    const response = createVirtualAuthenticator(SITE).register(begun.options);

    for (const name of ["", "   ", "x".repeat(41), 42 as unknown as string]) {
      expect(await finishFirstPasskeyAction(response, name), String(name)).toEqual(FAILED);
    }

    expect(await countPasskeys(db)).toBe(0);
    expect(await failedAttempts()).toBe(0);
    // El desafío sigue ahí: con un nombre válido, el mismo registro entra.
    expect(await finishFirstPasskeyAction(response, "x".repeat(40))).toMatchObject({ ok: true });
  });

  test("finishing is expired for a login that is waiting for a passkey", async () => {
    await registeredDevice();
    await pendingLogin("passkey");

    const result = await finishFirstPasskeyAction(createVirtualAuthenticator(SITE).register(await registrationOptions([])), "PC");

    expect(result).toEqual(EXPIRED);
    expect(await countPasskeys(db)).toBe(1);
  });
});
