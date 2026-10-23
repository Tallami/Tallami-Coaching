import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { after } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { notifySecurityEvent } from "@/admin/alerts/notify";
import { registrationOptions, verifyRegistration } from "@/admin/auth/ceremonies";
import { generateEnrollmentCode } from "@/admin/auth/enrollment-codes";
import { loginIpHash } from "@/admin/auth/login-ip";
import { countPasskeys, insertPasskey, listPasskeys, type Passkey } from "@/admin/auth/passkeys";
import { PENDING_COOKIE, createPendingLogin, type PendingMode } from "@/admin/auth/pending-logins";
import { LOGIN_MAX_FAILURES } from "@/admin/auth/rate-limit";
import { ADMIN_COOKIE, createSessionToken } from "@/admin/auth/session";
import { createSession } from "@/admin/auth/sessions";
import { getDb, type Db } from "@/db/client";
import { adminEnrollmentCodes, adminPasskeys, adminPendingLogins, adminSessions, loginAttempts } from "@/db/schema";
import {
  beginAddPasskeyAction,
  closeAllSessionsAction,
  deletePasskeyAction,
  finishAddPasskeyAction,
  generateEnrollmentCodeAction,
  renamePasskeyAction,
} from "@/app/admin/configuracion/seguridad/actions";
import { loginAction } from "@/app/admin/login/actions";
import { beginPasskeyLoginAction, finishPasskeyLoginAction } from "@/app/admin/login/llave/actions";
import {
  beginCodePasskeyAction,
  finishCodePasskeyAction,
  redeemCodeAction,
} from "@/app/admin/login/llave/code-actions";
import { beginFirstPasskeyAction, finishFirstPasskeyAction } from "@/app/admin/login/primera-llave/actions";
import { ADMIN_TEST_PASSWORD, ADMIN_TEST_PASSWORD_HASH, ADMIN_TEST_SESSION_SECRET } from "../helpers/admin-server";
import { createCookieJar } from "../helpers/cookie-jar";
import { createTestDb } from "../helpers/db";
import { createVirtualAuthenticator, type VirtualAuthenticator } from "../helpers/virtual-authenticator";

// Qué aviso sale de cada camino del panel. `notifySecurityEvent` es un espía que además
// hace lo de siempre (programar el envío con `after()`), así se mira qué se avisó y
// también que un envío roto no toca el ingreso. Los avisos no salen a ningún lado: por
// defecto no hay clave de Resend, y en el test del envío roto el SDK es un doble.

const scheduled = vi.hoisted(() => [] as Array<() => Promise<void>>);
const sdk = vi.hoisted(() => ({ send: vi.fn() }));

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
// Fuera de un pedido de Next, `connection()` y `after()` tiran; acá todo es un pedido de verdad y lo
// que se programa con `after()` se guarda para correrlo cuando el test quiera (`runScheduled`).
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => undefined),
  after: vi.fn((task: () => Promise<void>) => {
    scheduled.push(task);
  }),
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sdk.send };
  },
}));
vi.mock("@/admin/alerts/notify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/admin/alerts/notify")>();
  return { ...actual, notifySecurityEvent: vi.fn(actual.notifySecurityEvent) };
});

const ORIGIN = "http://localhost:3100";
const SITE = { rpID: "localhost", origin: ORIGIN };
const IP = "203.0.113.70";
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const DEVICE = "Chrome en Windows";

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
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("ADMIN_ALERT_EMAIL", "");
  vi.stubEnv("ADMIN_ALERT_FROM", "");
  vi.mocked(getDb).mockResolvedValue(db);
  jar = createCookieJar();
  vi.mocked(cookies).mockResolvedValue(jar as never);
  vi.mocked(headers).mockResolvedValue(
    new Headers({ host: "localhost:3100", "x-forwarded-for": IP, "user-agent": CHROME_WINDOWS }) as never,
  );
  scheduled.length = 0;
  vi.mocked(after).mockImplementation((task) => {
    scheduled.push(task as () => Promise<void>);
  });
  sdk.send.mockReset();
  sdk.send.mockResolvedValue({ data: { id: "correo-1" }, error: null, headers: null });
  vi.mocked(notifySecurityEvent).mockClear();
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

/** Lo que se avisó desde el último `mockClear`: el evento, y los datos extra si los hubo. */
function notices(): Array<[string] | [string, Record<string, unknown>]> {
  return vi.mocked(notifySecurityEvent).mock.calls.map(([event, extra]) => (extra ? [event, extra] : [event]));
}

