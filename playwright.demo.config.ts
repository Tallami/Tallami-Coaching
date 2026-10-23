import { existsSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { E2E_PORTS, SEED_E2E_PASSKEYS_COMMAND, demoServerEnv, e2eBaseUrl } from "./tests/helpers/admin-server";

// Segundo servidor de Playwright, para los tests que verifican totales (el
// resumen, Servicios, Facturación y la calidad de todo el panel): el mismo build que el servidor principal pero con su propia base
// PGlite, cargada con `buildDemoData(hoy en Argentina)` (alumnos, ventas y clics
// de ejemplo) antes de arrancar.
// Nadie escribe en esa base: los tests son de solo lectura, así los números
// esperados salen de los mismos datos de ejemplo con las mismas funciones puras.
//
//   npm run test:e2e        # los tres configs, uno después del otro (el build lo arma el primero)
//   npm run test:e2e:demo   # solo este: arma el build y corre (así no usa uno viejo)

const PORT = E2E_PORTS.demo;
const BASE_URL = e2eBaseUrl(PORT);
/**
 * El build lo arma el servidor principal (`playwright.config.ts`) y acá se
 * reutiliza. Se arma de nuevo (con las variables de abajo, sin red) cuando falta
 * o cuando la tanda se corre sola con `npm run test:e2e:demo`: npm avisa el
 * nombre del script en `npm_lifecycle_event`, y así esa tanda nunca usa un
 * build viejo.
 */
const NEEDS_BUILD =
  !existsSync(path.join(process.cwd(), ".next", "BUILD_ID")) ||
  process.env.npm_lifecycle_event === "test:e2e:demo";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: [
    "**/admin-overview.spec.ts",
    "**/admin-services-demo.spec.ts",
    "**/admin-billing-demo.spec.ts",
    "**/admin-quality.spec.ts",
  ],
  // La seguridad del ingreso tiene su propio servidor (`playwright.security.config.ts`).
  testIgnore: ["**/admin-security.spec.ts"],
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
    // en la misma carpeta. `db:seed:demo` y las llaves de prueba se niegan si
    // hubiera `DATABASE_URL` (el entorno de abajo la deja vacía).
    command: `${NEEDS_BUILD ? "npm run build && " : ""}npm run db:seed:demo && ${SEED_E2E_PASSKEYS_COMMAND} && npm run start -- --port ${PORT}`,
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
