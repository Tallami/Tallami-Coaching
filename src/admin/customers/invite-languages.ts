import type { Locale } from "@/i18n/routing";

// En qué idioma abre el link de una invitación (la página del portal es /{idioma}/portal): lo
// que ofrece la tarjeta "Portal del alumno" de la ficha. Cada idioma se escribe en el suyo, para
// reconocer el del alumno de un vistazo. Vive aparte de `@/i18n/routing` porque la tarjeta corre
// en el navegador; `tests/unit/portal-invite-languages.test.ts` la mantiene igual a los idiomas del sitio.

export const INVITE_LANGUAGES = [
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "en", label: "English" },
] as const satisfies readonly { value: Locale; label: string }[];

/** El idioma que viene elegido: el de siempre en el sitio. */
export const DEFAULT_INVITE_LANGUAGE: Locale = "es";