/** Solo los eventos, en orden. */
function events(): string[] {
  return notices().map(([event]) => event);
}

/** Corre lo que se programó con `after()`, como hace Next cuando ya contestó. */
async function runScheduled(): Promise<void> {
  await Promise.all(scheduled.splice(0).map((task) => task()));
}

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
async function pendingLogin(mode: PendingMode): Promise<string> {
  const id = await createPendingLogin(db, { mode, nextPath: "/admin", ipHash: loginIpHash(IP), device: DEVICE });
  jar.values.set(PENDING_COOKIE, id);
  return id;
}

/** Envía una contraseña por el formulario del login y devuelve a dónde redirigió. */
async function submitPassword(password: string): Promise<string> {
  const form = new FormData();
  form.set("password", password);
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
  return finishPasskeyLoginAction(device.authenticate(begun.options, { counter }));
}

/** Una sesión de Tallami con la llave `passkey`, confirmada hace un momento, con su cookie ya puesta. */
async function signedIn(passkey: Passkey): Promise<string> {
  const id = await createSession(db, { passkeyId: passkey.id, device: DEVICE, reauthed: true });
  jar.values.set(ADMIN_COOKIE, await createSessionToken(id));
  return id;
}

async function sessionCount(): Promise<number> {
  return (await db.select().from(adminSessions)).length;
}

describe("the sign-in notices", () => {
  test("a sign-in with a registered key notifies one login", async () => {
    const { device } = await registeredDevice();
    await pendingLogin("passkey");

    const result = await signInWith(device);

    expect(result).toEqual({ ok: true, redirectTo: "/admin" });
    expect(notices()).toEqual([["login"]]);
  });

  test("the first key notifies the first key, with its name, and not a second 'login' for the same sign-in", async () => {
    const device = createVirtualAuthenticator(SITE);
    await pendingLogin("first-key");
    const begun = await beginFirstPasskeyAction();
    if (!begun.ok) throw new Error(begun.error);

    const result = await finishFirstPasskeyAction(device.register(begun.options), "PC de escritorio");

    expect(result).toEqual({ ok: true, redirectTo: "/admin" });
    expect(notices()).toEqual([["first-passkey", { passkeyName: "PC de escritorio" }]]);
  });

  test("a key registered with a code notifies the new key and then the sign-in", async () => {
    const { passkey } = await registeredDevice();
    const generator = await createSession(db, { passkeyId: passkey.id, device: DEVICE, reauthed: true });
    const code = await generateEnrollmentCode(db, generator);
    await pendingLogin("passkey");
    expect(await redeemCodeAction(code)).toEqual({ ok: true });
    const device = createVirtualAuthenticator(SITE);
    const begun = await beginCodePasskeyAction();
    if (!begun.ok) throw new Error(begun.error);

    const result = await finishCodePasskeyAction(device.register(begun.options), "Notebook");

    expect(result.ok).toBe(true);
    expect(notices()).toEqual([["passkey-added", { passkeyName: "Notebook" }], ["login"]]);
    expect(await countPasskeys(db)).toBe(2);
  });

  test("nothing is notified when the second step fails or has expired", async () => {
    await registeredDevice();
    const stranger = createVirtualAuthenticator(SITE);
    await pendingLogin("passkey");

    expect(await signInWith(stranger)).toEqual({ ok: false, error: "failed" });
    jar.values.delete(PENDING_COOKIE);
    expect(await finishPasskeyLoginAction({})).toEqual({ ok: false, error: "expired" });

    expect(notices()).toEqual([]);
    expect(await sessionCount()).toBe(0);
  });

  test("a right password alone notifies nothing: the sign-in is not done until the key", async () => {
    await registeredDevice();

    expect(await submitPassword(ADMIN_TEST_PASSWORD)).toBe("NEXT_REDIRECT /admin/login/llave");

    expect(notices()).toEqual([]);
  });
});

