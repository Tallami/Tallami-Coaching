import type { Metadata } from "next";
import { RequestPage, requestPageMetadata } from "@/components/site-requests/request-page";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: PageProps<"/[locale]/arrepentimiento">): Promise<Metadata> {
  const { locale } = await props.params;
  return requestPageMetadata("withdrawal", locale);
}

/** `/[locale]/arrepentimiento`: estática; solo el formulario habla con el servidor. */
export default async function WithdrawalPage(props: PageProps<"/[locale]/arrepentimiento">) {
  const { locale } = await props.params;
  return <RequestPage kind="withdrawal" localeParam={locale} />;
}
