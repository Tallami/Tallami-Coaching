import type { Metadata } from "next";
import { LegalPage, legalPageMetadata } from "@/components/legal/legal-page";
import { REFUNDS } from "@/content/legal/refunds";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: PageProps<"/[locale]/reembolsos">): Promise<Metadata> {
  const { locale } = await props.params;
  return legalPageMetadata(REFUNDS, locale, "/reembolsos");
}

/** `/[locale]/reembolsos`: reembolsos y arrepentimiento. Estática e indexable. */
export default async function RefundsPage(props: PageProps<"/[locale]/reembolsos">) {
  const { locale } = await props.params;
  return <LegalPage documents={REFUNDS} localeParam={locale} />;
}
