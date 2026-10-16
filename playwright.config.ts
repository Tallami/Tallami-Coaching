import { defineConfig, devices } from "@playwright/test";
import { adminServerEnv } from "./tests/helpers/admin-server";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Los tests que verifican totales corren con los datos de ejemplo, en el
  // servidor de `playwright.demo.config.ts` (`npm run test:e2e` corre los dos).
  testIgnore: ["**/admin-overview.spec.ts", "**/admin-services-demo.spec.ts"],
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
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      // El build usa solo las copias guardadas de los tweets
      // (`src/content/tweet-snapshots`, ver `src/lib/tweets.ts`): los e2e no
      // dependen de la red ni de que X siga mostrando esos tweets.
      TWEETS_SOURCE: "snapshots",
      // Panel de admin: contraseña y secreto de prueba, una base PGlite
      // vacía en una carpeta temporal (se borra al arrancar) y cotizaciones
      // fijas en lugar del BCRA (ver `tests/helpers/admin-server.ts`).
      ...(await adminServerEnv()),
    },
  },
});
