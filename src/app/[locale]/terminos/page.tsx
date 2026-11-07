import type { Metadata } from "next";
import { LegalPage, legalPageMetadata } from "@/components/legal/legal-page";
import { TERMS } from "@/content/legal/terms";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: PageProps<"/[locale]/terminos">): Promise<Metadata> {
  const { locale } = await props.params;
  return legalPageMetadata(TERMS, locale, "/terminos");
}

/** `/[locale]/terminos`: los términos y condiciones. Estática e indexable. */
export default async function TermsPage(props: PageProps<"/[locale]/terminos">) {
  const { locale } = await props.params;
  return <LegalPage documents={TERMS} localeParam={locale} />;
}
