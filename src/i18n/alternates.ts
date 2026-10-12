import { getPathname } from "./navigation";
import { HTML_LANG, routing, type Locale } from "./routing";

/** Ruta de la home en un idioma: `/es`, `/pt`, `/en`. */
export function getHomePath(locale: Locale): string {
  return getPathname({ locale, href: "/" });
}

/**
 * Rutas de la home por código hreflang (`es`, `pt-BR`, `en`) más `x-default`,
 * que apunta al idioma por defecto. Metadatos y sitemap usan el mismo mapa.
 */
export function getHomeLanguageAlternates(): Record<string, string> {
  const byLanguage = routing.locales.map(
    (locale) => [HTML_LANG[locale], getHomePath(locale)] as const,
  );

  return Object.fromEntries([
    ...byLanguage,
    ["x-default", getHomePath(routing.defaultLocale)],
  ]);
}
