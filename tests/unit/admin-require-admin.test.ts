import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { SESSION_IDLE_MS, SESSION_MAX_MS } from "@/admin/auth/policy";
import { hashPassword } from "@/admin/auth/password";
import { PASSWORD_CLAIM, passwordClaim } from "@/admin/auth/password-claim";
import { loginPath } from "@/admin/auth/redirect";
import { getAdminSession, hasAdminSession, requireAdmin } from "@/admin/auth/require-admin";
import { ADMIN_COOKIE, createSessionToken } from "@/admin/auth/session";
import { createSession, revokeSession } from "@/admin/auth/sessions";
import { getDb, type Db } from "@/db/client";
import { adminPasskeys, adminSessions } from "@/db/schema";
import { ADMIN_TEST_OLD_PASSWORD_HASH } from "../helpers/admin-server";
import { createTestDb, insertTestPasskey } from "../helpers/db";

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

const SECRET = "secreto-de-prueba-de-mas-de-32-caracteres";
const DEVICE = "Chrome en Windows";
const MINUTE_MS = 60_000;
// Sin sesión se va al login avisando que la sesión se cerró (el login deja ahí la marca para recuperar lo escrito).
const LOGIN_PATH_ENDED = "/admin/login?error=vencida";
const LOGIN_REDIRECT = `NEXT_REDIRECT ${LOGIN_PATH_ENDED}`;
const HOST = "localhost:3100";

/** Hace que el pedido actual traiga (o no) esa cookie de sesión. */
function requestWithCookie(value: string | undefined): void {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === ADMIN_COOKIE && value ? { name, value } : undefined),
  } as Awaited<ReturnType<typeof cookies>>);
}

/** Hace que el pedido actual venga de esa página (el `Referer` de un Server Action es la página del formulario). */
function requestFrom(referer: string | undefined, host: string | null = HOST): void {
  vi.mocked(headers).mockResolvedValue(
    new Headers({ ...(host ? { host } : {}), ...(referer ? { referer } : {}) }) as Awaited<ReturnType<typeof headers>>,
  );
}

/** Una sesión firmada a mano, con el claim de la contraseña vigente (o el de `hash`) y el id `sid`. */
async function signed({
  expiresInSeconds = 3600,
  audience = "tallami-admin",
  hash = storedHash,
  sid = randomBytes(32).toString("base64url"),
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ [PASSWORD_CLAIM]: passwordClaim(new TextEncoder().encode(SECRET), hash), sid })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(audience)
    .setIssuedAt(now - 7200)
    .setExpirationTime(now + expiresInSeconds)
    .sign(new TextEncoder().encode(SECRET));
}

let db: Db;
let storedHash: string;
/** La llave con la que se abren las sesiones de estos tests. */
let passkeyId: string;
/** El id de una sesión abierta de verdad en la base. */
let liveSessionId: string;

/** Abre una sesión en la base `ago` milisegundos antes de ahora, sin uso desde entonces. */
function openSession(ago = 0): Promise<string> {
  return createSession(
    db,
    { passkeyId, device: DEVICE, reauthed: false },
    new Date(Date.now() - ago),
  );
}

beforeAll(async () => {
  storedHash = await hashPassword("una-clave-larga-de-prueba");
  db = await createTestDb();
});

