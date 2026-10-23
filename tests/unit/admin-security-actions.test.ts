import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { registrationOptions, verifyRegistration } from "@/admin/auth/ceremonies";
import { redeemEnrollmentCode } from "@/admin/auth/enrollment-codes";
import { countPasskeys, insertPasskey, listPasskeys, type Passkey } from "@/admin/auth/passkeys";
import { ENROLLMENT_CODE_MS, PASSKEY_NAME_MAX_LENGTH, REAUTH_WINDOW_MS } from "@/admin/auth/policy";
import { ADMIN_COOKIE, createSessionToken } from "@/admin/auth/session";
import { createSession, listActiveSessions } from "@/admin/auth/sessions";
import { getDb, type Db } from "@/db/client";
import { adminEnrollmentCodes, adminPasskeys, adminSessions } from "@/db/schema";
import {
  beginAddPasskeyAction,
  beginReauthAction,
  closeAllSessionsAction,
  deletePasskeyAction,
  finishAddPasskeyAction,
  finishReauthAction,
  generateEnrollmentCodeAction,
  renamePasskeyAction,
} from "@/app/admin/configuracion/seguridad/actions";
import { ADMIN_TEST_PASSWORD_HASH, ADMIN_TEST_SESSION_SECRET } from "../helpers/admin-server";
import { createCookieJar } from "../helpers/cookie-jar";
import { createTestDb } from "../helpers/db";
import { createVirtualAuthenticator, type VirtualAuthenticator } from "../helpers/virtual-authenticator";

// Las acciones de Configuración → Seguridad, de punta a punta en el servidor: una
// sesión de verdad en una base de verdad, con la hora de su última confirmación
// puesta a mano (`reauthAt`). Las llaves son de un autenticador virtual con
// criptografía real, así la librería de WebAuthn verifica firmas y no un doble.

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

const ORIGIN = "http://localhost:3100";
const SITE = { rpID: "localhost", origin: ORIGIN };
const DEVICE = "Chrome en Windows";
const SECOND_MS = 1000;
const LOGIN = "/admin/login";
const REAUTH_REQUIRED = { ok: false, error: "reauth-required" } as const;
/** Una confirmación de hace un momento, y una de hace más de lo que dura la ventana. */
const FRESH = () => new Date(Date.now() - SECOND_MS);
const STALE = () => new Date(Date.now() - REAUTH_WINDOW_MS - SECOND_MS);

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
  vi.mocked(headers).mockResolvedValue(new Headers({ host: "localhost:3100" }) as never);
  // Las ceremonias rechazadas dejan su motivo en el log; acá se rechazan a propósito.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.delete(adminEnrollmentCodes);
  await db.delete(adminSessions);
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

/** Abre una sesión con la llave `passkey`, con la última confirmación en `reauthAt`; no cambia la cookie del pedido. */
async function openSession(passkey: Passkey, reauthAt: Date | null): Promise<string> {
  const id = await createSession(db, { passkeyId: passkey.id, device: DEVICE, reauthed: false });
  await db.update(adminSessions).set({ reauthAt }).where(eq(adminSessions.id, id));
  return id;
}

/** Pone la cookie de la sesión `sessionId` en el navegador: desde ahora los pedidos son suyos. */
async function actAs(sessionId: string): Promise<void> {
  jar.values.set(ADMIN_COOKIE, await createSessionToken(sessionId));
}

/** Una sesión de Tallami con la llave `passkey` y esa confirmación, ya con su cookie puesta. */
async function signedIn(passkey: Passkey, reauthAt: Date | null): Promise<string> {
  const id = await openSession(passkey, reauthAt);
  await actAs(id);
  return id;
}

async function sessionRow(id: string) {
  const [row] = await db.select().from(adminSessions).where(eq(adminSessions.id, id));
  return row;
}

async function isOpen(id: string): Promise<boolean> {
  return (await listActiveSessions(db)).some((session) => session.id === id);
}

