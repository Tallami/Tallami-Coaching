import type { Locale as AppLocale } from "./routing";

// Tipa `getLocale()` / `useLocale()` con los idiomas del sitio (sin casts).
declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
  }
}
