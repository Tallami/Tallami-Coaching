import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { adminServerEnv, demoServerEnv } from "../helpers/admin-server";

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

describe("environment of the e2e servers", () => {
  test("both servers blank DATABASE_URL, so no test can write to a remote database", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://usuario:clave@db.example.com:6543/postgres");

    expect((await adminServerEnv()).DATABASE_URL).toBe("");
    expect((await demoServerEnv()).DATABASE_URL).toBe("");
  });

  test("the main and the demo Playwright configs start their servers with DATABASE_URL blank", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://usuario:clave@db.example.com:6543/postgres");

    expect((await serverEnvOf("../../playwright.config")).DATABASE_URL).toBe("");
    expect((await serverEnvOf("../../playwright.demo.config")).DATABASE_URL).toBe("");
  });

  test("each server has its own database folder and the fixed exchange rates", async () => {
    const main = await adminServerEnv();
    const demo = await demoServerEnv();

    expect(main.PGLITE_DIR).not.toBe(demo.PGLITE_DIR);
    expect(main.EXCHANGE_RATE_SOURCE).toBe("fixed");
    expect(demo.EXCHANGE_RATE_SOURCE).toBe("fixed");
    expect(main.ADMIN_SESSION_SECRET).toBe(demo.ADMIN_SESSION_SECRET);
  });
});
