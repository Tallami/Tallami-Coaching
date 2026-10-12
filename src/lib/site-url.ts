const DEFAULT_SITE_URL = "http://localhost:3000";

/**
 * Origen público del sitio, sin barra final. Un valor vacío cuenta como no
 * definido: `NEXT_PUBLIC_SITE_URL=` copiado tal cual de `.env.example` no
 * tiene que romper el build con `new URL("")`.
 */
export function normalizeSiteUrl(raw: string | undefined): string {
  const trimmed = raw?.trim();

  return (trimmed || DEFAULT_SITE_URL).replace(/\/+$/, "");
}

export const SITE_URL: string = normalizeSiteUrl(
  process.env.NEXT_PUBLIC_SITE_URL,
);
