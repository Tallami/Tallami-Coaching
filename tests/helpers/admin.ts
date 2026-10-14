// Ayudas de los e2e del panel: un `test` donde cada test navega con su propia
// IP, tokens de sesión (válidos o falsos) y el inicio de sesión.

import { expect, test as base, type Page } from "@playwright/test";
import { SignJWT } from "jose";
import { ADMIN_TEST_PASSWORD, ADMIN_TEST_SESSION_SECRET } from "./admin-server";

export { ADMIN_TEST_PASSWORD, ADMIN_TEST_SESSION_SECRET };

/** Cookie y audiencia del panel (los valores reales viven en `src/admin/auth/session.ts`). */
export const ADMIN_COOKIE = "tallami_admin";
export const ADMIN_AUDIENCE = "tallami-admin";

const SECONDS_PER_HOUR = 3600;
const SESSION_HOURS = 12;

/** IP privada al azar: cada test tiene la suya, así el límite de intentos no se pisa entre tests en paralelo. */
export function uniqueTestIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

/**
 * `test` de Playwright donde cada test navega con su propia IP de cliente
 * (`x-forwarded-for`, como la manda Vercel). Se usa en todos los e2e del panel.
 */
export const test = base.extend({
  // (El segundo parámetro se llama `provide` y no `use`: ESLint confunde el
  // `use` de los fixtures de Playwright con el hook de React.)
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": uniqueTestIp() });
  },
});

export { expect };

interface TokenOptions {
  secret?: string;
  audience?: string;
  /** Segundos desde ahora; negativo = ya vencido. */
  expiresInSeconds?: number;
  alg?: "HS256" | "HS512";
}

/** Firma una sesión como lo hace el panel; con opciones, una falsa o vencida. */
export async function signTestToken({
  secret = ADMIN_TEST_SESSION_SECRET,
  audience = ADMIN_AUDIENCE,
  expiresInSeconds = SESSION_HOURS * SECONDS_PER_HOUR,
  alg = "HS256",
}: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg })
    .setAudience(audience)
    .setIssuedAt(now - SECONDS_PER_HOUR)
    .setExpirationTime(now + expiresInSeconds)
    .sign(new TextEncoder().encode(secret));
}

/** Entra al panel con la contraseña de prueba y espera a estar adentro. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Contraseña").fill(ADMIN_TEST_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
