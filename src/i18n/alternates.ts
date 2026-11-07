import { getPathname } from "./navigation";
import { HTML_LANG, routing, type Locale } from "./routing";

/** Ruta de la home en un idioma: `/es`, `/pt`, `/en`. */
export function getHomePath(locale: Locale): string {
  return getPathname({ locale, href: "/" });
}

/**
 * Rutas de una página en cada idioma, por código hreflang (`es`, `pt-BR`, `en`),
 * más `x-default`, que apunta al idioma por defecto. Metadatos y sitemap usan el
 * mismo mapa. `href` es la ruta sin idioma: `/` para la home, `/terminos`…
 */
export function getLanguageAlternates(href: string): Record<string, string> {
  const byLanguage = routing.locales.map(
    (locale) => [HTML_LANG[locale], getPathname({ locale, href })] as const,
  );

  return Object.fromEntries([
    ...byLanguage,
    ["x-default", getPathname({ locale: routing.defaultLocale, href })],
  ]);
}

/** Las de la home: `/es`, `/pt`, `/en`. */
export function getHomeLanguageAlternates(): Record<string, string> {
  return getLanguageAlternates("/");
}
