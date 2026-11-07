import type { MetadataRoute } from "next";
import { LEGAL_PAGES } from "@/content/legal/pages";
import { getLanguageAlternates } from "@/i18n/alternates";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-url";

/** Lo que se indexa: la home y las tres páginas legales. Los formularios, el portal y la compra no. */
const INDEXED_PAGES = ["/", ...LEGAL_PAGES.map(({ href }) => href)] as const;

/**
 * Una entrada por página y por idioma, cada una con los alternates de los tres.
 * No lleva `lastModified`: sería `new Date()` en cada build y no hay una fecha real.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return INDEXED_PAGES.flatMap((href) => {
    const languages = Object.fromEntries(
      Object.entries(getLanguageAlternates(href)).map(([hreflang, path]) => [
        hreflang,
        `${SITE_URL}${path}`,
      ]),
    );

    return routing.locales.map((locale) => ({
      url: `${SITE_URL}${getPathname({ locale, href })}`,
      alternates: { languages },
    }));
  });
}
