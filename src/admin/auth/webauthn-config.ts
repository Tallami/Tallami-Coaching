// A qué sitio pertenecen las llaves de acceso. El `rpID` (el dominio) y el origen
// que se espera al verificar salen siempre de la configuración del sitio, nunca
// del pedido: un `Host` o un `Origin` falsificados no pueden mover las llaves a
// otro dominio. Por eso esta función no recibe nada y no mira ningún encabezado.
//
// - En producción es el origen del sitio público (`NEXT_PUBLIC_SITE_URL`, o el
//   dominio de producción de Vercel): `https://tallami.com` → rpID `tallami.com`.
// - Para los servidores de los tests (puertos 3100 y 3101), `ADMIN_WEBAUTHN_ORIGIN`
//   fija otro origen. En producción de Vercel se ignora con un aviso en el log,
//   igual que `EXCHANGE_RATE_SOURCE`: una variable de prueba olvidada ahí movería
//   las llaves a `localhost`. Se mira `VERCEL_ENV` y no `NODE_ENV` porque los e2e
//   corren un build de producción en la máquina.
//
// Las llaves quedan atadas a este dominio: si cambia, dejan de servir (ver README).

import { SITE_URL } from "../../lib/site-url";

/** El nombre que muestra el navegador al crear la llave. */
const RP_NAME = "Panel de Tallami";

export type WebAuthnConfig = {
  rpID: string;
  origin: string;
  rpName: typeof RP_NAME;
};

/** El origen (esquema, dominio y puerto) de `url`, o `null` si no es una URL http(s). */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** El origen de prueba si corresponde usarlo, o `null`. Tira si la variable está pero no es un origen. */
function testOrigin(): string | null {
  const raw = process.env.ADMIN_WEBAUTHN_ORIGIN?.trim();
  if (!raw) return null;
  if (process.env.VERCEL_ENV === "production") {
    console.warn(
      "ADMIN_WEBAUTHN_ORIGIN se ignora en producción (VERCEL_ENV=production): se usa el dominio del sitio. Sacá la variable.",
    );
    return null;
  }
  const origin = originOf(raw);
  if (!origin) {
    throw new Error("ADMIN_WEBAUTHN_ORIGIN no es un origen http(s) válido (por ejemplo http://localhost:3100).");
  }
  return origin;
}

/** El `rpID`, el origen esperado y el nombre de las llaves de acceso. Tira si el sitio no tiene una URL válida. */
export function getWebAuthnConfig(): WebAuthnConfig {
  const origin = testOrigin() ?? originOf(SITE_URL);
  if (!origin) {
    throw new Error("NEXT_PUBLIC_SITE_URL no es una URL http(s) válida: no se pueden usar llaves de acceso.");
  }
  return { rpID: new URL(origin).hostname, origin, rpName: RP_NAME };
}
