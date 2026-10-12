import type { Metadata } from "next";
import { headers } from "next/headers";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { getHomePath } from "@/i18n/alternates";
import { HTML_LANG, routing, type Locale } from "@/i18n/routing";
import { saira } from "@/lib/fonts";
import "./globals.css";

/**
 * 404 de toda URL que no existe (`/es/no-existe`, `/fr`, …). `notFound()` desde
 * una página sale con el cuerpo vacío en el HTML y el contenido llega recién al
 * hidratar (Next 16.4); esta ruta se renderiza en el servidor, con estado 404 y
 * la página completa también sin JavaScript.
 *
 * No hay segmento `[locale]` que resolver, así que el idioma sale del header
 * que escribe el middleware de next-intl a partir del prefijo de la URL. Leer
 * headers vuelve dinámica a esta ruta (`instant = false` permite bloquear): las
 * demás páginas siguen estáticas.
 */
export const instant = false;

const LOCALE_HEADER = "X-NEXT-INTL-LOCALE";

async function getRequestLocale(): Promise<Locale> {
  const requested = (await headers()).get(LOCALE_HEADER);

  return hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;
}

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = await getTranslations({ locale, namespace: "NotFound" });

  return { title: t("title") };
}

export default async function GlobalNotFound() {
  const locale = await getRequestLocale();
  const t = await getTranslations({ locale, namespace: "NotFound" });

  return (
    <html lang={HTML_LANG[locale]} className={saira.variable}>
      <body>
        <main
          id="contenido"
          className="mx-auto flex max-w-wrap flex-col items-start gap-6 px-gutter py-24"
        >
          <h1 className="text-4xl font-extrabold">{t("title")}</h1>
          <p className="text-ink-2">{t("body")}</p>
          <Button asChild variant="ink-outline">
            <a href={getHomePath(locale)}>{t("back")}</a>
          </Button>
        </main>
      </body>
    </html>
  );
}