/** Los nombres de las llaves registradas, ordenados (dos llaves creadas en el mismo milisegundo no tienen orden propio). */
async function keyNames(): Promise<string[]> {
  return (await listPasskeys(db)).map((passkey) => passkey.name).sort();
}

describe("every action is behind requireAdmin", () => {
  test.each([
    ["beginReauthAction", () => beginReauthAction()],
    ["finishReauthAction", () => finishReauthAction({})],
    ["beginAddPasskeyAction", () => beginAddPasskeyAction()],
    ["finishAddPasskeyAction", () => finishAddPasskeyAction({}, "PC")],
    ["renamePasskeyAction", () => renamePasskeyAction("x", "PC")],
    ["deletePasskeyAction", () => deletePasskeyAction("x")],
    ["generateEnrollmentCodeAction", () => generateEnrollmentCodeAction()],
    ["closeAllSessionsAction", () => closeAllSessionsAction()],
  ])("%s sends a visitor without a session to the login and touches nothing", async (_name, call) => {
    const { passkey } = await registeredDevice();

    await expect(call()).rejects.toThrow(`NEXT_REDIRECT ${LOGIN}`);

    expect(await keyNames()).toEqual([passkey.name]);
  });
});

describe("confirming with the key again", () => {
  test("begin asks for any registered key, verifying the user, and keeps the challenge in the session", async () => {
    const { passkey } = await registeredDevice();
    await registeredDevice("Notebook");
    const sessionId = await signedIn(passkey, STALE());

    const begun = await beginReauthAction();

    if (!begun.ok) throw new Error(begun.error);
    expect(begun.options.rpId).toBe("localhost");
    expect(begun.options.userVerification).toBe("required");
    expect(begun.options.allowCredentials).toHaveLength(2);
    const row = await sessionRow(sessionId);
    expect(row).toMatchObject({ challenge: begun.options.challenge, challengePurpose: "reauth" });
  });

  test("the right key opens the window for the delicate actions and records the use", async () => {
    const { device, passkey } = await registeredDevice();
    const sessionId = await signedIn(passkey, STALE());
    const begun = await beginReauthAction();
    if (!begun.ok) throw new Error(begun.error);
    const before = Date.now();

    const result = await finishReauthAction(device.authenticate(begun.options, { counter: 1 }));

    expect(result).toEqual({ ok: true });
    expect((await sessionRow(sessionId)).reauthAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect((await listPasskeys(db))[0]).toMatchObject({ counter: 1 });
    expect((await listPasskeys(db))[0].lastUsedAt).not.toBeNull();
    // Y la acción que antes pedía confirmar ahora se hace.
    expect(await generateEnrollmentCodeAction()).toMatchObject({ ok: true });
  });

  test("the answer is good only once: the challenge is spent", async () => {
    const { device, passkey } = await registeredDevice();
    await signedIn(passkey, STALE());
    const begun = await beginReauthAction();
    if (!begun.ok) throw new Error(begun.error);
    const answer = device.authenticate(begun.options, { counter: 1 });

    expect(await finishReauthAction(answer)).toEqual({ ok: true });
    expect(await finishReauthAction(answer)).toEqual({ ok: false, error: "expired" });
  });

  test("without asking first there is nothing to answer", async () => {
    const { device, passkey } = await registeredDevice();
    const sessionId = await signedIn(passkey, STALE());
    const answer = device.authenticate({ challenge: "inventado", rpId: "localhost" }, { counter: 1 });

    expect(await finishReauthAction(answer)).toEqual({ ok: false, error: "expired" });
    expect((await sessionRow(sessionId)).reauthAt?.getTime()).toBeLessThan(Date.now() - REAUTH_WINDOW_MS);
  });

  test("a challenge asked for another purpose does not confirm", async () => {
    const { device, passkey } = await registeredDevice();
    await signedIn(passkey, FRESH());
    const begun = await beginAddPasskeyAction();
    if (!begun.ok) throw new Error(begun.error);

    const answer = device.authenticate({ challenge: begun.options.challenge, rpId: "localhost" }, { counter: 1 });

    expect(await finishReauthAction(answer)).toEqual({ ok: false, error: "expired" });
  });

  const BAD_ANSWERS: [string, (options: PublicKeyCredentialRequestOptionsJSON, device: VirtualAuthenticator) => unknown][] = [
    ["a key from another site", (options, device) => device.authenticate(options, { counter: 1, origin: "https://otro-sitio.com" })],
    ["a key that was not registered here", (options) => createVirtualAuthenticator(SITE).authenticate(options, { counter: 1 })],
    ["something that is not a key", () => "texto"],
  ];

  test.each(BAD_ANSWERS)("%s does not confirm", async (_label, answer) => {
    const { device, passkey } = await registeredDevice();
    const sessionId = await signedIn(passkey, STALE());
    const begun = await beginReauthAction();
    if (!begun.ok) throw new Error(begun.error);

    const result = await finishReauthAction(answer(begun.options, device));

    expect(result).toEqual({ ok: false, error: "failed" });
    expect((await sessionRow(sessionId)).reauthAt?.getTime()).toBeLessThan(Date.now() - REAUTH_WINDOW_MS);
  });

  test("a counter that does not go up does not confirm", async () => {
    const { device, passkey } = await registeredDevice();
    await signedIn(passkey, STALE());
    const first = await beginReauthAction();
    if (!first.ok) throw new Error(first.error);
    await finishReauthAction(device.authenticate(first.options, { counter: 5 }));
    const second = await beginReauthAction();
    if (!second.ok) throw new Error(second.error);

    expect(await finishReauthAction(device.authenticate(second.options, { counter: 5 }))).toEqual({
      ok: false,
      error: "failed",
    });
  });
});

describe("the delicate actions without a recent confirmation", () => {
  test.each([
    ["never confirmed", () => null],
    ["confirmed more than five minutes ago", STALE],
  ])("ask to confirm, and change nothing, when %s", async (_label, reauthAt) => {
    const { passkey } = await registeredDevice();
    const { passkey: other } = await registeredDevice("Notebook");
    const sessionId = await signedIn(passkey, reauthAt());
    const otherSession = await openSession(other, FRESH());

    expect(await beginAddPasskeyAction()).toEqual(REAUTH_REQUIRED);
    expect(await finishAddPasskeyAction({}, "PC nueva")).toEqual(REAUTH_REQUIRED);
    expect(await renamePasskeyAction(other.id, "Otro nombre")).toEqual(REAUTH_REQUIRED);
    expect(await deletePasskeyAction(other.id)).toEqual(REAUTH_REQUIRED);
    expect(await generateEnrollmentCodeAction()).toEqual(REAUTH_REQUIRED);
    expect(await closeAllSessionsAction()).toEqual(REAUTH_REQUIRED);

    expect(await keyNames()).toEqual(["Celular", "Notebook"]);
    expect(await isOpen(sessionId)).toBe(true);
    expect(await isOpen(otherSession)).toBe(true);
    expect(await db.select().from(adminEnrollmentCodes)).toEqual([]);
    expect(await sessionRow(sessionId)).toMatchObject({ challenge: null });
    expect(jar.delete).not.toHaveBeenCalled();
  });

  test("the window closes at exactly five minutes", async () => {
    const { passkey } = await registeredDevice();
    await signedIn(passkey, new Date(Date.now() - REAUTH_WINDOW_MS));

    expect(await generateEnrollmentCodeAction()).toEqual(REAUTH_REQUIRED);
  });
});

describe("adding a key to this device", () => {
  test("begin asks to create a key that verifies the user, skipping the keys already registered, and keeps the challenge", async () => {
    const { passkey } = await registeredDevice();
    const sessionId = await signedIn(passkey, FRESH());

    const begun = await beginAddPasskeyAction();

    if (!begun.ok) throw new Error(begun.error);
    expect(begun.options.rp.id).toBe("localhost");
    expect(begun.options.authenticatorSelection?.userVerification).toBe("required");
    expect(begun.options.excludeCredentials?.map((credential) => credential.id)).toEqual([passkey.credentialId]);
    expect(await sessionRow(sessionId)).toMatchObject({ challenge: begun.options.challenge, challengePurpose: "register" });
  });

  test("finish saves the key with its name, trimmed, next to the others", async () => {
    const { passkey } = await registeredDevice("Celular");
    await signedIn(passkey, FRESH());
    const begun = await beginAddPasskeyAction();
    if (!begun.ok) throw new Error(begun.error);
    const notebook = createVirtualAuthenticator(SITE);

    const result = await finishAddPasskeyAction(notebook.register(begun.options), "  Notebook  ");

    expect(result).toEqual({ ok: true });
    expect(await keyNames()).toEqual(["Celular", "Notebook"]);
    const saved = (await listPasskeys(db)).find((key) => key.name === "Notebook");
    expect(saved?.credentialId).toBe(notebook.credentialId);
  });

  test("the registration is good only once: the challenge is spent", async () => {
    const { passkey } = await registeredDevice();
    await signedIn(passkey, FRESH());
    const begun = await beginAddPasskeyAction();
    if (!begun.ok) throw new Error(begun.error);
    const answer = createVirtualAuthenticator(SITE).register(begun.options);

    expect(await finishAddPasskeyAction(answer, "Notebook")).toEqual({ ok: true });
    expect(await finishAddPasskeyAction(answer, "Notebook 2")).toEqual({ ok: false, error: "expired" });
    expect(await countPasskeys(db)).toBe(2);
  });

  test("finish without asking first is expired and adds nothing", async () => {
    const { passkey } = await registeredDevice();
    await signedIn(passkey, FRESH());
    const options = await registrationOptions([]);
    const answer = createVirtualAuthenticator(SITE).register(options);

    expect(await finishAddPasskeyAction(answer, "Notebook")).toEqual({ ok: false, error: "expired" });
    expect(await countPasskeys(db)).toBe(1);
  });

  test("a registration from another site fails and adds nothing", async () => {
    const { passkey } = await registeredDevice();
    await signedIn(passkey, FRESH());
    const begun = await beginAddPasskeyAction();
    if (!begun.ok) throw new Error(begun.error);
    const answer = createVirtualAuthenticator(SITE).register(begun.options, { origin: "https://otro-sitio.com" });

    expect(await finishAddPasskeyAction(answer, "Notebook")).toEqual({ ok: false, error: "failed" });
    expect(await countPasskeys(db)).toBe(1);
  });

  test("a key that is already registered fails instead of breaking", async () => {
    const { device, passkey } = await registeredDevice();
    await signedIn(passkey, FRESH());
    const begun = await beginAddPasskeyAction();
    if (!begun.ok) throw new Error(begun.error);

    const result = await finishAddPasskeyAction(device.register(begun.options), "Otra vez");

    expect(result).toEqual({ ok: false, error: "failed" });
    expect(await countPasskeys(db)).toBe(1);
    // El motivo queda en el log.
    expect(console.warn).toHaveBeenCalled();
  });

  test.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["41 characters", "x".repeat(PASSKEY_NAME_MAX_LENGTH + 1)],
    ["not a text", 42 as unknown as string],
  ])("a name that is %s is a validation error, and the registration is not spent", async (_label, name) => {
    const { passkey } = await registeredDevice();
    await signedIn(passkey, FRESH());
    const begun = await beginAddPasskeyAction();
    if (!begun.ok) throw new Error(begun.error);
    const answer = createVirtualAuthenticator(SITE).register(begun.options);

    expect(await finishAddPasskeyAction(answer, name)).toEqual({ ok: false, error: "invalid-name" });
    expect(await countPasskeys(db)).toBe(1);
    // Con un nombre válido, la misma respuesta entra.
    expect(await finishAddPasskeyAction(answer, "x".repeat(PASSKEY_NAME_MAX_LENGTH))).toEqual({ ok: true });
  });
});

