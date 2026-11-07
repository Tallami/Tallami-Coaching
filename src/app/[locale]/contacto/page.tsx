import type { Metadata } from "next";
import { RequestPage, requestPageMetadata } from "@/components/site-requests/request-page";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: PageProps<"/[locale]/contacto">): Promise<Metadata> {
  const { locale } = await props.params;
  return requestPageMetadata("contact", locale);
}

/** `/[locale]/contacto`: estática; solo el formulario habla con el servidor. */
export default async function ContactPage(props: PageProps<"/[locale]/contacto">) {
  const { locale } = await props.params;
  return <RequestPage kind="contact" localeParam={locale} />;
}