describe("the blocked-sign-in notice", () => {
  test("five wrong passwords notify one block, at the fifth, and the attempts the block refuses add none", async () => {
    for (let attempt = 1; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      expect(await submitPassword("incorrecta")).toBe("NEXT_REDIRECT /admin/login?error=invalid");
    }
    expect(events()).toEqual([]);

    expect(await submitPassword("incorrecta")).toBe("NEXT_REDIRECT /admin/login?error=invalid");
    expect(events()).toEqual(["login-blocked"]);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await submitPassword("incorrecta")).toBe("NEXT_REDIRECT /admin/login?error=blocked");
    }
    expect(events()).toEqual(["login-blocked"]);
  });

  test("the failures of another connection do not add up to a block", async () => {
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES - 1; attempt += 1) await submitPassword("incorrecta");
    vi.mocked(headers).mockResolvedValue(
      new Headers({ host: "localhost:3100", "x-forwarded-for": "198.51.100.9", "user-agent": CHROME_WINDOWS }) as never,
    );

    await submitPassword("incorrecta");

    expect(events()).toEqual([]);
  });

  test("five keys that do not fit notify one block", async () => {
    await registeredDevice();
    const stranger = createVirtualAuthenticator(SITE);
    await pendingLogin("passkey");

    for (let attempt = 1; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      expect(await signInWith(stranger)).toEqual({ ok: false, error: "failed" });
    }
    expect(events()).toEqual([]);
    expect(await signInWith(stranger)).toEqual({ ok: false, error: "failed" });
    expect(events()).toEqual(["login-blocked"]);

    // Ya bloqueado: ni siquiera se pide la llave, y no hay otro aviso.
    expect(await beginPasskeyLoginAction()).toEqual({ ok: false, error: "blocked" });
    expect(events()).toEqual(["login-blocked"]);
  });

  test("five wrong codes notify one block", async () => {
    await registeredDevice();
    await pendingLogin("passkey");

    for (let attempt = 1; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      expect(await redeemCodeAction("AAAAA-AAAAA")).toEqual({ ok: false, error: "failed" });
    }
    expect(events()).toEqual([]);
    expect(await redeemCodeAction("AAAAA-AAAAA")).toEqual({ ok: false, error: "failed" });
    expect(events()).toEqual(["login-blocked"]);
    expect(await redeemCodeAction("AAAAA-AAAAA")).toEqual({ ok: false, error: "blocked" });
    expect(events()).toEqual(["login-blocked"]);
  });

  test("failures of different kinds add up: three passwords and two keys are one block", async () => {
    await registeredDevice();
    const stranger = createVirtualAuthenticator(SITE);
    for (let attempt = 0; attempt < 3; attempt += 1) await submitPassword("incorrecta");
    await pendingLogin("passkey");

    await signInWith(stranger);
    expect(events()).toEqual([]);
    await signInWith(stranger);

    expect(events()).toEqual(["login-blocked"]);
  });
});

describe("the notices of Configuración → Seguridad", () => {
  test("adding a key notifies it with its name", async () => {
    const { passkey } = await registeredDevice();
    await signedIn(passkey);
    const begun = await beginAddPasskeyAction();
    if (!begun.ok) throw new Error(begun.error);

    const result = await finishAddPasskeyAction(createVirtualAuthenticator(SITE).register(begun.options), "Notebook");

    expect(result).toEqual({ ok: true });
    expect(notices()).toEqual([["passkey-added", { passkeyName: "Notebook" }]]);
  });

  test("deleting a key notifies it with the name it had", async () => {
    const { passkey } = await registeredDevice("PC");
    const { passkey: lost } = await registeredDevice("Celular perdido");
    await signedIn(passkey);

    expect(await deletePasskeyAction(lost.id)).toEqual({ ok: true });

    expect(notices()).toEqual([["passkey-removed", { passkeyName: "Celular perdido" }]]);
  });

  test("deleting the key of the session you are in also notifies, before sending you to the login", async () => {
    const { passkey } = await registeredDevice("PC");
    await registeredDevice("Notebook");
    await signedIn(passkey);

    expect(await deletePasskeyAction(passkey.id)).toEqual({ ok: true, redirectTo: "/admin/login" });

    expect(notices()).toEqual([["passkey-removed", { passkeyName: "PC" }]]);
  });

  test("a code for another device notifies the generation, without the code", async () => {
    const { passkey } = await registeredDevice();
    await signedIn(passkey);

    const result = await generateEnrollmentCodeAction();

    if (!result.ok) throw new Error(result.error);
    expect(notices()).toEqual([["code-generated"]]);
    expect(JSON.stringify(vi.mocked(notifySecurityEvent).mock.calls)).not.toContain(result.code);
  });

  test("closing all the sessions notifies it", async () => {
    const { passkey } = await registeredDevice();
    await signedIn(passkey);

    expect(await closeAllSessionsAction()).toEqual({ ok: true, redirectTo: "/admin/login" });

    expect(notices()).toEqual([["sessions-closed"]]);
  });

  test("nothing is notified when the action does nothing: last key, missing key, rename, or an old confirmation", async () => {
    const { passkey } = await registeredDevice("Única");
    const sessionId = await signedIn(passkey);

    expect(await deletePasskeyAction(passkey.id)).toEqual({ ok: false, error: "last" });
    expect(await deletePasskeyAction("5a2d1f0e-8f6e-4c1c-9d7a-111111111111")).toEqual({ ok: false, error: "missing" });
    expect(await renamePasskeyAction(passkey.id, "Otro nombre")).toEqual({ ok: true });
    await db.update(adminSessions).set({ reauthAt: new Date(0) }).where(eq(adminSessions.id, sessionId));
    expect(await generateEnrollmentCodeAction()).toEqual({ ok: false, error: "reauth-required" });
    expect(await closeAllSessionsAction()).toEqual({ ok: false, error: "reauth-required" });
    expect(await deletePasskeyAction(passkey.id)).toEqual({ ok: false, error: "reauth-required" });

    expect(notices()).toEqual([]);
    expect((await listPasskeys(db)).map((key) => key.name)).toEqual(["Otro nombre"]);
  });
});

