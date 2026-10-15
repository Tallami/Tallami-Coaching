import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { demoServerEnv } from "./tests/helpers/admin-server";

// Segundo servidor de Playwright, para los tests que verifican totales (el
// resumen): el mismo build que el servidor principal pero con su propia base
// PGlite, cargada con `buildDemoData(hoy en Argentina)` antes de arrancar.
// Nadie escribe en esa base: los tests son de solo lectura, así los números
// esperados salen de los mismos datos de ejemplo con las mismas funciones puras.
//
//   npm run test:e2e        # los dos configs, uno después del otro
//   npm run test:e2e:demo   # solo este (arma el build si todavía no existe)

const PORT = 3101;
const BASE_URL = `http://localhost:${PORT}`;
/** El build lo arma el servidor principal (`playwright.config.ts`); acá se reutiliza. */
const HAS_BUILD = existsSync(path.join(process.cwd(), ".next", "BUILD_ID"));

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/admin-overview.spec.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Sembrar y recién entonces levantar: PGlite no admite dos procesos a la vez
    // en la misma carpeta. `db:seed:demo` se niega si hubiera `DATABASE_URL`
    // (el entorno de abajo la deja vacía).
    command: `${HAS_BUILD ? "" : "npm run build && "}npm run db:seed:demo && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    // Nunca se reutiliza un servidor que ya esté en el puerto: tiene que ser el sembrado acá.
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      TWEETS_SOURCE: "snapshots",
      ...(await demoServerEnv()),
    },
  },
});
