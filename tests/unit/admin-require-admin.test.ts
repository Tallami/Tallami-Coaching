import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { hashPassword } from "@/admin/auth/password";
import { PASSWORD_CLAIM, passwordClaim } from "@/admin/auth/password-claim";
import { loginPath } from "@/admin/auth/redirect";
import { hasAdminSession, requireAdmin } from "@/admin/auth/require-admin";
import { ADMIN_COOKIE, createSessionToken } from "@/admin/auth/session";
import { ADMIN_TEST_OLD_PASSWORD_HASH } from "../helpers/admin-server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
// `redirect` de Next interrumpe tirando un error; el doble hace lo mismo.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

const SECRET = "secreto-de-prueba-de-mas-de-32-caracteres";

/** Hace que el pedido actual traiga (o no) esa cookie de sesión. */
function requestWithCookie(value: string | undefined): void {
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (name === ADMIN_COOKIE && value ? { name, value } : undefined),
  } as Awaited<ReturnType<typeof cookies>>);
}

/** Una sesión firmada a mano, con el claim de la contraseña vigente (o el de `hash`). */
async function signed({
  expiresInSeconds = 3600,
  audience = "tallami-admin",
  hash = storedHash,
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ [PASSWORD_CLAIM]: passwordClaim(new TextEncoder().encode(SECRET), hash) })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(audience)
    .setIssuedAt(now - 7200)
    .setExpirationTime(now + expiresInSeconds)
    .sign(new TextEncoder().encode(SECRET));
}

let storedHash: string;

beforeAll(async () => {
  storedHash = await hashPassword("una-clave-larga-de-prueba");
});

beforeEach(() => {
  vi.stubEnv("ADMIN_PASSWORD_HASH", storedHash);
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DATABASE_URL", "");
  vi.mocked(redirect).mockClear();
  vi.mocked(cookies).mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requireAdmin", () => {
  test("lets a valid session through", async () => {
    requestWithCookie(await createSessionToken());

    await expect(requireAdmin()).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  test("a signed session is valid (so the cases below fail for the right reason)", async () => {
    requestWithCookie(await signed());

    await expect(requireAdmin()).resolves.toBeUndefined();
  });

  test.each([
    ["no cookie", async () => undefined],
    ["a forged cookie", async () => "una-cookie-inventada"],
    ["an expired session", () => signed({ expiresInSeconds: -60 })],
    ["a session for another audience", () => signed({ audience: "otro-sitio" })],
    ["a session from before the password changed", () => signed({ hash: ADMIN_TEST_OLD_PASSWORD_HASH })],
  ])("sends %s to the login", async (_label, makeCookie) => {
    requestWithCookie(await makeCookie());

    await expect(requireAdmin()).rejects.toThrow("NEXT_REDIRECT /admin/login");
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/admin/login");
  });

  test("sends everything to the setup page when the panel is not configured", async () => {
    const valid = await createSessionToken();
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
});

describe("hasAdminSession", () => {
  test("is true only for a valid session, and never redirects", async () => {
    requestWithCookie(await createSessionToken());
    expect(await hasAdminSession()).toBe(true);

    requestWithCookie("falsa");
    expect(await hasAdminSession()).toBe(false);

    requestWithCookie(undefined);
    expect(await hasAdminSession()).toBe(false);
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
