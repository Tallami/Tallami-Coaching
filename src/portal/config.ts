// Lo que el portal del alumno necesita configurar para abrir. Se lee de las
// variables de entorno en cada pedido. Solo se informan nombres y estados,
// nunca valores.
//
// - `PORTAL_SESSION_SECRET` (32 caracteres o más): un secreto propio del portal,
//   separado de `ADMIN_SESSION_SECRET`. Que el de un lado se filtre o se cambie no
//   toca al otro.
// - Un proveedor (Discord, Google) está disponible si tiene su id de cliente y su
//   secreto. Sin los de un proveedor, ese botón no aparece.
// - `PORTAL_OAUTH_TEST_ISSUER` habilita el proveedor `test`, un servidor OAuth falso
//   local para los tests y el desarrollo. En producción de Vercel se ignora con un
//   aviso en el log, igual que `ADMIN_WEBAUTHN_ORIGIN` y `EXCHANGE_RATE_SOURCE`:
//   una variable de prueba olvidada ahí dejaría entrar con un proveedor falso. Se
//   mira `VERCEL_ENV` y no `NODE_ENV` porque los e2e corren un build de producción
//   en la máquina.

import { isDbConfigured } from "../db/config";
import { PORTAL_PROVIDERS } from "./policy";

/** Largo mínimo del secreto del portal. */
export const MIN_PORTAL_SECRET_LENGTH = 32;

export type PortalProvider = (typeof PORTAL_PROVIDERS)[number];

/** El valor de una variable sin los espacios de los costados, o `undefined` si falta o está vacía. */
function readEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/** El secreto del portal, o `null` si falta o es más corto que el mínimo. */
export function getPortalSecret(): Uint8Array | null {
  const value = process.env.PORTAL_SESSION_SECRET;
  if (!value || value.length < MIN_PORTAL_SECRET_LENGTH) return null;
  return new TextEncoder().encode(value);
}

/** ¿Están el id de cliente y el secreto de un proveedor real? */
function hasClientCredentials(idName: string, secretName: string): boolean {
  return readEnv(idName) !== undefined && readEnv(secretName) !== undefined;
}

/** ¿Corresponde usar el proveedor de prueba? (Está pedido y no estamos en producción de Vercel.) */
function isTestProviderEnabled(): boolean {
  if (!readEnv("PORTAL_OAUTH_TEST_ISSUER")) return false;
  if (process.env.VERCEL_ENV === "production") {
    console.warn(
      "PORTAL_OAUTH_TEST_ISSUER se ignora en producción (VERCEL_ENV=production): no hay proveedor de prueba. Sacá la variable.",
    );
    return false;
  }
  return true;
}

/** Los proveedores con los que se puede ingresar ahora, en el orden en que se muestran. */
export function enabledProviders(): PortalProvider[] {
  const enabled: PortalProvider[] = [];
  if (hasClientCredentials("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET")) enabled.push("discord");
  if (hasClientCredentials("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")) enabled.push("google");
  if (isTestProviderEnabled()) enabled.push("test");
  return enabled;
}

/** ¿Puede abrir el portal? Hace falta el secreto, al menos un proveedor y una base. */
export function isPortalConfigured(): boolean {
  return getPortalSecret() !== null && enabledProviders().length > 0 && isDbConfigured();
}