describe("renaming a key", () => {
  test("changes the name, trimmed", async () => {
    const { passkey } = await registeredDevice("Celular");
    await signedIn(passkey, FRESH());

    expect(await renamePasskeyAction(passkey.id, "  Mi celular  ")).toEqual({ ok: true });

    expect(await keyNames()).toEqual(["Mi celular"]);
  });

  test.each([
    ["empty", ""],
    ["only spaces", "   "],
    ["41 characters", "x".repeat(PASSKEY_NAME_MAX_LENGTH + 1)],
    ["not a text", null as unknown as string],
  ])("a name that is %s is a validation error and changes nothing", async (_label, name) => {
    const { passkey } = await registeredDevice("Celular");
    await signedIn(passkey, FRESH());

    expect(await renamePasskeyAction(passkey.id, name)).toEqual({ ok: false, error: "invalid-name" });

    expect(await keyNames()).toEqual(["Celular"]);
  });

  test("accepts a name of exactly 40 characters", async () => {
    const { passkey } = await registeredDevice();
    await signedIn(passkey, FRESH());

    expect(await renamePasskeyAction(passkey.id, "x".repeat(PASSKEY_NAME_MAX_LENGTH))).toEqual({ ok: true });
  });

  test("says missing for a key that is not there", async () => {
    const { passkey } = await registeredDevice();
    await signedIn(passkey, FRESH());

    expect(await renamePasskeyAction("5a2d1f0e-8f6e-4c1c-9d7a-111111111111", "Otro")).toEqual({
      ok: false,
      error: "missing",
    });
    expect(await renamePasskeyAction("no-es-un-id", "Otro")).toEqual({ ok: false, error: "missing" });
  });
});

