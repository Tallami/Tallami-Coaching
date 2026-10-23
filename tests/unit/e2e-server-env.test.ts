import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { verifyPassword } from "@/admin/auth/password";
import {
  ADMIN_TEST_OLD_PASSWORD_HASH,
  ADMIN_TEST_PASSWORD,
  ADMIN_TEST_PASSWORD_HASH,
  adminServerEnv,
  demoServerEnv,
  securityServerEnv,
} from "../helpers/admin-server";

// Importar los helpers o las configuraciones de Playwright arma el entorno del
// servidor y, en el proceso principal, borra la carpeta de la base de los e2e:
// con `TEST_WORKER_INDEX` definido se comportan como un worker y no borran nada.
beforeEach(() => {
  vi.stubEnv("TEST_WORKER_INDEX", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** El entorno con el que una configuración de Playwright arranca su servidor. */
async function serverEnvOf(configPath: string): Promise<Record<string, string>> {
  const config = (await import(configPath)).default as {
    webServer?: { env?: Record<string, string> } | { env?: Record<string, string> }[];
  };
  const servers = [config.webServer].flat();
  expect(servers).toHaveLength(1);
  return servers[0]?.env ?? {};
}

const CONFIGS = [
  ["main", "../../playwright.config", 3100],
  ["demo", "../../playwright.demo.config", 3101],
  ["security", "../../playwright.security.config", 3102],
] as const;

/** La configuración de Playwright tal como la carga Playwright (lo que se mira de cada una). */
async function configOf(configPath: string) {
  return (await import(configPath)).default as {
    testIgnore?: string[];
    testMatch?: string[];
    workers?: number;
    fullyParallel?: boolean;
    use?: { baseURL?: string };
    webServer?: { command?: string; reuseExistingServer?: boolean };
  };
}

describe("environment of the e2e servers", () => {
  test("every server blanks DATABASE_URL, so no test can write to a remote database", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://usuario:clave@db.example.com:6543/postgres");

    expect((await adminServerEnv()).DATABASE_URL).toBe("");
    expect((await demoServerEnv()).DATABASE_URL).toBe("");
    expect((await securityServerEnv()).DATABASE_URL).toBe("");
  });

  test.each(CONFIGS)("the %s Playwright config starts its server with DATABASE_URL blank", async (_name, config) => {
    vi.stubEnv("DATABASE_URL", "postgres://usuario:clave@db.example.com:6543/postgres");

    expect((await serverEnvOf(config)).DATABASE_URL).toBe("");
  });

  test.each(CONFIGS)(
    "the %s server never reads the .env files of the machine: they could bring a real database or a mangled hash",
    async (_name, config) => {
      // Next salta la lectura de `.env*` si el entorno ya viene "procesado" (`@next/env`).
      expect((await serverEnvOf(config)).__NEXT_PROCESSED_ENV).toBe("true");
    },
  );

  test.each(CONFIGS)("the %s server expects passkeys from its own address", async (_name, config, port) => {
    const loaded = await configOf(config);

    expect((await serverEnvOf(config)).ADMIN_WEBAUTHN_ORIGIN).toBe(`http://localhost:${port}`);
    expect(loaded.use?.baseURL).toBe(`http://localhost:${port}`);
  });

  test("the main and the demo servers get the test passkeys before they start; the security one starts with none", async () => {
    const main = await configOf("../../playwright.config");
    const demo = await configOf("../../playwright.demo.config");
    const security = await configOf("../../playwright.security.config");

    for (const command of [main.webServer?.command ?? "", demo.webServer?.command ?? ""]) {
      expect(command).toMatch(/seed-e2e-passkeys\.ts && npm run start/);
    }
    expect(security.webServer?.command ?? "").not.toContain("seed-e2e-passkeys");
    expect(security.webServer?.reuseExistingServer).toBe(false);
  });

  test("the security spec runs alone, one test after the other, only on its own server", async () => {
    const main = await configOf("../../playwright.config");
    const demo = await configOf("../../playwright.demo.config");
    const security = await configOf("../../playwright.security.config");

    expect(main.testIgnore).toContain("**/admin-security.spec.ts");
    expect(demo.testIgnore).toContain("**/admin-security.spec.ts");
    expect(security.testMatch).toEqual(["**/admin-security.spec.ts"]);
    expect(security.workers).toBe(1);
    expect(security.fullyParallel).toBe(false);
  });

  test("both servers use the fixed password hash, which is the hash of the test password", async () => {
    // Un hash fijo y no uno nuevo por proceso: las sesiones que firman los tests
    // llevan un claim derivado del hash, y la sal al azar daría uno distinto en cada worker.
    expect((await adminServerEnv()).ADMIN_PASSWORD_HASH).toBe(ADMIN_TEST_PASSWORD_HASH);
    expect((await demoServerEnv()).ADMIN_PASSWORD_HASH).toBe(ADMIN_TEST_PASSWORD_HASH);
    expect(await verifyPassword(ADMIN_TEST_PASSWORD, ADMIN_TEST_PASSWORD_HASH)).toBe(true);
  });

  test("the old password hash is a valid hash that is not the current one and does not open the test password", async () => {
    // Una sola definición para los tests unitarios y los e2e: una sesión firmada
    // con este hash tiene que dejar de valer, y un hash que no se puede leer
    // la haría fallar por otro motivo.
    expect(ADMIN_TEST_OLD_PASSWORD_HASH).not.toBe(ADMIN_TEST_PASSWORD_HASH);
    expect(ADMIN_TEST_OLD_PASSWORD_HASH.split("$")).toHaveLength(ADMIN_TEST_PASSWORD_HASH.split("$").length);
    expect(await verifyPassword(ADMIN_TEST_PASSWORD, ADMIN_TEST_OLD_PASSWORD_HASH)).toBe(false);
  });

  test("each server has its own database folder and the fixed exchange rates", async () => {
    const main = await adminServerEnv();
    const demo = await demoServerEnv();
    const security = await securityServerEnv();

    expect(new Set([main.PGLITE_DIR, demo.PGLITE_DIR, security.PGLITE_DIR]).size).toBe(3);
    for (const env of [main, demo, security]) {
      expect(env.EXCHANGE_RATE_SOURCE).toBe("fixed");
      expect(env.ADMIN_SESSION_SECRET).toBe(main.ADMIN_SESSION_SECRET);
      expect(env.ADMIN_PASSWORD_HASH).toBe(ADMIN_TEST_PASSWORD_HASH);
    }
  });
});