beforeEach(async () => {
  vi.stubEnv("ADMIN_PASSWORD_HASH", storedHash);
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DATABASE_URL", "");
  vi.mocked(redirect).mockClear();
  vi.mocked(cookies).mockReset();
  vi.mocked(headers).mockReset();
  requestFrom(undefined);
  vi.mocked(getDb).mockReset();
  vi.mocked(getDb).mockResolvedValue(db);
  await db.delete(adminSessions);
  await db.delete(adminPasskeys);
  passkeyId = await insertTestPasskey(db);
  liveSessionId = await openSession();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("requireAdmin", () => {
  test("lets a valid session through", async () => {
    requestWithCookie(await createSessionToken(liveSessionId));

    await expect(requireAdmin()).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  test("a signed session of a session that exists is valid (so the cases below fail for the right reason)", async () => {
    requestWithCookie(await signed({ sid: liveSessionId }));

    await expect(requireAdmin()).resolves.toBeUndefined();
  });

  test.each([
    ["no cookie", async () => undefined],
    ["a forged cookie", async () => "una-cookie-inventada"],
    ["an expired session", () => signed({ expiresInSeconds: -60, sid: liveSessionId })],
    ["a session for another audience", () => signed({ audience: "otro-sitio", sid: liveSessionId })],
    ["a session from before the password changed", () => signed({ hash: ADMIN_TEST_OLD_PASSWORD_HASH, sid: liveSessionId })],
  ])("sends %s to the login", async (_label, makeCookie) => {
    requestWithCookie(await makeCookie());

    await expect(requireAdmin()).rejects.toThrow(LOGIN_REDIRECT);
    expect(redirect).toHaveBeenCalledExactlyOnceWith(LOGIN_PATH_ENDED);
  });

  test("sends a well-signed token whose session is not in the database to the login", async () => {
    requestWithCookie(await signed());

    await expect(requireAdmin()).rejects.toThrow(LOGIN_REDIRECT);
    expect(redirect).toHaveBeenCalledExactlyOnceWith(LOGIN_PATH_ENDED);
  });

  test("sends a session that was closed to the login, even with a perfectly good cookie", async () => {
    const token = await createSessionToken(liveSessionId);
    requestWithCookie(token);
    await expect(requireAdmin()).resolves.toBeUndefined();

    await revokeSession(db, liveSessionId);

    await expect(requireAdmin()).rejects.toThrow(LOGIN_REDIRECT);
  });

  test("sends a session without use for thirty minutes to the login", async () => {
    const idle = await openSession(SESSION_IDLE_MS + MINUTE_MS);
    requestWithCookie(await createSessionToken(idle));

    await expect(requireAdmin()).rejects.toThrow(LOGIN_REDIRECT);
  });

  test("sends a session older than eight hours to the login, however recently it was used", async () => {
    const old = await openSession(SESSION_MAX_MS + MINUTE_MS);
    await db
      .update(adminSessions)
      .set({ lastSeenAt: new Date(Date.now() - MINUTE_MS / 2) })
      .where(eq(adminSessions.id, old));
    requestWithCookie(await createSessionToken(old));

    await expect(requireAdmin()).rejects.toThrow(LOGIN_REDIRECT);
  });

  test("notes the use of the session", async () => {
    const quiet = await openSession(10 * MINUTE_MS);
    requestWithCookie(await createSessionToken(quiet));

    await requireAdmin();

    const [row] = await db.select().from(adminSessions).where(eq(adminSessions.id, quiet));
    expect(Date.now() - row.lastSeenAt.getTime()).toBeLessThan(MINUTE_MS);
  });

  test("remembers the page the request came from, so signing in again comes back to the form", async () => {
    // Un Server Action sale con el `Referer` de la página del formulario.
    requestFrom(`http://${HOST}/admin/ventas/nueva`);
    const closed = await createSessionToken(liveSessionId);
    await revokeSession(db, liveSessionId);
    requestWithCookie(closed);

    await expect(requireAdmin()).rejects.toThrow(
      "NEXT_REDIRECT /admin/login?next=%2Fadmin%2Fventas%2Fnueva&error=vencida",
    );
  });

  test("keeps the query of that page too", async () => {
    requestFrom(`http://${HOST}/admin/ventas?mes=2026-10`);
    requestWithCookie(await signed());

    await expect(requireAdmin()).rejects.toThrow(
      "NEXT_REDIRECT /admin/login?next=%2Fadmin%2Fventas%3Fmes%3D2026-10&error=vencida",
    );
  });

  test.each([
    ["another site", "https://sitio-malo.com/admin/ventas/nueva", HOST],
    ["a page that is not the panel", `http://${HOST}/es`, HOST],
    ["the login itself", `http://${HOST}/admin/login`, HOST],
    ["nothing", undefined, HOST],
    ["a request with no host", `http://${HOST}/admin/ventas/nueva`, null],
  ])("does not ask to come back anywhere when the request came from %s", async (_label, referer, host) => {
    requestFrom(referer, host);
    requestWithCookie(await signed());

    await expect(requireAdmin()).rejects.toThrow(LOGIN_REDIRECT);
    expect(redirect).toHaveBeenCalledExactlyOnceWith(LOGIN_PATH_ENDED);
  });

  test("does not look at the request's headers while the session is good", async () => {
    requestWithCookie(await createSessionToken(liveSessionId));

    await requireAdmin();

    expect(headers).not.toHaveBeenCalled();
  });

  test("sends everything to the setup page when the panel is not configured", async () => {
    const valid = await createSessionToken(liveSessionId);
    vi.stubEnv("ADMIN_PASSWORD_HASH", "");
    requestWithCookie(valid);

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT /admin/setup");
  });

  test("reads the request cookie before it can redirect", async () => {
    // Con `cacheComponents` el build deja guardado todo lo que corre antes de
    // tocar un dato del pedido. Si la redirección a /admin/setup saliera antes
    // de leer la cookie, el build la dejaría fija para todas las visitas.
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    requestWithCookie(undefined);

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT /admin/setup");
    expect(cookies).toHaveBeenCalled();
  });

  test("does not let anyone in when the database cannot be reached", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("base caída"));
    requestWithCookie(await createSessionToken(liveSessionId));

    await expect(requireAdmin()).rejects.toThrow("base caída");
    expect(redirect).not.toHaveBeenCalled();
  });

  test("never touches the database when the cookie is not even signed right", async () => {
    requestWithCookie("una-cookie-inventada");

    await expect(requireAdmin()).rejects.toThrow(LOGIN_REDIRECT);
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("getAdminSession", () => {
  test("gives back the session of the cookie", async () => {
    requestWithCookie(await createSessionToken(liveSessionId));

    const session = await getAdminSession();

    expect(session).toMatchObject({ id: liveSessionId, passkeyId, device: DEVICE, reauthAt: null });
    expect(redirect).not.toHaveBeenCalled();
  });

  test("sends the same visitors as requireAdmin to the same places", async () => {
    requestWithCookie(await signed());
    await expect(getAdminSession()).rejects.toThrow(LOGIN_REDIRECT);

    requestWithCookie(undefined);
    await expect(getAdminSession()).rejects.toThrow(LOGIN_REDIRECT);

    const valid = await createSessionToken(liveSessionId);
    vi.stubEnv("ADMIN_PASSWORD_HASH", "");
    requestWithCookie(valid);
    await expect(getAdminSession()).rejects.toThrow("NEXT_REDIRECT /admin/setup");
  });
});

describe("hasAdminSession", () => {
  test("is true only for a valid session, and never redirects", async () => {
    requestWithCookie(await createSessionToken(liveSessionId));
    expect(await hasAdminSession()).toBe(true);

    requestWithCookie("falsa");
    expect(await hasAdminSession()).toBe(false);

    requestWithCookie(undefined);
    expect(await hasAdminSession()).toBe(false);

    requestWithCookie(await signed());
    expect(await hasAdminSession()).toBe(false);

    await revokeSession(db, liveSessionId);
    requestWithCookie(await createSessionToken(liveSessionId));
    expect(await hasAdminSession()).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });

  test("lets the login page show the form, and says why in the log, when the database cannot be reached", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getDb).mockRejectedValue(new Error("base caída"));
    requestWithCookie(await createSessionToken(liveSessionId));

    expect(await hasAdminSession()).toBe(false);

    expect(log).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("loginPath", () => {
  test("is the bare login unless there is something to carry", () => {
    expect(loginPath()).toBe("/admin/login");
    expect(loginPath({ next: "/admin" })).toBe("/admin/login");
    expect(loginPath({ next: "//evil.com" })).toBe("/admin/login");
  });

  test("carries a safe destination and the error code", () => {
    expect(loginPath({ next: "/admin/ventas?mes=2026-10" })).toBe(
      "/admin/login?next=%2Fadmin%2Fventas%3Fmes%3D2026-10",
    );
    expect(loginPath({ error: "invalid" })).toBe("/admin/login?error=invalid");
    expect(loginPath({ next: "/admin/ventas", error: "blocked" })).toBe(
      "/admin/login?next=%2Fadmin%2Fventas&error=blocked",
    );
  });
});