describe("deleting a key", () => {
  test("the last key stays, and nothing else changes", async () => {
    const { passkey } = await registeredDevice();
    const sessionId = await signedIn(passkey, FRESH());

    expect(await deletePasskeyAction(passkey.id)).toEqual({ ok: false, error: "last" });

    expect(await countPasskeys(db)).toBe(1);
    expect(await isOpen(sessionId)).toBe(true);
    expect(jar.delete).not.toHaveBeenCalled();
  });

  test("says missing for a key that is not there", async () => {
    const { passkey } = await registeredDevice();
    await registeredDevice("Notebook");
    await signedIn(passkey, FRESH());

    expect(await deletePasskeyAction("5a2d1f0e-8f6e-4c1c-9d7a-111111111111")).toEqual({ ok: false, error: "missing" });
    expect(await countPasskeys(db)).toBe(2);
  });

  test("closes at once the sessions that were opened with the deleted key, and only those", async () => {
    const { passkey: pc } = await registeredDevice("PC");
    const { passkey: lostPhone } = await registeredDevice("Celular perdido");
    const { passkey: notebook } = await registeredDevice("Notebook");
    const current = await signedIn(pc, FRESH());
    const fromLostPhone = await openSession(lostPhone, FRESH());
    const alsoFromLostPhone = await openSession(lostPhone, null);
    const fromNotebook = await openSession(notebook, FRESH());

    const result = await deletePasskeyAction(lostPhone.id);

    expect(result).toEqual({ ok: true });
    expect(await keyNames()).toEqual(["Notebook", "PC"]);
    expect(await isOpen(fromLostPhone)).toBe(false);
    expect(await isOpen(alsoFromLostPhone)).toBe(false);
    expect((await sessionRow(fromLostPhone)).revokedAt).not.toBeNull();
    expect(await isOpen(current)).toBe(true);
    expect(await isOpen(fromNotebook)).toBe(true);
    expect(jar.delete).not.toHaveBeenCalled();
  });

  test("deleting the key of the session you are in closes it, clears its cookie and goes to the login", async () => {
    const { passkey: pc } = await registeredDevice("PC");
    const { passkey: notebook } = await registeredDevice("Notebook");
    const current = await signedIn(pc, FRESH());
    const fromNotebook = await openSession(notebook, FRESH());

    const result = await deletePasskeyAction(pc.id);

    expect(result).toEqual({ ok: true, redirectTo: LOGIN });
    expect(await isOpen(current)).toBe(false);
    expect(jar.delete).toHaveBeenCalledWith({ name: ADMIN_COOKIE, path: "/admin" });
    expect(await isOpen(fromNotebook)).toBe(true);
    // Con la cookie vieja que alguien haya guardado, ya no se entra.
    jar.values.set(ADMIN_COOKIE, await createSessionToken(current));
    await expect(generateEnrollmentCodeAction()).rejects.toThrow(`NEXT_REDIRECT ${LOGIN}`);
  });

  test("a session opened with a key that was already gone and left without it is closed too", async () => {
    // El borrado suelta la llave de las sesiones (`on delete set null`): lo que quedó sin llave no sigue abierto.
    const { passkey: pc } = await registeredDevice("PC");
    const { passkey: lostPhone } = await registeredDevice("Celular perdido");
    await signedIn(pc, FRESH());
    const orphan = await openSession(lostPhone, FRESH());
    await db.delete(adminPasskeys).where(eq(adminPasskeys.id, lostPhone.id));
    const { passkey: notebook } = await registeredDevice("Notebook");

    await deletePasskeyAction(notebook.id);

    expect(await isOpen(orphan)).toBe(false);
  });
});

