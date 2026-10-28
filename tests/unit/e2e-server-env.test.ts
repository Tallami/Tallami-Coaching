import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { verifyPassword } from "@/admin/auth/password";
import {
  ADMIN_TEST_OLD_PASSWORD_HASH,
  ADMIN_TEST_PASSWORD,
  ADMIN_TEST_PASSWORD_HASH,
  E2E_PORTS,
  SEED_E2E_PASSKEYS_COMMAND,
  adminServerEnv,
  demoServerEnv,
  securityServerEnv,
} from "../helpers/admin-server";
import { assertTestDatabase } from "../helpers/seed-e2e-passkeys";

/** Los archivos de código de una carpeta, con sus subcarpetas. */
function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(tsx?|mjs|jsx?)$/.test(entry.name) ? [full] : [];
  });
}

// Importar los helpers o las configuraciones de Playwright arma el entorno del
// servidor y, en el proceso principal, borra la carpeta de la base de los e2e:
// con `TEST_WORKER_INDEX` definido se comportan como un worker y no borran nada.
beforeEach(() => {
  vi.stubEnv("TEST_WORKER_INDEX", "0");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const CONFIGS = [
  ["main", "../../playwright.config", 3100],
  ["demo", "../../playwright.demo.config", 3101],
  ["security", "../../playwright.security.config", 3102],
] as const;

interface WebServer {
  command?: string;
  url?: string;
  reuseExistingServer?: boolean;
  env?: Record<string, string>;
}

/** La configuración de Playwright tal como la carga Playwright (lo que se mira de cada una). */
async function configOf(configPath: string) {
  return (await import(configPath)).default as {
    testIgnore?: string[];
    testMatch?: string[];
    workers?: number;
    fullyParallel?: boolean;
    use?: { baseURL?: string };
    webServer?: WebServer | WebServer[];
  };
}

/** Los servidores que arranca una configuración (uno solo, o una lista). */
async function serversOf(configPath: string): Promise<WebServer[]> {
  const config = await configOf(configPath);
  return [config.webServer ?? []].flat();
}

/** El servidor de la web de una configuración: el que contesta en su `baseURL`. */
async function appServerOf(configPath: string): Promise<WebServer> {
  const config = await configOf(configPath);
  const apps = (await serversOf(configPath)).filter((server) => server.url === config.use?.baseURL);
  expect(apps).toHaveLength(1);
  return apps[0];
}

/** El entorno con el que una configuración de Playwright arranca el servidor de la web. */
async function serverEnvOf(configPath: string): Promise<Record<string, string>> {
  return (await appServerOf(configPath)).env ?? {};
}

describe("environment of the e2e servers", () => {
  test("every server blanks DATABASE_URL, so no test can write to a remote database", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://usuario:clave@db.example.com:6543/postgres");

    expect((await adminServerEnv()).DATABASE_URL).toBe("");
    expect((await demoServerEnv()).DATABASE_URL).toBe("");
    expect((await securityServerEnv()).DATABASE_URL).toBe("");
  });

  test("every server blanks the email variables, so no test can send a real email and the panel says 'sin configurar'", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_una_clave_real");
    vi.stubEnv("ADMIN_ALERT_EMAIL", "alguien@example.com");
    vi.stubEnv("ADMIN_ALERT_FROM", "Panel <avisos@example.com>");

    for (const env of [await adminServerEnv(), await demoServerEnv(), await securityServerEnv()]) {
      expect(env.RESEND_API_KEY).toBe("");
      expect(env.ADMIN_ALERT_EMAIL).toBe("");
      expect(env.ADMIN_ALERT_FROM).toBe("");
    }
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
    const main = await appServerOf("../../playwright.config");
    const demo = await appServerOf("../../playwright.demo.config");
    const security = await appServerOf("../../playwright.security.config");

    for (const command of [main.command ?? "", demo.command ?? ""]) {
      expect(command).toMatch(/npm run e2e:seed-passkeys && npm run start/);
    }
    expect(security.command ?? "").not.toContain("seed-passkeys");
    expect(security.reuseExistingServer).toBe(false);
  });

  test("no server command goes through npx: a missing tool must fail, never be downloaded from the network", async () => {
    // `npx tsx` baja tsx de internet si no está instalado; un script de npm usa el de `node_modules` o falla.
    for (const [, config] of CONFIGS) {
      for (const server of await serversOf(config)) {
        expect(server.command ?? "").not.toMatch(/\bnpx\b/);
      }
    }
  });

  test("the main config also starts the fake OAuth server on 3110, with plain node; the other two do not", async () => {
    const servers = await serversOf("../../playwright.config");
    const oauth = servers.filter((server) => server.command?.includes("mock-oauth-server"));

    expect(servers).toHaveLength(2);
    expect(oauth).toHaveLength(1);
    expect(oauth[0].command).toBe("node tests/helpers/mock-oauth-server.mjs");
    expect(oauth[0].url).toBe("http://localhost:3110/health");
    expect(oauth[0].env?.MOCK_OAUTH_PORT).toBe("3110");
    expect(E2E_PORTS.oauth).toBe(3110);
    for (const config of ["../../playwright.demo.config", "../../playwright.security.config"]) {
      expect(await serversOf(config)).toHaveLength(1);
    }
  });

  test("the main server enables the test provider against that fake server, with its own portal secret", async () => {
    const env = await adminServerEnv();

    expect(env.PORTAL_OAUTH_TEST_ISSUER).toBe("http://localhost:3110");
    expect(env.PORTAL_SESSION_SECRET.trim().length).toBeGreaterThanOrEqual(32);
    expect(env.PORTAL_SESSION_SECRET).not.toBe(env.ADMIN_SESSION_SECRET);
    // Los proveedores de verdad, vacíos: los e2e nunca hablan con Discord ni con Google.
    for (const name of ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) {
      expect(env[name], name).toBe("");
    }
    expect((await serverEnvOf("../../playwright.config")).PORTAL_OAUTH_TEST_ISSUER).toBe("http://localhost:3110");
  });

  test("the fake OAuth server is never part of the app: nothing under src imports it", () => {
    // Un `import … from "…mock-oauth-server…"` o un `import("…mock-oauth-server…")`; nombrarlo en un comentario no cuenta.
    const importsMock = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'][^"']*mock-oauth-server/;
    const offenders = listSourceFiles(path.join(process.cwd(), "src")).filter((file) =>
      importsMock.test(readFileSync(file, "utf8")),
    );

    expect(offenders).toEqual([]);
    expect(importsMock.test('import { x } from "../../tests/helpers/mock-oauth-server.mjs";')).toBe(true);
    expect(importsMock.test('await import("../tests/helpers/mock-oauth-server.mjs")')).toBe(true);
  });

  test("the passkey seeding is an npm script that runs the local tsx", () => {
    const { scripts } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(scripts["e2e:seed-passkeys"]).toBe("tsx tests/helpers/seed-e2e-passkeys.ts");
    expect(SEED_E2E_PASSKEYS_COMMAND).toBe("npm run e2e:seed-passkeys");
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
    // El seed de las llaves de prueba solo carga en una carpeta temporal: la de cada servidor lo es.
    for (const env of [main, demo]) {
      expect(() => assertTestDatabase({ DATABASE_URL: env.DATABASE_URL, PGLITE_DIR: env.PGLITE_DIR })).not.toThrow();
    }
    for (const env of [main, demo, security]) {
      expect(env.EXCHANGE_RATE_SOURCE).toBe("fixed");
      expect(env.ADMIN_SESSION_SECRET).toBe(main.ADMIN_SESSION_SECRET);
      expect(env.ADMIN_PASSWORD_HASH).toBe(ADMIN_TEST_PASSWORD_HASH);
    }
  });
});
