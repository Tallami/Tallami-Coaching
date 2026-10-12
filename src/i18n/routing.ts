import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["es", "pt", "en"],
  defaultLocale: "es",
  localePrefix: "always",
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
