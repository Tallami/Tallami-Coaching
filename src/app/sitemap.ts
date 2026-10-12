import type { MetadataRoute } from "next";
import { getHomeLanguageAlternates, getHomePath } from "@/i18n/alternates";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-url";

/**
 * Una entrada por idioma, cada una con los alternates de los tres. No lleva
 * `lastModified`: sería `new Date()` en cada build y no hay una fecha real.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    Object.entries(getHomeLanguageAlternates()).map(([hreflang, path]) => [
      hreflang,
      `${SITE_URL}${path}`,
    ]),
  );

  return routing.locales.map((locale) => ({
    url: `${SITE_URL}${getHomePath(locale)}`,
    alternates: { languages },
  }));
}
