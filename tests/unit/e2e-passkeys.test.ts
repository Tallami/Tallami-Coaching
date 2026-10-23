import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { authenticationOptions, verifyAuthentication } from "@/admin/auth/ceremonies";
import { countPasskeys, listPasskeys } from "@/admin/auth/passkeys";
import { assertTestDatabase, seedE2ePasskeys } from "../helpers/seed-e2e-passkeys";
import { createTestDb } from "../helpers/db";
import { createVirtualAuthenticator } from "../helpers/virtual-authenticator";
import { SEEDED_SLOTS, nextSignCount, testPasskey } from "../helpers/webauthn";

// Las llaves con las que los e2e entran al panel: el seed las registra en la base
// del servidor de prueba y el autenticador virtual de Chrome firma con ellas. Si no
// coincidieran, todos los e2e del panel fallarían en el login sin decir por qué.

const SCRIPT = fileURLToPath(new URL("../helpers/seed-e2e-passkeys.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url));
const ORIGIN = "http://localhost:3100";

beforeEach(() => {
  vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", ORIGIN);
  vi.stubEnv("VERCEL_ENV", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("testPasskey", () => {
  test("is always the same key for the same slot, and a different one for each slot", () => {
    expect(testPasskey(3)).toEqual(testPasskey(3));

    const ids = Array.from({ length: SEEDED_SLOTS }, (_, slot) => testPasskey(slot).credentialId);
    expect(new Set(ids).size).toBe(SEEDED_SLOTS);
    for (const id of ids) expect(Buffer.from(id, "base64url")).toHaveLength(16);
  });

  test("its public key verifies what its private key signs, through the real verification of the panel", async () => {
    const key = testPasskey(5);
    const device = createVirtualAuthenticator({ rpID: "localhost", origin: ORIGIN }, key);
    const passkey = {
      id: "00000000-0000-4000-8000-000000000005",
      credentialId: key.credentialId,
      publicKey: key.publicKeyCose,
      counter: 0,
      transports: ["internal"],
      name: "Llave de prueba 5",
      createdAt: new Date(),
      lastUsedAt: null,
    };
    const options = await authenticationOptions([passkey]);

    const verified = await verifyAuthentication(device.authenticate(options, { counter: 7 }), options.challenge, passkey);

    expect(verified).toEqual({ newCounter: 7 });
  });
});

describe("nextSignCount", () => {
  test("starts at the seconds since 2026 and always goes up, slot by slot", () => {
    const now = Date.UTC(2026, 9, 21, 12, 0, 0);
    const seconds = (now - Date.UTC(2026, 0, 1)) / 1000;

    expect(nextSignCount(1000, now)).toBe(seconds);
    expect(nextSignCount(1000, now)).toBe(seconds + 1);
    expect(nextSignCount(1000, now - 60_000)).toBe(seconds + 2);
    expect(nextSignCount(1001, now)).toBe(seconds);
    expect(nextSignCount(1000, now + 3_600_000)).toBe(seconds + 3600);
  });
});

describe("seedE2ePasskeys", () => {
  test("registers the keys of every slot once, even when it runs again", async () => {
    const db = await createTestDb();

    expect(await seedE2ePasskeys(db)).toBe(SEEDED_SLOTS);
    expect(await seedE2ePasskeys(db)).toBe(0);

    expect(await countPasskeys(db)).toBe(SEEDED_SLOTS);
    const stored = await listPasskeys(db);
    expect(stored.map(({ credentialId }) => credentialId).sort()).toEqual(
      Array.from({ length: SEEDED_SLOTS }, (_, slot) => testPasskey(slot).credentialId).sort(),
    );
    expect(stored.every(({ counter }) => counter === 0)).toBe(true);
  });

  test("only runs for the database of a test server", () => {
    expect(() => assertTestDatabase({ PGLITE_DIR: "/tmp/e2e" })).not.toThrow();
    expect(() => assertTestDatabase({ PGLITE_DIR: "/tmp/e2e", DATABASE_URL: "postgres://x" })).toThrow(/DATABASE_URL/);
    expect(() => assertTestDatabase({})).toThrow(/PGLITE_DIR/);
    expect(() => assertTestDatabase({ PGLITE_DIR: "  " })).toThrow(/PGLITE_DIR/);
  });

  test("the script itself refuses the development database before opening anything", () => {
    const withoutFolder = spawnSync(process.execPath, [TSX, SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "", PGLITE_DIR: "" },
    });
    const remote = spawnSync(process.execPath, [TSX, SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: "postgres://user:clave@127.0.0.1:1/none", PGLITE_DIR: "/tmp/no-se-usa" },
    });

    expect(withoutFolder.status).toBe(1);
    expect(withoutFolder.stderr).toContain("PGLITE_DIR");
    expect(remote.status).toBe(1);
    expect(remote.stderr).toContain("DATABASE_URL");
  });
});
