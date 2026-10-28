import { defineConfig, devices } from "@playwright/test";
import {
  E2E_PORTS,
  MOCK_OAUTH_SERVER_COMMAND,
  SEED_E2E_PASSKEYS_COMMAND,
  adminServerEnv,
  e2eBaseUrl,
} from "./tests/helpers/admin-server";

const PORT = E2E_PORTS.main;
const BASE_URL = e2eBaseUrl(PORT);

export default defineConfig({
  testDir: "./tests/e2e",
  // Los tests que verifican totales corren con los datos de ejemplo, en el
  // servidor de `playwright.demo.config.ts`, y los que cambian la seguridad del
  // ingreso (la primera llave, cerrar todo) en el de `playwright.security.config.ts`
  // (`npm run test:e2e` corre los tres).
  testIgnore: [
    "**/admin-overview.spec.ts",
    "**/admin-services-demo.spec.ts",
    "**/admin-billing-demo.spec.ts",
    "**/admin-quality.spec.ts",
    "**/admin-security.spec.ts",
  ],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Las llaves de prueba se registran antes de levantar el servidor: los tests
      // entran al panel con contraseña y llave (`loginAsAdmin`).
      command: `npm run build && ${SEED_E2E_PASSKEYS_COMMAND} && npm run start -- --port ${PORT}`,
      url: BASE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        // El build usa solo las copias guardadas de los tweets
        // (`src/content/tweet-snapshots`, ver `src/lib/tweets.ts`): los e2e no
        // dependen de la red ni de que X siga mostrando esos tweets.
        TWEETS_SOURCE: "snapshots",
        // Panel de admin: contraseña y secreto de prueba, una base PGlite
        // vacía en una carpeta temporal (se borra al arrancar), las llaves de
        // acceso de esta dirección y cotizaciones fijas en lugar del BCRA; y el
        // portal del alumno con el proveedor de prueba (ver
        // `tests/helpers/admin-server.ts`).
        ...(await adminServerEnv()),
      },
    },
    {
      // El proveedor de prueba del portal del alumno: un servidor OAuth falso, en Node
      // puro, que vuelve enseguida con un código (`tests/helpers/mock-oauth-server.mjs`).
      // Ningún e2e habla con Discord ni con Google.
      command: MOCK_OAUTH_SERVER_COMMAND,
      url: `${e2eBaseUrl(E2E_PORTS.oauth)}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { MOCK_OAUTH_PORT: String(E2E_PORTS.oauth) },
    },
  ],
});
