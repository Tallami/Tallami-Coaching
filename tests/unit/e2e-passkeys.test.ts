import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { authenticationOptions, verifyAuthentication } from "@/admin/auth/ceremonies";
import { countPasskeys, listPasskeys } from "@/admin/auth/passkeys";
import { assertTestDatabase, seedE2ePasskeys } from "../helpers/seed-e2e-passkeys";
import { createTestDb } from "../helpers/db";
import { createVirtualAuthenticator } from "../helpers/virtual-authenticator";
import {
  SEEDED_SLOTS,
  SIGN_COUNT_EPOCH_MS,
  SIGN_COUNT_LIMIT,
  SIGN_COUNT_TICK_MS,
  nextSignCount,
  testPasskey,
} from "../helpers/webauthn";

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
  // Lo que acepta Chrome (`WebAuthn.addCredential`): un entero de 32 bits con signo. Con 2147483648 la llave no se carga.
  const CHROME_MAX_SIGN_COUNT = 2 ** 31 - 1;
  const TICK_MS = SIGN_COUNT_TICK_MS;
  const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

  /** Un proceso nuevo (un worker de Playwright que arranca de cero, por ejemplo al reintentar un test): sin memoria de los contadores que dio el anterior. */
  async function freshProcess(): Promise<typeof nextSignCount> {
    vi.resetModules();
    return (await import("../helpers/webauthn")).nextSignCount;
  }

  test("the limit it keeps below is the one Chrome accepts, and the clock is finer than a second", () => {
    expect(SIGN_COUNT_LIMIT - 1).toBe(CHROME_MAX_SIGN_COUNT);
    expect(TICK_MS).toBeLessThanOrEqual(10);
  });

  test("follows a clock finer than a second, and goes up with the clock", () => {
    const first = nextSignCount(2000, NOW);
    const aTickLater = nextSignCount(2000, NOW + TICK_MS);
    const aSecondLater = nextSignCount(2000, NOW + 1000 + TICK_MS);

    expect(aTickLater - first).toBe(1);
    expect(aSecondLater - aTickLater).toBe(1000 / TICK_MS);
  });

  test("goes up by one on every load, even with the clock still, behind or repeated, slot by slot", () => {
    const first = nextSignCount(1000, NOW);

    expect(nextSignCount(1000, NOW)).toBe(first + 1);
    expect(nextSignCount(1000, NOW - 60_000)).toBe(first + 2);
    expect(nextSignCount(1000, NOW)).toBe(first + 3);
    // Otro slot lleva su propia cuenta: parte de la hora, no del otro.
    expect(nextSignCount(1001, NOW)).toBe(first);
  });

  test("a worker that restarts a few hundred milliseconds later starts above everything the old one reached", async () => {
    const oldWorker = await freshProcess();
    // El que murió hizo muchos ingresos seguidos con esta llave, más rápido de lo que anda el reloj.
    let last = 0;
    for (let load = 0; load < 20; load += 1) last = oldWorker(3, NOW);

    const newWorker = await freshProcess();
    const restarted = newWorker(3, NOW + 300);

    // El servidor guarda el contador con el que Chrome firmó, que es el cargado o uno más.
    expect(restarted).toBeGreaterThan(last + 1);
  });

  test("always fits in what Chrome accepts, whatever the date", () => {
    for (const year of [2026, 2027, 2030, 2040, 2100]) {
      for (const month of [0, 3, 6, 9]) {
        const value = nextSignCount(100 + year + month, Date.UTC(year, month, 17, 5, 30, 12));

        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(CHROME_MAX_SIGN_COUNT);
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });

  test("says so clearly if one slot is loaded so many times that it runs out of numbers, instead of failing inside Chrome", () => {
    // Justo antes del tope: en este mismo instante cada carga sube de a uno hasta pasarse.
    const edge = SIGN_COUNT_EPOCH_MS + (CHROME_MAX_SIGN_COUNT - 1) * TICK_MS;
    nextSignCount(4000, edge);

    expect(nextSignCount(4000, edge)).toBe(CHROME_MAX_SIGN_COUNT);
    expect(() => nextSignCount(4000, edge)).toThrow(/contador/);
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

  test("only runs for the database of a test server: a folder inside the system temp folder, and no DATABASE_URL", () => {
    const folder = path.join(os.tmpdir(), "tallami-coaching-e2e-pglite");

    expect(() => assertTestDatabase({ PGLITE_DIR: folder })).not.toThrow();
    expect(() => assertTestDatabase({ PGLITE_DIR: path.join(folder, "mas", "adentro") })).not.toThrow();
    expect(() => assertTestDatabase({ PGLITE_DIR: folder, DATABASE_URL: "postgres://x" })).toThrow(/DATABASE_URL/);
    expect(() => assertTestDatabase({})).toThrow(/PGLITE_DIR/);
    expect(() => assertTestDatabase({ PGLITE_DIR: "  " })).toThrow(/PGLITE_DIR/);
  });

  // Las claves privadas de estas llaves salen de un texto público: cualquier base que las tenga se puede abrir con ellas.
  test.each([
    ["the development database", ".data/pglite"],
    ["a folder of the project", path.join(process.cwd(), "otra-base")],
    ["a folder in the home", path.join(os.homedir(), "base")],
    ["the system temp folder itself", os.tmpdir()],
    ["a folder that only starts like the temp one", `${os.tmpdir()}-otra`],
    ["a path that climbs out of the temp folder", path.join(os.tmpdir(), "..", "base-de-verdad")],
  ])("refuses %s", (_label, folder) => {
    expect(() => assertTestDatabase({ PGLITE_DIR: folder })).toThrow(/carpeta temporal/);
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

  test("the script itself refuses a folder outside the system temp folder, and never creates it", () => {
    // Una carpeta hermana de la temporal: si el script no se negara, la crearía.
    const outside = path.join(os.tmpdir(), "..", `tallami-fuera-de-tmp-${process.pid}`);
    try {
      const result = spawnSync(process.execPath, [TSX, SCRIPT], {
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: "", PGLITE_DIR: outside },
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("carpeta temporal");
      expect(existsSync(outside)).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
