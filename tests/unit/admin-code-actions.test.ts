import { count, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { registrationOptions, verifyRegistration } from "@/admin/auth/ceremonies";
import { generateEnrollmentCode, redeemEnrollmentCode } from "@/admin/auth/enrollment-codes";
import { loginIpHash } from "@/admin/auth/login-ip";
import { countPasskeys, insertPasskey, listPasskeys, type Passkey } from "@/admin/auth/passkeys";
import {
  PENDING_COOKIE,
  consumePendingLogin,
  createPendingLogin,
  type PendingMode,
} from "@/admin/auth/pending-logins";
import { LOGIN_MAX_FAILURES } from "@/admin/auth/rate-limit";
import { ADMIN_COOKIE, readSessionClaims } from "@/admin/auth/session";
import { createSession, revokeSession } from "@/admin/auth/sessions";
import { getDb, type Db } from "@/db/client";
import { adminEnrollmentCodes, adminPasskeys, adminPendingLogins, adminSessions, loginAttempts } from "@/db/schema";
import {
  beginCodePasskeyAction,
  finishCodePasskeyAction,
  redeemCodeAction,
} from "@/app/admin/login/llave/code-actions";
import { ADMIN_TEST_PASSWORD_HASH, ADMIN_TEST_SESSION_SECRET } from "../helpers/admin-server";
import { createCookieJar } from "../helpers/cookie-jar";
import { createTestDb } from "../helpers/db";
import { createVirtualAuthenticator, type VirtualAuthenticator } from "../helpers/virtual-authenticator";

// El código para registrar la llave de otro dispositivo, de punta a punta en el
// servidor: después de la contraseña, canjear el código cambia el ingreso a medio
// camino a "código" y recién ahí se puede registrar la llave del dispositivo nuevo.
// Estas acciones son puertas del panel (sin `requireAdmin()`): su verificación es el
// ingreso a medio camino de la cookie, igual que las del segundo paso.

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
const IP = "203.0.113.60";
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const MINUTE_MS = 60 * 1000;
const PENDING_PATH = "/admin/login";

const EXPIRED = { ok: false, error: "expired" } as const;
const BLOCKED = { ok: false, error: "blocked" } as const;
const FAILED = { ok: false, error: "failed" } as const;

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
  await db.delete(adminEnrollmentCodes);
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

/** Un código recién generado en una sesión abierta con la llave `passkey`, tal como se lo ve en pantalla. */
async function freshCode(passkey: Passkey, at: Date = new Date()): Promise<{ code: string; sessionId: string }> {
  const sessionId = await createSession(db, { passkeyId: passkey.id, device: "Chrome en Windows", reauthed: true }, at);
  const code = await generateEnrollmentCode(db, sessionId, at);
  return { code: `${code.slice(0, 5)}-${code.slice(5)}`, sessionId };
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

async function pendingRow(id: string) {
  const [row] = await db.select().from(adminPendingLogins).where(eq(adminPendingLogins.id, id));
  return row;
}

async function failedAttempts(): Promise<number> {
  const [row] = await db.select({ total: count() }).from(loginAttempts).where(eq(loginAttempts.succeeded, false));
  return row?.total ?? 0;
}

async function sessionRows() {
  return db.select().from(adminSessions);
}

/** ¿Sigue valiendo el código? Probarlo lo gasta: se llama al final de cada test que lo necesita. */
async function codeStillWorks(code: string): Promise<boolean> {
  return redeemEnrollmentCode(db, code);
}

function cookieSets(name: string) {
  return jar.set.mock.calls.filter(([cookieName]) => cookieName === name);
}

describe("redeemCodeAction", () => {
  test("a right code turns the login into one that registers a key, burns the code and counts no failure", async () => {
    const { passkey } = await registeredDevice();
    const { code } = await freshCode(passkey);
    const id = await pendingLogin("passkey");

    const result = await redeemCodeAction(code);

    expect(result).toEqual({ ok: true });
    expect(await pendingRow(id)).toMatchObject({ mode: "code", challenge: null, consumedAt: null });
    expect(await codeStillWorks(code)).toBe(false);
    expect(await failedAttempts()).toBe(0);
    // Canjear el código no abre ninguna sesión por sí solo.
    expect(await sessionRows()).toHaveLength(1);
    expect(cookieSets(ADMIN_COOKIE)).toEqual([]);
  });

  test("takes the code as it is typed: lowercase, with spaces, or without the dash", async () => {
    const { passkey } = await registeredDevice();
    const { code } = await freshCode(passkey);
    await pendingLogin("passkey");

    expect(await redeemCodeAction(`  ${code.toLowerCase().replace("-", " ")} `)).toEqual({ ok: true });
  });

  test("a wrong code fails, counts as a failed attempt and leaves the login as it was", async () => {
    const { passkey } = await registeredDevice();
    const { code } = await freshCode(passkey);
    const id = await pendingLogin("passkey");

    expect(await redeemCodeAction("AAAAA-AAAAA")).toEqual(FAILED);

    expect(await failedAttempts()).toBe(1);
    expect(await pendingRow(id)).toMatchObject({ mode: "passkey", consumedAt: null });
    // Y el código bueno sigue sirviendo.
    expect(await redeemCodeAction(code)).toEqual({ ok: true });
  });

  test.each([
    ["empty", ""],
    ["too short", "ABC"],
    ["with letters that are not in the alphabet", "0O1I0-O1I0O"],
    ["too long", "A".repeat(5000)],
    ["not a text", 42 as unknown as string],
  ])("a code that is %s fails and counts too", async (_label, code) => {
    await registeredDevice();
    await pendingLogin("passkey");

    expect(await redeemCodeAction(code)).toEqual(FAILED);

    expect(await failedAttempts()).toBe(1);
  });

  test("a code that expired fails and counts", async () => {
    const { passkey } = await registeredDevice();
    const { code } = await freshCode(passkey, new Date(Date.now() - 11 * MINUTE_MS));
    await pendingLogin("passkey");

    expect(await redeemCodeAction(code)).toEqual(FAILED);

    expect(await failedAttempts()).toBe(1);
  });

  test("a code from a session that was closed fails and counts: it died with it", async () => {
    const { passkey } = await registeredDevice();
    const { code, sessionId } = await freshCode(passkey);
    await revokeSession(db, sessionId);
    await pendingLogin("passkey");

    expect(await redeemCodeAction(code)).toEqual(FAILED);

    expect(await failedAttempts()).toBe(1);
  });

  test("a code is good for one device only", async () => {
    const { passkey } = await registeredDevice();
    const { code } = await freshCode(passkey);
    await pendingLogin("passkey");
    expect(await redeemCodeAction(code)).toEqual({ ok: true });

    await pendingLogin("passkey");

    expect(await redeemCodeAction(code)).toEqual(FAILED);
  });

  test("after the fifth failure even the right code is refused, and it is not burned", async () => {
    const { passkey } = await registeredDevice();
    const { code } = await freshCode(passkey);
    const id = await pendingLogin("passkey");
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      expect(await redeemCodeAction("AAAAA-AAAAA")).toEqual(FAILED);
    }

    expect(await redeemCodeAction(code)).toEqual(BLOCKED);

    expect(await pendingRow(id)).toMatchObject({ mode: "passkey" });
    expect(await codeStillWorks(code)).toBe(true);
  });

  test("a burst of guesses at the same time tries no more than five", async () => {
    await registeredDevice();
    await pendingLogin("passkey");

    const results = await Promise.all(Array.from({ length: 12 }, () => redeemCodeAction("AAAAA-AAAAA")));

    // Cada pedido reserva su lugar antes de mirar el código: los que llegan juntos se cuentan entre sí.
    const tried = results.filter((result) => !result.ok && result.error === "failed").length;
    const refused = results.filter((result) => !result.ok && result.error === "blocked").length;
    expect(tried).toBeLessThanOrEqual(LOGIN_MAX_FAILURES);
    expect(tried + refused).toBe(12);
  });

  test("two simultaneous right codes cannot both turn the login", async () => {
    const { passkey } = await registeredDevice();
    const { code } = await freshCode(passkey);
    await pendingLogin("passkey");

    const results = await Promise.all([redeemCodeAction(code), redeemCodeAction(code)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  test("is expired for a login that is waiting for the first key, and the code is not touched", async () => {
    const { passkey } = await registeredDevice();
    const { code } = await freshCode(passkey);
    await pendingLogin("first-key");

    expect(await redeemCodeAction(code)).toEqual(EXPIRED);

    expect(await failedAttempts()).toBe(0);
    expect(await codeStillWorks(code)).toBe(true);
  });

  test("is expired for a login that already redeemed a code", async () => {
    const { passkey } = await registeredDevice();
    const { code } = await freshCode(passkey);
    await pendingLogin("code");

    expect(await redeemCodeAction(code)).toEqual(EXPIRED);

    expect(await codeStillWorks(code)).toBe(true);
  });

  test("is expired, without counting a failure, when there is no usable login", async () => {
    const { passkey } = await registeredDevice();
    const { code } = await freshCode(passkey);
    expect(await redeemCodeAction(code)).toEqual(EXPIRED);

    jar.values.set(PENDING_COOKIE, "no-es-un-ingreso");
    expect(await redeemCodeAction(code)).toEqual(EXPIRED);

    await pendingLogin("passkey", { createdAt: new Date(Date.now() - 6 * MINUTE_MS) });
    expect(await redeemCodeAction(code)).toEqual(EXPIRED);

    const used = await pendingLogin("passkey");
    await consumePendingLogin(db, used);
    expect(await redeemCodeAction(code)).toEqual(EXPIRED);

    expect(await failedAttempts()).toBe(0);
    expect(await codeStillWorks(code)).toBe(true);
  });
});

describe("beginCodePasskeyAction", () => {
  test("asks to create a key that verifies the user, skipping the registered ones, and keeps the challenge", async () => {
    const { passkey } = await registeredDevice();
    const id = await pendingLogin("code");

    const begun = await beginCodePasskeyAction();

    if (!begun.ok) throw new Error(begun.error);
    expect(begun.options.rp.id).toBe("localhost");
    expect(begun.options.authenticatorSelection?.userVerification).toBe("required");
    expect(begun.options.excludeCredentials?.map((credential) => credential.id)).toEqual([passkey.credentialId]);
    expect((await pendingRow(id)).challenge).toBe(begun.options.challenge);
  });

  test("is expired unless the code was redeemed", async () => {
    await registeredDevice();
    expect(await beginCodePasskeyAction()).toEqual(EXPIRED);

    await pendingLogin("passkey");
    expect(await beginCodePasskeyAction()).toEqual(EXPIRED);

    await pendingLogin("first-key");
    expect(await beginCodePasskeyAction()).toEqual(EXPIRED);

    await pendingLogin("code", { createdAt: new Date(Date.now() - 6 * MINUTE_MS) });
    expect(await beginCodePasskeyAction()).toEqual(EXPIRED);
  });

  test("is blocked after five failures", async () => {
    await db
      .insert(loginAttempts)
      .values(Array.from({ length: LOGIN_MAX_FAILURES }, () => ({ ipHash: loginIpHash(IP), succeeded: false, createdAt: new Date() })));
    await pendingLogin("code");

    expect(await beginCodePasskeyAction()).toEqual(BLOCKED);
  });
});

describe("finishCodePasskeyAction", () => {
  /** Del lado del dispositivo nuevo: contraseña ya puesta, código canjeado, y las opciones para crear su llave. */
  async function redeemedLogin(nextPath = "/admin") {
    const { passkey } = await registeredDevice("Celular");
    const { code } = await freshCode(passkey);
    const id = await pendingLogin("passkey", { nextPath });
    expect(await redeemCodeAction(code)).toEqual({ ok: true });
    const begun = await beginCodePasskeyAction();
    if (!begun.ok) throw new Error(begun.error);
    return { id, begun, passkey };
  }

  test("registers the key of the new device next to the others and opens the session with it", async () => {
    const { id, begun, passkey } = await redeemedLogin("/admin/facturacion");
    const desktop = createVirtualAuthenticator(SITE);

    const result = await finishCodePasskeyAction(desktop.register(begun.options), "  PC de escritorio  ");

    expect(result).toEqual({ ok: true, redirectTo: "/admin/facturacion" });
    const keys = await listPasskeys(db);
    expect(keys.map((key) => key.name).sort()).toEqual(["Celular", "PC de escritorio"]);
    expect(keys.some((key) => key.id === passkey.id)).toBe(true);
    const added = keys.find((key) => key.name === "PC de escritorio");
    expect(added?.credentialId).toBe(desktop.credentialId);

    const opened = (await sessionRows()).filter((session) => session.passkeyId === added?.id);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ device: "Chrome en Windows", revokedAt: null });
    expect(opened[0].reauthAt).not.toBeNull();
    const [[, token, options]] = cookieSets(ADMIN_COOKIE);
    expect(await readSessionClaims(token)).toEqual({ sessionId: opened[0].id });
    expect(options).toEqual({ httpOnly: true, secure: false, sameSite: "strict", path: "/admin", maxAge: 8 * 60 * 60 });
    expect(jar.delete).toHaveBeenCalledWith({ name: PENDING_COOKIE, path: PENDING_PATH });
    expect((await pendingRow(id)).consumedAt).not.toBeNull();
    expect(await failedAttempts()).toBe(0);
  });

  test("the same answer opens nothing twice: the login was used up", async () => {
    const { id, begun } = await redeemedLogin();
    const answer = createVirtualAuthenticator(SITE).register(begun.options);
    expect(await finishCodePasskeyAction(answer, "PC")).toMatchObject({ ok: true });

    jar.values.set(PENDING_COOKIE, id);

    expect(await finishCodePasskeyAction(answer, "PC otra vez")).toEqual(EXPIRED);
    expect(await countPasskeys(db)).toBe(2);
    expect(cookieSets(ADMIN_COOKIE)).toHaveLength(1);
  });

  test("without redeeming a code first it is expired and registers nothing, even with a good answer", async () => {
    await registeredDevice();
    await pendingLogin("passkey");
    const options = await registrationOptions([]);
    const answer = createVirtualAuthenticator(SITE).register(options);

    expect(await finishCodePasskeyAction(answer, "PC")).toEqual(EXPIRED);

    expect(await countPasskeys(db)).toBe(1);
    expect(await sessionRows()).toEqual([]);
    expect(await failedAttempts()).toBe(0);
  });

  test("a login waiting for the first key cannot use it either", async () => {
    await pendingLogin("first-key");
    const options = await registrationOptions([]);

    expect(await finishCodePasskeyAction(createVirtualAuthenticator(SITE).register(options), "PC")).toEqual(EXPIRED);

    expect(await countPasskeys(db)).toBe(0);
  });

  test("a registration that does not verify fails, counts, adds no key and lets you ask again", async () => {
    const { begun } = await redeemedLogin();
    const device = createVirtualAuthenticator(SITE);

    const result = await finishCodePasskeyAction(device.register(begun.options, { origin: "https://otro-sitio.com" }), "PC");

    expect(result).toEqual(FAILED);
    expect(await failedAttempts()).toBe(1);
    expect(await countPasskeys(db)).toBe(1);
    expect(await sessionRows()).toHaveLength(1);
    // El código ya se gastó, pero el ingreso sigue: se pide otro desafío y se vuelve a intentar.
    const again = await beginCodePasskeyAction();
    if (!again.ok) throw new Error(again.error);
    expect(await finishCodePasskeyAction(device.register(again.options), "PC")).toMatchObject({ ok: true });
  });

  test("a name that is empty, too long or not a text is refused before anything is checked", async () => {
    const { begun } = await redeemedLogin();
    const answer = createVirtualAuthenticator(SITE).register(begun.options);

    for (const name of ["", "   ", "x".repeat(41), 42 as unknown as string]) {
      expect(await finishCodePasskeyAction(answer, name), String(name)).toEqual(FAILED);
    }

    expect(await countPasskeys(db)).toBe(1);
    expect(await failedAttempts()).toBe(0);
    // El desafío sigue ahí: con un nombre válido, el mismo registro entra.
    expect(await finishCodePasskeyAction(answer, "x".repeat(40))).toMatchObject({ ok: true });
  });

  test("the key of a device that is already registered is refused and nothing is saved", async () => {
    const { passkey, device } = await registeredDevice("Celular");
    const { code } = await freshCode(passkey);
    await pendingLogin("passkey");
    expect(await redeemCodeAction(code)).toEqual({ ok: true });
    const begun = await beginCodePasskeyAction();
    if (!begun.ok) throw new Error(begun.error);

    await expect(finishCodePasskeyAction(device.register(begun.options), "Otra vez")).rejects.toThrow();

    expect(await countPasskeys(db)).toBe(1);
  });
});
