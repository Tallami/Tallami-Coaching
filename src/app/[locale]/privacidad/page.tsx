import type { Metadata } from "next";
import { LegalPage, legalPageMetadata } from "@/components/legal/legal-page";
import { PRIVACY } from "@/content/legal/privacy";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: PageProps<"/[locale]/privacidad">): Promise<Metadata> {
  const { locale } = await props.params;
  return legalPageMetadata(PRIVACY, locale, "/privacidad");
}

/** `/[locale]/privacidad`: la política de privacidad. Estática e indexable. */
export default async function PrivacyPage(props: PageProps<"/[locale]/privacidad">) {
  const { locale } = await props.params;
  return <LegalPage documents={PRIVACY} localeParam={locale} />;
}