describe("an email that cannot be sent never changes what happened", () => {
  const TO = "tomas@example.com";

  function configureEmail(): void {
    vi.stubEnv("RESEND_API_KEY", "re_clave_de_prueba_muy_secreta");
    vi.stubEnv("ADMIN_ALERT_EMAIL", TO);
  }

  test("a sign-in whose notice fails to send still opens the session", async () => {
    configureEmail();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    sdk.send.mockRejectedValue(new Error("fetch failed"));
    const { device } = await registeredDevice();
    await pendingLogin("passkey");

    const result = await signInWith(device);
    await expect(runScheduled()).resolves.toBeUndefined();

    expect(result).toEqual({ ok: true, redirectTo: "/admin" });
    expect(await sessionCount()).toBe(1);
    expect(jar.values.get(ADMIN_COOKIE)).toBeTruthy();
    expect(sdk.send).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.stringify(logged.mock.calls)).not.toContain(TO);
  });

  test("a notice Resend turns down is only logged too", async () => {
    configureEmail();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    sdk.send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", statusCode: 403, message: `Solo a ${TO}` },
      headers: null,
    });
    const { device } = await registeredDevice();
    await pendingLogin("passkey");

    expect((await signInWith(device)).ok).toBe(true);
    await runScheduled();

    expect(await sessionCount()).toBe(1);
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.stringify(logged.mock.calls)).not.toContain(TO);
  });

  test("the notice that does go out says what happened, with the device and the country of the request", async () => {
    configureEmail();
    vi.mocked(headers).mockResolvedValue(
      new Headers({
        host: "localhost:3100",
        "x-forwarded-for": IP,
        "user-agent": CHROME_WINDOWS,
        "x-vercel-ip-country": "AR",
      }) as never,
    );
    const { passkey } = await registeredDevice();
    await signedIn(passkey);

    await closeAllSessionsAction();
    await runScheduled();

    expect(sdk.send).toHaveBeenCalledOnce();
    const [message] = sdk.send.mock.calls[0];
    expect(message.to).toBe(TO);
    expect(message.subject).toContain("Se cerraron todas las sesiones");
    expect(message.text).toContain("Chrome en Windows");
    expect(message.text).toContain("Argentina (AR)");
  });

  test("if Next cannot even schedule the send, the sign-in still opens the session", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(after).mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });
    const { device } = await registeredDevice();
    await pendingLogin("passkey");

    const result = await signInWith(device);

    expect(result).toEqual({ ok: true, redirectTo: "/admin" });
    expect(await sessionCount()).toBe(1);
    expect(logged).toHaveBeenCalledOnce();
  });

  test("a block whose notice cannot be scheduled still answers the wrong password the same way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(after).mockImplementation(() => {
      throw new Error("`after` was called outside a request scope");
    });

    for (let attempt = 1; attempt <= LOGIN_MAX_FAILURES; attempt += 1) {
      expect(await submitPassword("incorrecta")).toBe("NEXT_REDIRECT /admin/login?error=invalid");
    }
    expect(await submitPassword("incorrecta")).toBe("NEXT_REDIRECT /admin/login?error=blocked");
  });
});
