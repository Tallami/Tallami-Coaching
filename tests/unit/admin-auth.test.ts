import { randomBytes, scryptSync } from "node:crypto";
import { SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { attemptLogin } from "@/admin/auth/login";
import { hashPassword, verifyPassword } from "@/admin/auth/password";
import { PASSWORD_CLAIM, passwordClaim } from "@/admin/auth/password-claim";
import {
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  confirmLoginSuccess,
  reserveLoginAttempt,
} from "@/admin/auth/rate-limit";
import {
  ADMIN_COOKIE,
  SESSION_AUDIENCE,
  createSessionToken,
  hashIp,
  readSessionClaims,
  sessionCookieOptions,
  verifySessionToken,
} from "@/admin/auth/session";
import type { Db } from "@/db/client";
import { loginAttempts } from "@/db/schema";
import { ADMIN_TEST_OLD_PASSWORD_HASH, ADMIN_TEST_PASSWORD_HASH } from "../helpers/admin-server";
import { createTestDb } from "../helpers/db";

// `verifyPassword` (scrypt) queda envuelta en un espía que conserva su
// comportamiento: así se puede comprobar cuántas contraseñas llegó a revisar
// `attemptLogin`, sin depender de cuánto tarda cada una.
vi.mock("@/admin/auth/password", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/admin/auth/password")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const PASSWORD = "una-clave-larga-de-prueba";
const SECRET = "secreto-de-prueba-de-mas-de-32-caracteres";
const OTHER_SECRET = "otro-secreto-de-prueba-de-mas-de-32-caracteres";
const MINUTE_MS = 60_000;
const HOUR_SECONDS = 3600;
/** El id de una sesión: 32 bytes al azar en base64url (43 caracteres). */
const SID = randomBytes(32).toString("base64url");

const encoder = new TextEncoder();

/** Firma una sesión de prueba con el control que cada test necesita. */
async function signToken({
  secret = SECRET,
  audience = SESSION_AUDIENCE,
  expiresInSeconds = HOUR_SECONDS,
  alg = "HS256",
  withExpiration = true,
  claim = passwordClaim(encoder.encode(secret), ADMIN_TEST_PASSWORD_HASH),
  sid = SID,
}: {
  secret?: string;
  audience?: string;
  expiresInSeconds?: number;
  alg?: "HS256" | "HS512";
  withExpiration?: boolean;
  /** El claim de la contraseña; `null` firma una sesión de antes de que existiera. */
  claim?: string | null;
  /** El id de la sesión (`sid`); `null` firma una sesión de antes de que se guardaran en la base. */
  sid?: string | null;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT({
    ...(claim === null ? {} : { [PASSWORD_CLAIM]: claim }),
    ...(sid === null ? {} : { sid }),
  })
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
    vi.stubEnv("ADMIN_PASSWORD_HASH", ADMIN_TEST_PASSWORD_HASH);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("the password claim", () => {
    test("is a short keyed value derived from the password hash, never the hash itself", async () => {
      const payload = decodePart((await createSessionToken(SID)).split(".")[1]);

      expect(payload[PASSWORD_CLAIM]).toMatch(/^[0-9a-f]{16}$/);
      expect(payload[PASSWORD_CLAIM]).toBe(passwordClaim(encoder.encode(SECRET), ADMIN_TEST_PASSWORD_HASH));
      expect(ADMIN_TEST_PASSWORD_HASH).not.toContain(String(payload[PASSWORD_CLAIM]));
    });

    test("depends on the hash and on the secret", () => {
      const claim = passwordClaim(encoder.encode(SECRET), ADMIN_TEST_PASSWORD_HASH);

      expect(passwordClaim(encoder.encode(SECRET), ADMIN_TEST_PASSWORD_HASH)).toBe(claim);
      expect(passwordClaim(encoder.encode(SECRET), ADMIN_TEST_OLD_PASSWORD_HASH)).not.toBe(claim);
      expect(passwordClaim(encoder.encode(OTHER_SECRET), ADMIN_TEST_PASSWORD_HASH)).not.toBe(claim);
    });

    test("a new password hash closes the sessions of the old one, and new sessions work", async () => {
      const token = await createSessionToken(SID);
      expect(await verifySessionToken(token)).toBe(true);

      vi.stubEnv("ADMIN_PASSWORD_HASH", ADMIN_TEST_OLD_PASSWORD_HASH);

      expect(await verifySessionToken(token)).toBe(false);
      expect(await readSessionClaims(token)).toBeNull();
      const fresh = await createSessionToken(SID);
      expect(await verifySessionToken(fresh)).toBe(true);
      expect(fresh).not.toBe(token);
    });

    test("rejects a session from before the claim existed", async () => {
      expect(await verifySessionToken(await signToken({ claim: null }))).toBe(false);
    });

    test.each([
      ["from another password hash", () => passwordClaim(encoder.encode(SECRET), ADMIN_TEST_OLD_PASSWORD_HASH)],
      ["from another secret", () => passwordClaim(encoder.encode(OTHER_SECRET), ADMIN_TEST_PASSWORD_HASH)],
      ["of the wrong length", () => passwordClaim(encoder.encode(SECRET), ADMIN_TEST_PASSWORD_HASH).slice(0, 15)],
      ["empty", () => ""],
    ])("rejects a claim %s", async (_label, makeClaim) => {
      expect(await verifySessionToken(await signToken({ claim: makeClaim() }))).toBe(false);
    });

    test("rejects a claim that is not text", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ [PASSWORD_CLAIM]: 1234567890123456, sid: SID })
        .setProtectedHeader({ alg: "HS256" })
        .setAudience(SESSION_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + HOUR_SECONDS)
        .sign(encoder.encode(SECRET));

      expect(await verifySessionToken(token)).toBe(false);
    });

    test("no session is valid, or can be created, without a usable password hash", async () => {
      const token = await createSessionToken(SID);

      for (const hash of ["", "no-es-un-hash"]) {
        vi.stubEnv("ADMIN_PASSWORD_HASH", hash);
        expect(await verifySessionToken(token)).toBe(false);
        await expect(createSessionToken(SID)).rejects.toThrow(/ADMIN_PASSWORD_HASH/);
      }
    });
  });

  describe("the session id", () => {
    test("travels in the sid claim, and readSessionClaims gives it back", async () => {
      const token = await createSessionToken(SID);

      expect(decodePart(token.split(".")[1]).sid).toBe(SID);
      expect(await readSessionClaims(token)).toEqual({ sessionId: SID });
    });

    test("a signed token with a well-formed id is valid for the proxy even if the database never heard of it", async () => {
      // El `proxy` solo hace la verificación criptográfica: quien dice si la sesión existe es `requireAdmin()`.
      const token = await signToken({ sid: randomBytes(32).toString("base64url") });

      expect(await verifySessionToken(token)).toBe(true);
    });

    test("a session from before ids existed no longer opens anything", async () => {
      const token = await signToken({ sid: null });

      expect(await readSessionClaims(token)).toBeNull();
      expect(await verifySessionToken(token)).toBe(false);
    });

    test.each([
      ["an empty id", ""],
      ["an id that is too short", SID.slice(0, 42)],
      ["an id that is too long", `${SID}A`],
      ["an id with a plus sign", `${SID.slice(0, 42)}+`],
      ["an id with a slash", `${SID.slice(0, 42)}/`],
      ["an id with padding", `${SID.slice(0, 42)}=`],
      ["an id with a space", `${SID.slice(0, 42)} `],
      ["an id with a line break", `${SID.slice(0, 42)}\n`],
    ])("rejects %s", async (_label, sid) => {
      const token = await signToken({ sid });

      expect(await readSessionClaims(token)).toBeNull();
      expect(await verifySessionToken(token)).toBe(false);
    });

    test.each([
      ["a number", 12345],
      ["a list", [SID]],
      ["an object", { id: SID }],
      ["null", null],
    ])("rejects an id that is %s", async (_label, sid) => {
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({
        [PASSWORD_CLAIM]: passwordClaim(encoder.encode(SECRET), ADMIN_TEST_PASSWORD_HASH),
        sid,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setAudience(SESSION_AUDIENCE)
        .setIssuedAt(now)
        .setExpirationTime(now + HOUR_SECONDS)
        .sign(encoder.encode(SECRET));

      expect(await readSessionClaims(token)).toBeNull();
    });

    test.each([
      ["expired", () => signToken({ expiresInSeconds: -10 })],
      ["for another audience", () => signToken({ audience: "otro-sitio" })],
      ["signed with another secret", () => signToken({ secret: OTHER_SECRET })],
      ["signed with another algorithm", () => signToken({ alg: "HS512" })],
      ["without an expiry", () => signToken({ withExpiration: false })],
      ["from another password", () => signToken({ claim: passwordClaim(encoder.encode(SECRET), ADMIN_TEST_OLD_PASSWORD_HASH) })],
    ])("gives nothing back for a token %s, even with a good id", async (_label, makeToken) => {
      expect(await readSessionClaims(await makeToken())).toBeNull();
    });

    test.each([undefined, "", "abc", "a.b.c", "....", " "])("gives nothing back for the garbage value %j", async (token) => {
      expect(await readSessionClaims(token)).toBeNull();
    });

    test("gives nothing back, and does not throw, when the secret is missing", async () => {
      const token = await signToken();
      vi.stubEnv("ADMIN_SESSION_SECRET", "");

      expect(await readSessionClaims(token)).toBeNull();
    });

    test("the cookie lasts as long as the longest session: eight hours", () => {
      expect(sessionCookieOptions(true)).toEqual({
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        path: "/admin",
        maxAge: 8 * HOUR_SECONDS,
      });
      expect(sessionCookieOptions(false).secure).toBe(false);
    });
  });

  test("creates a token that verifies, for eight hours and for the panel only", async () => {
    const token = await createSessionToken(SID);

    expect(await verifySessionToken(token)).toBe(true);
    const [rawHeader, rawPayload] = token.split(".");
    const payload = decodePart(rawPayload);
    expect(decodePart(rawHeader)).toMatchObject({ alg: "HS256" });
    expect(payload.aud).toBe("tallami-admin");
    expect(Number(payload.exp) - Number(payload.iat)).toBe(8 * HOUR_SECONDS);
    expect(ADMIN_COOKIE).toBe("tallami_admin");
  });

  test("refuses to sign a token for something that is not a session id", async () => {
    for (const sid of ["", "corto", `${SID}A`, "a".repeat(42) + "+"]) {
      await expect(createSessionToken(sid)).rejects.toThrow(/id de sesión/);
    }
  });

  test("rejects tampered, expired or foreign-audience tokens", async () => {
    const valid = await signToken();
    expect(await verifySessionToken(valid)).toBe(true);
    const [header, payload, signature] = valid.split(".");

    // Payload cambiado (vence en un año) con la firma de antes.
    const stretched = encodePart({ ...decodePart(payload), exp: 4_102_444_800 });
    expect(await verifySessionToken(`${header}.${stretched}.${signature}`)).toBe(false);
    // Firma alterada. Se cambia un carácter del medio: los dos últimos bits del último
    // carácter base64url de una firma de 32 bytes son relleno, y cambiarlo (A por B) no
    // cambia los bytes, así que la prueba pasaría sin alterar nada.
    const middle = Math.floor(signature.length / 2);
    const flipped = `${signature.slice(0, middle)}${signature[middle] === "A" ? "B" : "A"}${signature.slice(middle + 1)}`;
    expect(flipped).not.toBe(signature);
    expect(await verifySessionToken(`${header}.${payload}.${flipped}`)).toBe(false);
    // Vencido.
    expect(await verifySessionToken(await signToken({ expiresInSeconds: -10 }))).toBe(false);
    // Otra audiencia.
    expect(await verifySessionToken(await signToken({ audience: "otro-sitio" }))).toBe(false);
    // Otro secreto.
    expect(await verifySessionToken(await signToken({ secret: OTHER_SECRET }))).toBe(false);
  });

  test("rejects tokens that skip the signature, the algorithm or the expiry", async () => {
    const payload = { aud: "tallami-admin", sid: SID, exp: Math.floor(Date.now() / 1000) + HOUR_SECONDS };
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
    await expect(createSessionToken(SID)).rejects.toThrow();

    const short = "x".repeat(31);
    vi.stubEnv("ADMIN_SESSION_SECRET", short);
    expect(await verifySessionToken(await signToken({ secret: short }))).toBe(false);
    await expect(createSessionToken(SID)).rejects.toThrow();
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
  test("offers only the reservation API the login uses", async () => {
    // Las funciones viejas (mirar si está bloqueada y anotar después) dejaban pasar una ráfaga.
    const exported = Object.keys(await import("@/admin/auth/rate-limit")).sort();

    expect(exported).toEqual(["LOGIN_MAX_FAILURES", "LOGIN_WINDOW_MS", "confirmLoginSuccess", "reserveLoginAttempt"]);
  });

  let db: Db;
  const now = new Date("2026-10-13T15:00:00.000Z");
  const IP = "hash-de-una-ip";

  beforeAll(async () => {
    db = await createTestDb();
  });

  beforeEach(async () => {
    await db.delete(loginAttempts);
  });

  /** Intentos ya resueltos de `ipHash` a la hora `at`, escritos directo en la tabla. */
  async function seed(count: number, succeeded: boolean, ipHash = IP, at = now): Promise<void> {
    await db.insert(loginAttempts).values(Array.from({ length: count }, () => ({ ipHash, succeeded, createdAt: at })));
  }

  /** ¿Se rechaza hoy un intento de `ipHash`? Reservarlo es la única forma de preguntarlo: si entra, queda anotado. */
  async function isRefused(ipHash = IP, at = now): Promise<boolean> {
    return (await reserveLoginAttempt(db, ipHash, at)) === null;
  }

  test("blocks an ip after five failures in fifteen minutes and frees it after", async () => {
    await seed(LOGIN_MAX_FAILURES - 1, false);
    // El quinto intento todavía entra (y queda anotado); el sexto ya no.
    expect(await isRefused()).toBe(false);

    expect(await isRefused()).toBe(true);
    expect(await isRefused(IP, new Date(now.getTime() + 14 * MINUTE_MS))).toBe(true);
    expect(await isRefused(IP, new Date(now.getTime() + LOGIN_WINDOW_MS))).toBe(false);
    expect(await isRefused(IP, new Date(now.getTime() + 16 * MINUTE_MS))).toBe(false);
  });

  test("keeps each ip apart", async () => {
    await seed(LOGIN_MAX_FAILURES, false);

    expect(await isRefused()).toBe(true);
    expect(await isRefused("hash-de-otra-ip")).toBe(false);
  });

  test("counts only failures: successful logins never block", async () => {
    await seed(10, true);
    await seed(LOGIN_MAX_FAILURES - 1, false);

    // Diez ingresos y cuatro fallos: el quinto intento entra; el sexto, no.
    expect(await isRefused()).toBe(false);
    expect(await isRefused()).toBe(true);
  });

  test("counts only the failures inside the window", async () => {
    await seed(LOGIN_MAX_FAILURES, false, IP, new Date(now.getTime() - 20 * MINUTE_MS));
    await seed(2, false);

    expect(await isRefused()).toBe(false);
  });

  test("forgets attempts after thirty days and keeps the recent ones", async () => {
    const longAgo = new Date(now.getTime() - 31 * 24 * 60 * MINUTE_MS);
    await seed(1, false, IP, longAgo);
    await seed(1, true, IP, new Date(now.getTime() - 5 * 24 * 60 * MINUTE_MS));

    await reserveLoginAttempt(db, IP, now);

    const rows = await db.select().from(loginAttempts);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.createdAt > longAgo)).toBe(true);
  });

  test("stores the ip hash and the outcome, nothing else", async () => {
    const id = await reserveLoginAttempt(db, IP, now);

    const [row] = await db.select().from(loginAttempts);
    expect(row).toMatchObject({ id, ipHash: IP, succeeded: false, createdAt: now });
  });

  describe("reserving a slot before checking the password", () => {
    test("hands out one slot per attempt and refuses the sixth without leaving a trace", async () => {
      const ids: (number | null)[] = [];
      for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
        ids.push(await reserveLoginAttempt(db, IP, now));
      }

      expect(ids.every((id) => typeof id === "number")).toBe(true);
      expect(await reserveLoginAttempt(db, IP, now)).toBeNull();
      expect(await db.select().from(loginAttempts)).toHaveLength(LOGIN_MAX_FAILURES);
    });

    test("counts a reservation as a failure until it is confirmed as a success", async () => {
      const ids: number[] = [];
      for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
        const id = await reserveLoginAttempt(db, IP, now);
        if (id === null) throw new Error("the reservation should not be refused");
        ids.push(id);
      }
      expect(await isRefused()).toBe(true);

      await confirmLoginSuccess(db, ids[0]);

      const confirmed = await db.select().from(loginAttempts);
      expect(confirmed.filter((row) => row.succeeded)).toHaveLength(1);
      expect(typeof (await reserveLoginAttempt(db, IP, now))).toBe("number");
    });

    test("keeps each ip apart and frees the slots after the window", async () => {
      for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) await reserveLoginAttempt(db, IP, now);

      expect(await reserveLoginAttempt(db, "hash-de-otra-ip", now)).not.toBeNull();
      const later = new Date(now.getTime() + LOGIN_WINDOW_MS);
      expect(await reserveLoginAttempt(db, IP, later)).not.toBeNull();
    });
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

  test("lets the right password in after earlier failures below the limit", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i += 1) {
      expect(await attemptLogin(db, IP, "incorrecta")).toBe("invalid");
    }

    expect(await attemptLogin(db, IP, PASSWORD)).toBe("ok");

    const rows = await db.select().from(loginAttempts);
    expect(rows.filter((row) => row.succeeded)).toHaveLength(1);
    expect(rows.filter((row) => !row.succeeded)).toHaveLength(LOGIN_MAX_FAILURES - 1);
    expect(await reserveLoginAttempt(db, IP, new Date())).not.toBeNull();
  });

  test("never checks the password while blocked", async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) await attemptLogin(db, IP, "incorrecta");
    vi.mocked(verifyPassword).mockClear();

    expect(await attemptLogin(db, IP, PASSWORD)).toBe("blocked");
    expect(await attemptLogin(db, IP, "incorrecta")).toBe("blocked");

    expect(verifyPassword).not.toHaveBeenCalled();
  });

  test("simultaneous attempts cannot get past the limit: at most five passwords are checked", async () => {
    vi.mocked(verifyPassword).mockClear();

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => attemptLogin(db, IP, `incorrecta-${i}`)),
    );

    const checked = results.filter((result) => result === "invalid").length;
    expect(checked).toBeLessThanOrEqual(LOGIN_MAX_FAILURES);
    expect(results.filter((result) => result === "blocked")).toHaveLength(20 - checked);
    // Las bloqueadas no llegaron a scrypt.
    expect(verifyPassword).toHaveBeenCalledTimes(checked);
    expect(await db.select().from(loginAttempts)).toHaveLength(checked);
  });

  test("a right password among simultaneous failures below the limit still gets in", async () => {
    const results = await Promise.all([
      attemptLogin(db, IP, "incorrecta-1"),
      attemptLogin(db, IP, "incorrecta-2"),
      attemptLogin(db, IP, PASSWORD),
      attemptLogin(db, IP, "incorrecta-3"),
    ]);

    expect(results).toEqual(["invalid", "invalid", "ok", "invalid"]);
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
