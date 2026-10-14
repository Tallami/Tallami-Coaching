import { randomBytes, scryptSync } from "node:crypto";
import { SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { attemptLogin } from "@/admin/auth/login";
import { hashPassword, verifyPassword } from "@/admin/auth/password";
import {
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  isLoginBlocked,
  recordLoginAttempt,
} from "@/admin/auth/rate-limit";
import {
  ADMIN_COOKIE,
  SESSION_AUDIENCE,
  createSessionToken,
  hashIp,
  verifySessionToken,
} from "@/admin/auth/session";
import type { Db } from "@/db/client";
import { loginAttempts } from "@/db/schema";
import { createTestDb } from "../helpers/db";

const PASSWORD = "una-clave-larga-de-prueba";
const SECRET = "secreto-de-prueba-de-mas-de-32-caracteres";
const OTHER_SECRET = "otro-secreto-de-prueba-de-mas-de-32-caracteres";
const MINUTE_MS = 60_000;
const HOUR_SECONDS = 3600;

const encoder = new TextEncoder();

/** Firma una sesión de prueba con el control que cada test necesita. */
async function signToken({
  secret = SECRET,
  audience = SESSION_AUDIENCE,
  expiresInSeconds = HOUR_SECONDS,
  alg = "HS256",
  withExpiration = true,
}: {
  secret?: string;
  audience?: string;
  expiresInSeconds?: number;
  alg?: "HS256" | "HS512";
  withExpiration?: boolean;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({})
    .setProtectedHeader({ alg })
    .setAudience(audience)
    .setIssuedAt(now - 2 * HOUR_SECONDS);
  if (withExpiration) jwt.setExpirationTime(now + expiresInSeconds);
  return jwt.sign(encoder.encode(secret));
}

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function encodePart(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("passwords", () => {
  let stored: string;

  beforeAll(async () => {
    stored = await hashPassword(PASSWORD);
  });

  test("verifies the right password and rejects the wrong one", async () => {
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword("otra-clave", stored)).toBe(false);
    expect(await verifyPassword(`${PASSWORD} `, stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  test("stores scrypt$N$r$p$salt$hash with a fresh salt each time", async () => {
    const again = await hashPassword(PASSWORD);

    expect(stored).toMatch(/^scrypt\$131072\$8\$1\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);
    expect(again).not.toBe(stored);
    expect(await verifyPassword(PASSWORD, again)).toBe(true);
    expect(stored).not.toContain(PASSWORD);
  });

  test("reads the parameters from the stored hash, so old hashes keep working", async () => {
    const salt = randomBytes(16);
    const hash = scryptSync(PASSWORD, salt, 32, { N: 2 ** 14, r: 8, p: 1 });
    const old = `scrypt$${2 ** 14}$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;

    expect(await verifyPassword(PASSWORD, old)).toBe(true);
    expect(await verifyPassword("otra-clave", old)).toBe(false);
  });

  test("treats equivalent unicode spellings as the same password", async () => {
    // La misma clave con letras acentuadas enteras (NFC) o con la letra y el
    // acento por separado (NFD), como la mandan distintos teclados.
    const composed = "contraseña-é-larga".normalize("NFC");
    const decomposed = composed.normalize("NFD");
    expect(decomposed).not.toBe(composed);
    const hash = await hashPassword(composed);

    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });

  test.each([
    ["an empty value", ""],
    ["plain text", PASSWORD],
    ["another algorithm", "bcrypt$10$abc$def"],
    ["missing parts", "scrypt$131072$8$1$c2FsdA=="],
    ["a cost that is not a power of two", "scrypt$1000$8$1$c2FsdHNhbHRzYWx0cw==$aGFzaGhhc2hoYXNoaGFzaA=="],
    ["a cost that would exhaust memory", `scrypt$${2 ** 24}$8$1$c2FsdHNhbHRzYWx0cw==$aGFzaGhhc2hoYXNoaGFzaA==`],
    ["a cost that is too weak", "scrypt$16$8$1$c2FsdHNhbHRzYWx0cw==$aGFzaGhhc2hoYXNoaGFzaA=="],
    ["a zero parallelism", "scrypt$131072$8$0$c2FsdHNhbHRzYWx0cw==$aGFzaGhhc2hoYXNoaGFzaA=="],
    ["an empty hash", "scrypt$131072$8$1$c2FsdHNhbHRzYWx0cw==$"],
    ["a salt that is too short", "scrypt$131072$8$1$YQ==$aGFzaGhhc2hoYXNoaGFzaA=="],
    ["text that is not base64", "scrypt$131072$8$1$@@@@$####"],
  ])("rejects a stored hash with %s without throwing", async (_label, malformed) => {
    await expect(verifyPassword(PASSWORD, malformed)).resolves.toBe(false);
  });

  test("refuses to hash an empty password", async () => {
    await expect(hashPassword("")).rejects.toThrow(RangeError);
  });
});

describe("session tokens", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("creates a token that verifies, for twelve hours and for the panel only", async () => {
    const token = await createSessionToken();

    expect(await verifySessionToken(token)).toBe(true);
    const [rawHeader, rawPayload] = token.split(".");
    const payload = decodePart(rawPayload);
    expect(decodePart(rawHeader)).toMatchObject({ alg: "HS256" });
    expect(payload.aud).toBe("tallami-admin");
    expect(Number(payload.exp) - Number(payload.iat)).toBe(12 * HOUR_SECONDS);
    expect(ADMIN_COOKIE).toBe("tallami_admin");
  });

  test("rejects tampered, expired or foreign-audience tokens", async () => {
    const valid = await signToken();
    expect(await verifySessionToken(valid)).toBe(true);
    const [header, payload, signature] = valid.split(".");

    // Payload cambiado (vence en un año) con la firma de antes.
    const stretched = encodePart({ ...decodePart(payload), exp: 4_102_444_800 });
    expect(await verifySessionToken(`${header}.${stretched}.${signature}`)).toBe(false);
    // Firma alterada.
    const flipped = signature.endsWith("A") ? `${signature.slice(0, -1)}B` : `${signature.slice(0, -1)}A`;
    expect(await verifySessionToken(`${header}.${payload}.${flipped}`)).toBe(false);
    // Vencido.
    expect(await verifySessionToken(await signToken({ expiresInSeconds: -10 }))).toBe(false);
    // Otra audiencia.
    expect(await verifySessionToken(await signToken({ audience: "otro-sitio" }))).toBe(false);
    // Otro secreto.
    expect(await verifySessionToken(await signToken({ secret: OTHER_SECRET }))).toBe(false);
  });

  test("rejects tokens that skip the signature, the algorithm or the expiry", async () => {
    const payload = { aud: "tallami-admin", exp: Math.floor(Date.now() / 1000) + HOUR_SECONDS };
    const unsigned = `${encodePart({ alg: "none", typ: "JWT" })}.${encodePart(payload)}.`;

    expect(await verifySessionToken(unsigned)).toBe(false);
    expect(await verifySessionToken(await signToken({ alg: "HS512" }))).toBe(false);
    expect(await verifySessionToken(await signToken({ withExpiration: false }))).toBe(false);
  });

  test.each([undefined, "", "abc", "a.b.c", "....", " "])(
    "rejects the garbage value %j",
    async (token) => {
      expect(await verifySessionToken(token)).toBe(false);
    },
  );

  test("rejects every token when the secret is missing or too short", async () => {
    const token = await signToken();

    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    expect(await verifySessionToken(token)).toBe(false);
    await expect(createSessionToken()).rejects.toThrow();

    const short = "x".repeat(31);
    vi.stubEnv("ADMIN_SESSION_SECRET", short);
    expect(await verifySessionToken(await signToken({ secret: short }))).toBe(false);
    await expect(createSessionToken()).rejects.toThrow();
  });
});

describe("hashIp", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("is a stable keyed hash that does not expose the address", () => {
    const hash = hashIp("203.0.113.7");

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashIp("203.0.113.7"));
    expect(hash).not.toBe(hashIp("203.0.113.8"));
    expect(hash).not.toContain("203");
  });

  test("changes with the secret, so the table cannot be reversed by trying every address", () => {
    const before = hashIp("203.0.113.7");
    vi.stubEnv("ADMIN_SESSION_SECRET", OTHER_SECRET);

    expect(hashIp("203.0.113.7")).not.toBe(before);
  });

  test("needs the secret", () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "");

    expect(() => hashIp("203.0.113.7")).toThrow();
  });
});

describe("login rate limit", () => {
  let db: Db;
  const now = new Date("2026-10-13T15:00:00.000Z");
  const IP = "hash-de-una-ip";

  beforeAll(async () => {
    db = await createTestDb();
  });

  beforeEach(async () => {
    await db.delete(loginAttempts);
  });

  async function failures(count: number, ipHash = IP, at = now): Promise<void> {
    for (let i = 0; i < count; i += 1) await recordLoginAttempt(db, ipHash, false, at);
  }

  test("blocks an ip after five failures in fifteen minutes and frees it after", async () => {
    await failures(LOGIN_MAX_FAILURES - 1);
    expect(await isLoginBlocked(db, IP, now)).toBe(false);

    await failures(1);
    expect(await isLoginBlocked(db, IP, now)).toBe(true);
    expect(await isLoginBlocked(db, IP, new Date(now.getTime() + 14 * MINUTE_MS))).toBe(true);
    expect(await isLoginBlocked(db, IP, new Date(now.getTime() + LOGIN_WINDOW_MS))).toBe(false);
    expect(await isLoginBlocked(db, IP, new Date(now.getTime() + 16 * MINUTE_MS))).toBe(false);
  });

  test("keeps each ip apart", async () => {
    await failures(LOGIN_MAX_FAILURES);

    expect(await isLoginBlocked(db, IP, now)).toBe(true);
    expect(await isLoginBlocked(db, "hash-de-otra-ip", now)).toBe(false);
  });

  test("counts only failures: successful logins never block", async () => {
    for (let i = 0; i < 10; i += 1) await recordLoginAttempt(db, IP, true, now);
    expect(await isLoginBlocked(db, IP, now)).toBe(false);

    await failures(LOGIN_MAX_FAILURES - 1);
    expect(await isLoginBlocked(db, IP, now)).toBe(false);
  });

  test("counts only the failures inside the window", async () => {
    const old = new Date(now.getTime() - 20 * MINUTE_MS);
    await failures(LOGIN_MAX_FAILURES, IP, old);
    await failures(2);

    expect(await isLoginBlocked(db, IP, now)).toBe(false);
  });

  test("forgets attempts after thirty days and keeps the recent ones", async () => {
    const longAgo = new Date(now.getTime() - 31 * 24 * 60 * MINUTE_MS);
    await recordLoginAttempt(db, IP, false, longAgo);
    await recordLoginAttempt(db, IP, true, new Date(now.getTime() - 5 * 24 * 60 * MINUTE_MS));

    await recordLoginAttempt(db, IP, false, now);

    const rows = await db.select().from(loginAttempts);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.createdAt > longAgo)).toBe(true);
  });

  test("stores the ip hash and the outcome, nothing else", async () => {
    await recordLoginAttempt(db, IP, false, now);

    const [row] = await db.select().from(loginAttempts);
    expect(row).toMatchObject({ ipHash: IP, succeeded: false, createdAt: now });
  });
});

describe("attemptLogin", () => {
  let db: Db;
  let stored: string;
  const IP = "hash-de-una-ip";

  beforeAll(async () => {
    db = await createTestDb();
    stored = await hashPassword(PASSWORD);
  });

  beforeEach(async () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", stored);
    await db.delete(loginAttempts);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("lets the right password in and records it", async () => {
    expect(await attemptLogin(db, IP, PASSWORD)).toBe("ok");

    const rows = await db.select().from(loginAttempts);
    expect(rows.map((row) => row.succeeded)).toEqual([true]);
  });

  test("refuses a wrong password and records the failure", async () => {
    expect(await attemptLogin(db, IP, "incorrecta")).toBe("invalid");

    const rows = await db.select().from(loginAttempts);
    expect(rows.map((row) => row.succeeded)).toEqual([false]);
  });

  test("locks after five failures, even for the right password, without recording more", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      expect(await attemptLogin(db, IP, "incorrecta")).toBe("invalid");
    }

    expect(await attemptLogin(db, IP, PASSWORD)).toBe("blocked");
    expect(await attemptLogin(db, IP, "incorrecta")).toBe("blocked");
    expect(await db.select().from(loginAttempts)).toHaveLength(LOGIN_MAX_FAILURES);
    // Otra IP sigue pudiendo entrar.
    expect(await attemptLogin(db, "hash-de-otra-ip", PASSWORD)).toBe("ok");
  });

  test("frees the ip once the window has passed", async () => {
    const start = new Date("2026-10-13T15:00:00.000Z");
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      await attemptLogin(db, IP, "incorrecta", start);
    }
    const later = new Date(start.getTime() + LOGIN_WINDOW_MS);

    expect(await attemptLogin(db, IP, PASSWORD, new Date(start.getTime() + MINUTE_MS))).toBe("blocked");
    expect(await attemptLogin(db, IP, PASSWORD, later)).toBe("ok");
  });

  test("answers the same as a wrong password when the hash is not configured", async () => {
    vi.stubEnv("ADMIN_PASSWORD_HASH", "");

    expect(await attemptLogin(db, IP, PASSWORD)).toBe("invalid");
  });
});
