const DEFAULT_SITE_URL = "http://localhost:3000";

function clean(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/\/+$/, "");
}

/**
 * Origen público del sitio, sin barra final. Orden de resolución:
 *
 * 1. `siteUrl` (`NEXT_PUBLIC_SITE_URL`): el dominio propio del sitio.
 * 2. `vercelProductionHost` (`VERCEL_PROJECT_PRODUCTION_URL`): variable de
 *    sistema de Vercel, solo el dominio de producción y sin protocolo
 *    (`mi-sitio.vercel.app`); está disponible durante el build.
 * 3. `http://localhost:3000`, para desarrollo local.
 *
 * Un valor vacío cuenta como no definido: `NEXT_PUBLIC_SITE_URL=` copiado tal
 * cual de `.env.example` no tiene que romper el build con `new URL("")`.
 */
export function resolveSiteUrl(
  siteUrl: string | undefined,
  vercelProductionHost: string | undefined,
): string {
  const explicitUrl = clean(siteUrl);
  if (explicitUrl) return explicitUrl;

  const vercelHost = clean(vercelProductionHost);
  if (vercelHost) return `https://${vercelHost}`;

  return DEFAULT_SITE_URL;
}

export const SITE_URL: string = resolveSiteUrl(
  process.env.NEXT_PUBLIC_SITE_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
);
