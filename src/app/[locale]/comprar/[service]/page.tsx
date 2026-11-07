import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { CheckoutContent } from "@/components/checkout/checkout-content";
import { SiteFooter } from "@/components/home/site-footer";
import { PortalHeader } from "@/components/portal/portal-header";
import { PRO_SEASON_SLUG, SERVICE_SLUGS, serviceFromSlug, type ServiceId } from "@/content/services";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/** Las direcciones son fijas: se arman de antemano. Cualquier otra se resuelve en el pedido y da 404. */
export function generateStaticParams() {
  return [...Object.values(SERVICE_SLUGS), PRO_SEASON_SLUG].map((service) => ({ service }));
}

/** Qué se compra en esa dirección: un servicio, la Temporada Pro (con su link) o nada. */
function itemFromSlug(slug: string): ServiceId | "proSeason" | null {
  return slug === PRO_SEASON_SLUG ? "proSeason" : serviceFromSlug(slug);
}

/**
 * Privada: sin buscadores (`noindex`) y sin `Referer` hacia otros sitios (`same-origin`: al propio sitio
 * sigue llegando, ver `next.config.ts`). La dirección puede llevar el token de un link de pago.
 */
export async function generateMetadata(props: PageProps<"/[locale]/comprar/[service]">): Promise<Metadata> {
  const { locale, service } = await props.params;
  if (!hasLocale(routing.locales, locale) || !itemFromSlug(service)) notFound();
  const t = await getTranslations({ locale, namespace: "Checkout" });

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    // Su propia dirección y ninguna versión en otros idiomas: no es una copia de la portada.
    alternates: { canonical: getPathname({ locale, href: `/comprar/${service}` }) },
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
    referrer: "same-origin",
  };
}

/**
 * `/[locale]/comprar/[service]`: la pantalla de confirmación. Lo que no depende de nadie (encabezado,
 * qué es el servicio, pie) es estático; el precio, la sesión y lo que falta para cobrar van en
 * `CheckoutContent`, dentro de un `Suspense`, y se arman en cada pedido.
 */
export default async function CheckoutPage(props: PageProps<"/[locale]/comprar/[service]">) {
  const { locale, service: slug } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const item = itemFromSlug(slug);
  if (!item) notFound();
  const [t, services] = await Promise.all([
    getTranslations({ locale, namespace: "Checkout" }),
    getTranslations({ locale, namespace: "Services" }),
  ]);

  return (
    <>
      {/* El link de pago de Temporada Pro viaja en la dirección: el cambio de idioma lo conserva. */}
      <PortalHeader keepParams={["link"]} />
      <main id="contenido">
        <div className="stage">
          <div className="mx-auto max-w-wrap px-gutter pt-4 pb-[clamp(36px,6vw,64px)]">
            <p className="mb-3 text-[.95rem] font-bold tracking-[.08em] text-gold uppercase">{t("eyebrow")}</p>
            <h1 className="max-w-[18ch] text-[clamp(2.5rem,8vw,5rem)] font-extrabold font-stretch-72% leading-none">
              {services(item === "proSeason" ? "pro.name" : `items.${item}.name`)}
            </h1>
            <p className="mt-5 max-w-[56ch] text-[1.0625rem] text-on-stage-2">{services(item === "proSeason" ? "pro.description" : `items.${item}.description`)}</p>
          </div>
        </div>
        <div className="paper">
          <div className="mx-auto max-w-wrap px-gutter">
            <Suspense
              fallback={
                <>
                  <p role="status" className="text-ink-2">{t("loading")}</p>
                  {/* Lo de adentro del `Suspense` lo muestra un script del propio HTML: sin JavaScript no aparece. */}
                  <noscript>
                    <p className="mt-2 font-semibold">{t("noScript")}</p>
                  </noscript>
                </>
              }
            >
              <CheckoutContent locale={locale} item={item} searchParams={props.searchParams} />
            </Suspense>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
