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
//   local para los tests y el desarrollo, si es una dirección http(s). En Vercel (la
//   variable `VERCEL`, en cualquier entorno) se ignora con un aviso en el log.
//
// Qué proveedores están habilitados lo decide `getProviderClient`
// (`oauth/providers.ts`): `enabledProviders` solo junta los que tienen cliente, así
// los botones de la página y la ruta que empieza el ingreso nunca discrepan.

import { isDbConfigured } from "../db/config";
import { getProviderClient } from "./oauth/providers";
import { PORTAL_PROVIDERS } from "./policy";

/** Largo mínimo del secreto del portal. */
export const MIN_PORTAL_SECRET_LENGTH = 32;

export type PortalProvider = (typeof PORTAL_PROVIDERS)[number];

/** El valor de una variable sin los espacios de los costados, o `undefined` si falta o está vacía. */
function readEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/**
 * El secreto del portal, sin los espacios de los costados, o `null` si falta o es
 * más corto que el mínimo (32 espacios no son un secreto).
 */
export function getPortalSecret(): Uint8Array | null {
  const value = readEnv("PORTAL_SESSION_SECRET");
  if (!value || value.length < MIN_PORTAL_SECRET_LENGTH) return null;
  return new TextEncoder().encode(value);
}

/** Los proveedores con los que se puede ingresar ahora, en el orden en que se muestran. */
export function enabledProviders(): PortalProvider[] {
  return PORTAL_PROVIDERS.filter((provider) => getProviderClient(provider) !== null);
}

/** ¿Puede abrir el portal? Hace falta el secreto, al menos un proveedor y una base. */
export function isPortalConfigured(): boolean {
  return getPortalSecret() !== null && enabledProviders().length > 0 && isDbConfigured();
}
