import type { Metadata } from "next";
import { RequestPage, requestPageMetadata } from "@/components/site-requests/request-page";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: PageProps<"/[locale]/baja">): Promise<Metadata> {
  const { locale } = await props.params;
  return requestPageMetadata("cancellation", locale);
}

/** `/[locale]/baja`: estática; solo el formulario habla con el servidor. */
export default async function CancellationPage(props: PageProps<"/[locale]/baja">) {
  const { locale } = await props.params;
  return <RequestPage kind="cancellation" localeParam={locale} />;
}
