import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Saira } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { HTML_LANG, routing } from "@/i18n/routing";
import "../globals.css";

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

  const t = await getTranslations({ locale, namespace: "Metadata" });

  return { title: t("title"), description: t("description") };
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
