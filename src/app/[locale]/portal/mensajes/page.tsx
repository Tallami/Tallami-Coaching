import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { SiteFooter } from "@/components/home/site-footer";
import { MessagesContent } from "@/components/portal/messages-content";
import { PortalHeader } from "@/components/portal/portal-header";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

/**
 * Privada como el portal: sin buscadores (`noindex`) y sin `Referer` hacia otros sitios (`same-origin`, el
 * encabezado de `next.config.ts`; esta marca es el respaldo).
 */
export async function generateMetadata(props: PageProps<"/[locale]/portal/mensajes">): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "Chat" });

  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: getPathname({ locale, href: "/portal/mensajes" }) },
    robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } },
    referrer: "same-origin",
  };
}

/**
 * La página se arma entera en cada pedido, sin `Suspense` (`instant = false` permite bloquear, como en
 * `global-not-found.tsx`). Con un `Suspense`, la conversación llegaría en streaming y mostrarla sería un
 * script del propio HTML: sin JavaScript quedaría "cargando" para siempre, y el formulario tiene que
 * funcionar sin JavaScript (enviar y ver el mensaje). Es una página privada y dinámica igual: no pierde
 * ningún prerender. Las páginas públicas siguen estáticas.
 */
export const instant = false;

/**
 * `/[locale]/portal/mensajes`: la conversación del alumno con Tallami. El encabezado, el título y el pie
 * no dependen de nadie; la conversación depende de la cookie de sesión y la arma `MessagesContent`.
 */
export default async function PortalMessagesPage(props: PageProps<"/[locale]/portal/mensajes">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "Chat" });

  return (
    <>
      <PortalHeader />
      <main id="contenido">
        <div className="stage">
          <div className="mx-auto max-w-wrap px-gutter pt-4 pb-[clamp(28px,5vw,56px)]">
            <a
              href={`/${locale}/portal`}
              className="inline-flex min-h-11 items-center text-[.95rem] font-bold text-on-stage-2 underline-offset-4 hover:text-on-stage hover:underline"
            >
              {t("backToPortal")}
            </a>
            <h1 className="mt-2 text-[clamp(2.25rem,7vw,4.5rem)] font-extrabold font-stretch-72% leading-none">{t("title")}</h1>
            <p className="mt-4 max-w-[60ch] text-on-stage-2">{t("intro")}</p>
          </div>
        </div>
        <div className="paper !pt-[clamp(28px,5vw,56px)]">
          <div className="mx-auto max-w-wrap px-gutter">
            <MessagesContent locale={locale} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
