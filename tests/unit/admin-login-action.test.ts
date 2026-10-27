import { cookies, headers } from "next/headers";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { loginIpHash } from "@/admin/auth/login-ip";
import { PENDING_COOKIE } from "@/admin/auth/pending-logins";
import { LOGIN_MAX_FAILURES } from "@/admin/auth/rate-limit";
import { ADMIN_COOKIE, hashIp } from "@/admin/auth/session";
import { createSession, purgeExpiredAuthRecords } from "@/admin/auth/sessions";
import { getDb, type Db } from "@/db/client";
import { adminPasskeys, adminPendingLogins, adminSessions, loginAttempts } from "@/db/schema";
import { interestIpHash } from "@/admin/interest/ip-key";
import { loginAction } from "@/app/admin/login/actions";
import {
  ADMIN_TEST_PASSWORD,
  ADMIN_TEST_PASSWORD_HASH,
  ADMIN_TEST_SESSION_SECRET,
} from "../helpers/admin-server";
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
// La limpieza de registros viejos es la de verdad, salvo en el test que la hace fallar.
vi.mock("@/admin/auth/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/admin/auth/sessions")>();
  return { ...actual, purgeExpiredAuthRecords: vi.fn(actual.purgeExpiredAuthRecords) };
});
// Los avisos por email tienen sus tests (`admin-alerts*.test.ts`); acá no hay pedido de Next donde programarlos.
vi.mock("@/admin/alerts/notify", () => ({ notifySecurityEvent: vi.fn() }));

const cookieJar = { set: vi.fn() };

/** Un intento de ingreso desde la IP `ip` (como la manda Vercel en `x-forwarded-for`), con el navegador `userAgent` si se indica. */
async function login(ip: string, password: string, userAgent?: string): Promise<string> {
  const requestHeaders = new Headers({ "x-forwarded-for": ip });
  if (userAgent) requestHeaders.set("user-agent", userAgent);
  vi.mocked(headers).mockResolvedValue(requestHeaders as never);
  const form = new FormData();
  form.set("password", password);
  const error = await loginAction(form).then(
    () => new Error("el login no redirigió"),
    (thrown: unknown) => thrown as Error,
  );
  return error.message;
}

const WRONG = "NEXT_REDIRECT /admin/login?error=invalid";
const BLOCKED = "NEXT_REDIRECT /admin/login?error=blocked";
/** La contraseña pasó: sigue el segundo paso (la base de estos tests no tiene llaves, así que es registrar la primera). */
const IN = "NEXT_REDIRECT /admin/login/primera-llave";

describe("the key of the login limit", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_SESSION_SECRET", ADMIN_TEST_SESSION_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("groups an ipv6 address with the rest of its /64, like the clicks do", () => {
    const home = loginIpHash("2001:db8:1:2:aaaa:bbbb:cccc:dddd");

    expect(loginIpHash("2001:db8:1:2::1")).toBe(home);
    expect(loginIpHash("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe(home);
    expect(loginIpHash("2001:db8:1:3::1")).not.toBe(home);
    expect(loginIpHash("2001:db8:2:2::1")).not.toBe(home);
  });

  test("counts an ipv4 written inside ipv6 as that ipv4", () => {
    const plain = loginIpHash("203.0.113.9");

    expect(loginIpHash("::ffff:203.0.113.9")).toBe(plain);
    expect(loginIpHash("::ffff:cb00:7109")).toBe(plain);
    expect(loginIpHash("203.0.113.10")).not.toBe(plain);
  });

  test("keeps every unusable address in one shared bucket", () => {
    expect(loginIpHash("unknown")).toBe(loginIpHash("unknown"));
    expect(loginIpHash("unknown")).not.toBe(loginIpHash("203.0.113.9"));
  });

  test("is a keyed hash that does not show the address, and cannot be matched to the clicks table", () => {
    const hash = loginIpHash("2001:db8:1:2::1");

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("2001");
    // Los clics guardan otro hash (con el día) y `hashIp` de la IP sola ya no es la clave del login.
    expect(hash).not.toBe(interestIpHash("2001:db8:1:2::1", "2026-10-16"));
    expect(hash).not.toBe(hashIp("2001:db8:1:2::1"));
  });
});

