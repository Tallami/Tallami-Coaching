import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { SiteFooter } from "@/components/home/site-footer";
import { PortalContent } from "@/components/portal/portal-content";
import { PortalHeader } from "@/components/portal/portal-header";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/**
 * Privada: sin buscadores (`noindex`) y sin `Referer` (`no-referrer`). El `Referrer-Policy` de
 * verdad es el encabezado de `next.config.ts`; esta marca es el respaldo si un servidor
 * intermedio lo cambia. El link de una invitación lleva su token en la dirección.
 */
export async function generateMetadata(props: PageProps<"/[locale]/portal">): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "Portal" });

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    // Su propia dirección y ninguna versión en otros idiomas: no es una copia de la portada.
    alternates: { canonical: getPathname({ locale, href: "/portal" }) },
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
    referrer: "no-referrer",
  };
}

/**
 * `/[locale]/portal`: la página del alumno. El resto de la página (encabezado, título, pie) es
 * estático; lo que depende de la cookie de sesión y de la dirección va en `PortalContent`, dentro
 * de un `Suspense`, y se arma en cada pedido.
 */
export default async function PortalPage(props: PageProps<"/[locale]/portal">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "Portal" });

  return (
    <>
      <PortalHeader />
      <main id="contenido">
        <div className="stage">
          <div className="mx-auto max-w-wrap px-gutter pt-4 pb-[clamp(36px,6vw,64px)]">
            <h1 className="text-[clamp(2.5rem,8vw,5rem)] font-extrabold font-stretch-72% leading-none">{t("title")}</h1>
          </div>
        </div>
        <div className="paper">
          <div className="mx-auto max-w-wrap px-gutter">
            <Suspense fallback={<p role="status" className="text-ink-2">{t("loading")}</p>}>
              <PortalContent locale={locale} searchParams={props.searchParams} />
            </Suspense>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
