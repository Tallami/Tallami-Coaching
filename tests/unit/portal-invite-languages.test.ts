import { describe, expect, test } from "vitest";
import { DEFAULT_INVITE_LANGUAGE, INVITE_LANGUAGES } from "@/admin/customers/invite-languages";
import { routing } from "@/i18n/routing";

// La tarjeta "Portal del alumno" deja elegir en qué idioma abre el link de la invitación. La
// lista vive en un módulo sin dependencias (la tarjeta corre en el navegador y no trae el
// enrutador del sitio); estos tests la mantienen igual a los idiomas del sitio.

describe("the languages offered for the invite link", () => {
  test("are exactly the languages of the site, in the order of the site", () => {
    expect(INVITE_LANGUAGES.map(({ value }) => value)).toEqual([...routing.locales]);
  });

  test("each one is written in its own language, so the student's language is recognised at a glance", () => {
    expect(INVITE_LANGUAGES.map(({ label }) => label)).toEqual(["Español", "Português", "English"]);
  });

  test("Spanish is the default, and it is the default of the site", () => {
    expect(DEFAULT_INVITE_LANGUAGE).toBe("es");
    expect(DEFAULT_INVITE_LANGUAGE).toBe(routing.defaultLocale);
    expect(INVITE_LANGUAGES[0].value).toBe(DEFAULT_INVITE_LANGUAGE);
  });
});
