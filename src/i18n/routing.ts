import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["es", "pt", "en"],
  defaultLocale: "es",
  localePrefix: "always",
  // Los hreflang salen de los metadatos y del sitemap (`src/i18n/alternates.ts`).
  // El header `Link` del middleware repetiría los mismos idiomas con otros
  // códigos (`pt`) y un `x-default` a `/`, que contradicen los de la página.
  alternateLinks: false,
});

export type Locale = (typeof routing.locales)[number];

export const HTML_LANG: Record<Locale, string> = {
  es: "es",
  pt: "pt-BR",
  en: "en",
};

export const INTL_TAG: Record<Locale, string> = {
  es: "es-AR",
  pt: "pt-BR",
  en: "en-US",
};
