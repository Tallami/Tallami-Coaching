import { cookies, headers } from "next/headers";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { loginIpHash } from "@/admin/auth/login-ip";
import { LOGIN_MAX_FAILURES } from "@/admin/auth/rate-limit";
import { hashIp } from "@/admin/auth/session";
import { getDb, type Db } from "@/db/client";
import { loginAttempts } from "@/db/schema";
import { interestIpHash } from "@/admin/interest/ip-key";
import { loginAction } from "@/app/admin/login/actions";
import {
  ADMIN_TEST_PASSWORD,
  ADMIN_TEST_PASSWORD_HASH,
  ADMIN_TEST_SESSION_SECRET,
} from "../helpers/admin-server";
import { createTestDb } from "../helpers/db";

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

const cookieJar = { set: vi.fn() };

/** Un intento de ingreso desde la IP `ip` (como la manda Vercel en `x-forwarded-for`). */
async function login(ip: string, password: string): Promise<string> {
  vi.mocked(headers).mockResolvedValue(new Headers({ "x-forwarded-for": ip }) as never);
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
const IN = "NEXT_REDIRECT /admin";

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
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
