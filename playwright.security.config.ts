import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { E2E_PORTS, e2eBaseUrl, securityServerEnv } from "./tests/helpers/admin-server";

// Tercer servidor de Playwright, para los e2e que cambian la seguridad del ingreso
// de todo el panel (registrar la primera llave, borrar llaves, cerrar todas las
// sesiones, la recuperación): el mismo build con su propia base PGlite, vacía y
// SIN llaves, así el primer test pasa por "registrar la primera llave". Un solo
// archivo (`tests/e2e/admin-security.spec.ts`), un solo worker, en serie: cada test
// parte de lo que dejó el anterior.
//
//   npm run test:e2e            # los tres configs, uno después del otro (el build lo arma el primero)
//   npm run test:e2e:security   # solo este: arma el build y corre (así no usa uno viejo)

const PORT = E2E_PORTS.security;
const BASE_URL = e2eBaseUrl(PORT);
/** Igual que en `playwright.demo.config.ts`: el build del servidor principal, o uno nuevo si falta o si la tanda corre sola. */
const NEEDS_BUILD =
  !existsSync(path.join(process.cwd(), ".next", "BUILD_ID")) ||
  process.env.npm_lifecycle_event === "test:e2e:security";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["**/admin-security.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // Sin reintentos: cada test depende del estado que dejó el anterior en la base, y
  // repetir la tanda contra la misma base ya no empezaría sin llaves.
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `${NEEDS_BUILD ? "npm run build && " : ""}npm run start -- --port ${PORT}`,
    url: BASE_URL,
    // Nunca se reutiliza un servidor que ya esté en el puerto: tiene que empezar sin llaves.
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      TWEETS_SOURCE: "snapshots",
      ...(await securityServerEnv()),
    },
  },
});