describe("loginAction", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  beforeEach(async () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", ADMIN_TEST_PASSWORD_HASH);
    vi.stubEnv("ADMIN_SESSION_SECRET", ADMIN_TEST_SESSION_SECRET);
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(cookies).mockResolvedValue(cookieJar as never);
    cookieJar.set.mockClear();
    await db.delete(loginAttempts);
    await db.delete(adminSessions);
    await db.delete(adminPasskeys);
    await db.delete(adminPendingLogins);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Con la contraseña sola ya no se abre ninguna sesión: queda un ingreso a medio camino
  // que el segundo paso (la llave) convierte en sesión (ver `admin-login-steps.test.ts`).
  describe("the pending login a right password opens", () => {
    const CHROME_WINDOWS =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

    test("is saved in the database, its id travels in its own cookie, and no session is opened", async () => {
      expect(await login("203.0.113.20", ADMIN_TEST_PASSWORD, CHROME_WINDOWS)).toBe(IN);

      const rows = await db.select().from(adminPendingLogins);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ mode: "first-key", device: "Chrome en Windows", consumedAt: null });
      expect(cookieJar.set).toHaveBeenCalledOnce();
      const [name, value, options] = cookieJar.set.mock.calls[0];
      expect(name).toBe(PENDING_COOKIE);
      expect(value).toBe(rows[0].id);
      expect(name).not.toBe(ADMIN_COOKIE);
      expect(options).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/admin/login", maxAge: 5 * 60 });
      expect(await db.select().from(adminSessions)).toEqual([]);
    });

    test("ends five minutes after it starts", async () => {
      await login("203.0.113.21", ADMIN_TEST_PASSWORD, CHROME_WINDOWS);

      const [row] = await db.select().from(adminPendingLogins);
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(5 * 60 * 1000);
    });

    test("describes the device as unknown when the browser says nothing", async () => {
      await login("203.0.113.22", ADMIN_TEST_PASSWORD);

      const [row] = await db.select().from(adminPendingLogins);
      expect(row.device).toBe("Navegador desconocido");
    });

    test("is a new one for every login", async () => {
      await login("203.0.113.23", ADMIN_TEST_PASSWORD, CHROME_WINDOWS);
      await login("203.0.113.24", ADMIN_TEST_PASSWORD, CHROME_WINDOWS);

      const ids = (await db.select({ id: adminPendingLogins.id }).from(adminPendingLogins)).map((row) => row.id);
      expect(new Set(ids).size).toBe(2);
    });

    test("is never opened by a wrong password or a blocked address", async () => {
      for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
        await login("203.0.113.25", "incorrecta", CHROME_WINDOWS);
      }
      await login("203.0.113.25", ADMIN_TEST_PASSWORD, CHROME_WINDOWS);

      expect(await db.select().from(adminPendingLogins)).toEqual([]);
      expect(cookieJar.set).not.toHaveBeenCalled();
    });

    test("comes with a cleanup of the records that nobody needs any more", async () => {
      const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      const passkeyId = await insertTestPasskey(db);
      const oldId = await createSession(db, { passkeyId, device: "Chrome en Windows", reauthed: false }, longAgo);

      await login("203.0.113.26", ADMIN_TEST_PASSWORD, CHROME_WINDOWS);

      const ids = (await db.select({ id: adminSessions.id }).from(adminSessions)).map((row) => row.id);
      expect(ids).not.toContain(oldId);
    });

    test("is opened even when the cleanup fails: a right password is not turned into unavailable, and only the error name is logged", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(purgeExpiredAuthRecords).mockRejectedValueOnce(
        new TypeError("no se pudo borrar en postgres://usuario:clave-secreta@host/db"),
      );

      try {
        expect(await login("203.0.113.27", ADMIN_TEST_PASSWORD, CHROME_WINDOWS)).toBe(IN);

        expect(await db.select().from(adminPendingLogins)).toHaveLength(1);
        expect(cookieJar.set).toHaveBeenCalledOnce();
        expect(logged).toHaveBeenCalledOnce();
        const output = JSON.stringify(logged.mock.calls);
        expect(output).toContain("TypeError");
        expect(output).not.toContain("postgres://");
        expect(output).not.toContain("clave-secreta");
      } finally {
        logged.mockRestore();
      }
    });
  });

  test("an ipv6 visitor cannot dodge the limit by changing address inside their /64", async () => {
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      expect(await login(`2001:db8:aaaa:bbbb::${attempt + 1}`, "incorrecta")).toBe(WRONG);
    }

    // Una dirección nueva del mismo /64: bloqueada, ni la contraseña correcta entra.
    expect(await login("2001:db8:aaaa:bbbb:1234:5678:9abc:def0", ADMIN_TEST_PASSWORD)).toBe(BLOCKED);
    expect(cookieJar.set).not.toHaveBeenCalled();
    // Otro /64 no tiene nada que ver.
    expect(await login("2001:db8:aaaa:cccc::1", ADMIN_TEST_PASSWORD)).toBe(IN);
    expect(cookieJar.set).toHaveBeenCalledOnce();
  });

  test("an ipv4 address and the same one written inside ipv6 share their attempts", async () => {
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      const ip = attempt % 2 === 0 ? "203.0.113.9" : "::ffff:203.0.113.9";
      expect(await login(ip, "incorrecta")).toBe(WRONG);
    }

    expect(await login("203.0.113.9", ADMIN_TEST_PASSWORD)).toBe(BLOCKED);
    expect(await login("::ffff:cb00:7109", ADMIN_TEST_PASSWORD)).toBe(BLOCKED);
  });

  test("two different ipv4 addresses keep their own attempts", async () => {
    for (let attempt = 0; attempt < LOGIN_MAX_FAILURES; attempt += 1) {
      await login("203.0.113.9", "incorrecta");
    }

    expect(await login("203.0.113.10", ADMIN_TEST_PASSWORD)).toBe(IN);
  });
});
