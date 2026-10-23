// Ayudas de los e2e del panel: un `test` donde cada test navega con su propia
// IP, tokens de sesión (firmados a mano o de un ingreso de verdad) y el inicio
// de sesión en dos pasos (contraseña y llave de prueba, ver `webauthn.ts`).

import { randomBytes } from "node:crypto";
import { expect, test as base, type Page } from "@playwright/test";
import { SignJWT } from "jose";
import { PASSWORD_CLAIM, passwordClaim } from "../../src/admin/auth/password-claim";
import {
  ADMIN_TEST_OLD_PASSWORD_HASH,
  ADMIN_TEST_PASSWORD,
  ADMIN_TEST_PASSWORD_HASH,
  ADMIN_TEST_SESSION_SECRET,
} from "./admin-server";
import { SEEDED_SLOTS, enableVirtualAuthenticator, injectTestPasskey } from "./webauthn";

export {
  ADMIN_TEST_OLD_PASSWORD_HASH,
  ADMIN_TEST_PASSWORD,
  ADMIN_TEST_PASSWORD_HASH,
  ADMIN_TEST_SESSION_SECRET,
};

/** Cookie y audiencia del panel (los valores reales viven en `src/admin/auth/session.ts`). */
export const ADMIN_COOKIE = "tallami_admin";
export const ADMIN_AUDIENCE = "tallami-admin";

const SECONDS_PER_HOUR = 3600;
const SESSION_HOURS = 8;

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
  /**
   * El hash de contraseña del que sale el claim de la sesión (el que usa el
   * servidor de los e2e por defecto). Con otro hash la firma es válida pero el
   * claim es el de una contraseña anterior; `null` firma una sesión sin claim.
   */
  passwordHash?: string | null;
  /**
   * El id de la sesión (claim `sid`). Por defecto uno al azar, bien formado pero
   * que no existe en la base: la firma pasa el `proxy` y `requireAdmin()` lo
   * manda al ingreso. Una sesión que sí vale es la de un ingreso de verdad
   * (`loginAndReadSessionCookie`).
   */
  sessionId?: string;
}

/** Firma una sesión como lo hace el panel; con opciones, una falsa, vencida o de una contraseña anterior. */
export async function signTestToken({
  secret = ADMIN_TEST_SESSION_SECRET,
  audience = ADMIN_AUDIENCE,
  expiresInSeconds = SESSION_HOURS * SECONDS_PER_HOUR,
  alg = "HS256",
  passwordHash = ADMIN_TEST_PASSWORD_HASH,
  sessionId = randomBytes(32).toString("base64url"),
}: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = new TextEncoder().encode(secret);
  const claims = {
    ...(passwordHash === null ? {} : { [PASSWORD_CLAIM]: passwordClaim(key, passwordHash) }),
    sid: sessionId,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg })
    .setAudience(audience)
    .setIssuedAt(now - SECONDS_PER_HOUR)
    .setExpirationTime(now + expiresInSeconds)
    .sign(key);
}

/** El paso de la llave, con o sin `?next=`. */
export const PASSKEY_STEP_URL = /\/admin\/login\/llave(\?|$)/;
/** El botón del paso de la llave: "Usar mi llave", o "Probar de nuevo" después de un aviso. */
export const PASSKEY_BUTTON = { name: /^(Usar mi llave|Probar de nuevo)$/ } as const;

/**
 * Deja en `page` un autenticador virtual nuevo con la llave de prueba `slot`: por
 * defecto la del worker (`parallelIndex`), registrada de antemano en los servidores
 * principal y de datos de ejemplo. Otro slot (por ejemplo 99) es una llave que el
 * panel no conoce.
 */
export async function armTestPasskey(page: Page, slot?: number): Promise<void> {
  const chosen = slot ?? test.info().parallelIndex;
  if (slot === undefined && chosen >= SEEDED_SLOTS) {
    throw new Error(`Hay más workers que llaves de prueba (${SEEDED_SLOTS}): subí SEEDED_SLOTS o bajá los workers.`);
  }
  const authenticatorId = await enableVirtualAuthenticator(page);
  await injectTestPasskey(page, authenticatorId, chosen);
}

/** En el paso de la llave: carga la llave de prueba del worker y la usa ("Usar mi llave"). */
export async function confirmWithTestPasskey(page: Page): Promise<void> {
  await expect(page).toHaveURL(PASSKEY_STEP_URL);
  await armTestPasskey(page);
  await page.getByRole("button", PASSKEY_BUTTON).click();
}

/** Escribe la contraseña de prueba en el login (que ya tiene que estar abierto) y la envía. */
export async function submitTestPassword(page: Page): Promise<void> {
  await page.getByLabel("Contraseña").fill(ADMIN_TEST_PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

/** Entra al panel como Tallami (contraseña y llave de prueba) y espera a estar adentro. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await submitTestPassword(page);
  await confirmWithTestPasskey(page);
  await expect(page).toHaveURL(/\/admin$/);
}

/**
 * Entra al panel de verdad y devuelve el valor de la cookie de sesión que
 * quedó en el navegador: la de una sesión que existe en la base. Sirve para
 * mandar pedidos sueltos con una sesión válida (`request.get(…, { headers })`) o
 * para volver a poner una cookie vieja después de cerrar la sesión.
 */
export async function loginAndReadSessionCookie(page: Page): Promise<string> {
  await loginAsAdmin(page);
  const cookie = (await page.context().cookies()).find(({ name }) => name === ADMIN_COOKIE);
  if (!cookie) throw new Error("El ingreso no dejó la cookie de sesión.");
  return cookie.value;
}
