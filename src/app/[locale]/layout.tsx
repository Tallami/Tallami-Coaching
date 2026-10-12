import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { Saira } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import heroPhoto from "@/assets/tallami-wide-1920.jpg";
import { getHomeLanguageAlternates, getHomePath } from "@/i18n/alternates";
import { HTML_LANG, INTL_TAG, routing } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-url";
import "../globals.css";

const SITE_NAME = "Tallami Coaching";
/** Mismo azul que el escenario (`--color-stage`): barra del navegador en celular. */
const THEME_COLOR = "#0B1433";

const saira = Saira({
  axes: ["wdth"],
  subsets: ["latin"],
  variable: "--font-saira",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(
  props: LayoutProps<"/[locale]">,
): Promise<Metadata> {
  const { locale } = await props.params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const [t, hero] = await Promise.all([
    getTranslations({ locale, namespace: "Metadata" }),
    getTranslations({ locale, namespace: "Hero" }),
  ]);

  return {
    metadataBase: new URL(SITE_URL),
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: getHomePath(locale),
      languages: getHomeLanguageAlternates(),
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      // `es_AR`, `pt_BR`, `en_US`: el formato de Open Graph usa guion bajo.
      locale: INTL_TAG[locale].replace("-", "_"),
      images: [
        {
          url: heroPhoto.src,
          width: heroPhoto.width,
          height: heroPhoto.height,
          alt: hero("imageAlt"),
        },
      ],
    },
  };
}

export function generateViewport(): Viewport {
  return { themeColor: THEME_COLOR };
}

export default async function LocaleLayout(props: LayoutProps<"/[locale]">) {
  const { locale } = await props.params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const t = await getTranslations({ locale, namespace: "Common" });

  return (
    <html lang={HTML_LANG[locale]} className={saira.variable}>
      <body>
        <a
          href="#contenido"
          className="absolute -left-[9999px] top-2 z-20 bg-gold px-3.5 py-2.5 font-bold text-stage focus:left-2"
        >
          {t("skipLink")}
        </a>
        <NextIntlClientProvider>{props.children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