describe("a code for another device", () => {
  test("is shown once, in two halves, and valid for ten minutes", async () => {
    const { passkey } = await registeredDevice();
    await signedIn(passkey, FRESH());
    const before = Date.now();

    const result = await generateEnrollmentCodeAction();

    if (!result.ok) throw new Error(result.error);
    expect(result.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    const expiresAt = new Date(result.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + ENROLLMENT_CODE_MS);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + ENROLLMENT_CODE_MS);
    // Lo guardado es un hash, nunca el código.
    const [stored] = await db.select().from(adminEnrollmentCodes);
    expect(stored.codeHash).not.toContain(result.code.replace("-", ""));
    expect(await redeemEnrollmentCode(db, result.code)).toBe(true);
  });

  test("generating a second one leaves the first without effect", async () => {
    const { passkey } = await registeredDevice();
    await signedIn(passkey, FRESH());
    const first = await generateEnrollmentCodeAction();
    const second = await generateEnrollmentCodeAction();
    if (!first.ok || !second.ok) throw new Error("Los dos códigos deberían haberse generado.");

    expect(first.code).not.toBe(second.code);
    expect(await redeemEnrollmentCode(db, first.code)).toBe(false);
    expect(await redeemEnrollmentCode(db, second.code)).toBe(true);
  });

  test("belongs to the session that made it", async () => {
    const { passkey } = await registeredDevice();
    const sessionId = await signedIn(passkey, FRESH());

    await generateEnrollmentCodeAction();

    const [stored] = await db.select().from(adminEnrollmentCodes);
    expect(stored.createdBySession).toBe(sessionId);
  });
});

describe("closing every session", () => {
  test("leaves no open session, clears the cookie, goes to the login and kills the codes", async () => {
    const { passkey } = await registeredDevice("PC");
    const { passkey: phone } = await registeredDevice("Celular");
    const current = await signedIn(passkey, FRESH());
    const other = await openSession(phone, FRESH());
    const third = await openSession(phone, null);
    const code = await generateEnrollmentCodeAction();
    if (!code.ok) throw new Error(code.error);

    const result = await closeAllSessionsAction();

    expect(result).toEqual({ ok: true, redirectTo: LOGIN });
    expect(await listActiveSessions(db)).toEqual([]);
    for (const id of [current, other, third]) expect(await isOpen(id), id).toBe(false);
    expect(jar.delete).toHaveBeenCalledWith({ name: ADMIN_COOKIE, path: "/admin" });
    expect(await redeemEnrollmentCode(db, code.code)).toBe(false);
    // Las llaves no se tocan: se vuelve a entrar con ellas.
    expect(await countPasskeys(db)).toBe(2);
  });
});
