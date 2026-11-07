import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { SiteFooter } from "@/components/home/site-footer";
import { PortalHeader } from "@/components/portal/portal-header";
import type { LegalPageHref } from "@/content/legal/pages";
import type { LegalDocument } from "@/content/legal/types";
import { getLanguageAlternates } from "@/i18n/alternates";
import { getPathname } from "@/i18n/navigation";
import { INTL_TAG, routing, type Locale } from "@/i18n/routing";

const SITE_NAME = "Tallami Coaching";

type LegalDocuments = Record<Locale, LegalDocument>;

interface LegalPageProps {
  documents: LegalDocuments;
  /** El idioma tal como llega en la dirección: se valida acá. */
  localeParam: string;
}

/**
 * Las páginas legales se indexan (a diferencia de los formularios): título propio, su canonical y
 * la misma página en los otros dos idiomas.
 */
export function legalPageMetadata(documents: LegalDocuments, localeParam: string, href: LegalPageHref): Metadata {
  if (!hasLocale(routing.locales, localeParam)) notFound();
  const document = documents[localeParam];

  return {
    title: `${document.title} · ${SITE_NAME}`,
    description: document.description,
    alternates: {
      canonical: getPathname({ locale: localeParam, href }),
      languages: getLanguageAlternates(href),
    },
  };
}

/** "7 de noviembre de 2026", "7 de novembro de 2026", "November 7, 2026". La fecha es un día, sin hora. */
function formatUpdatedOn(isoDate: string, locale: Locale): string {
  return new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** "01", "02"… El número es para la vista: los títulos se nombran por su texto. */
function sectionNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

function sectionId(index: number): string {
  return `seccion-${index + 1}`;
}

/**
 * Términos, reembolsos o privacidad. Estática: el texto sale de `src/content/legal/`. Un índice
 * numerado, fijo al costado en pantallas anchas, lleva a cada sección.
 */
export async function LegalPage({ documents, localeParam }: LegalPageProps) {
  if (!hasLocale(routing.locales, localeParam)) notFound();
  const locale = localeParam;
  const document = documents[locale];
  const t = await getTranslations({ locale, namespace: "Legal" });

  return (
    <>
      <PortalHeader />
      <main id="contenido">
        <div className="stage">
          <div className="mx-auto max-w-wrap px-gutter pt-4 pb-[clamp(36px,6vw,64px)]">
            <p className="mb-3 text-[.95rem] font-bold tracking-[.08em] text-gold uppercase">{t("eyebrow")}</p>
            <h1 className="max-w-[18ch] text-[clamp(2.5rem,8vw,5rem)] font-extrabold font-stretch-72% leading-none">{document.title}</h1>
            <p className="mt-5 max-w-[56ch] text-[1.0625rem] text-on-stage-2">{document.description}</p>
            <p className="mt-3 text-[.95rem] text-on-stage-2">
              {t.rich("updated", {
                date: formatUpdatedOn(document.updatedOn, locale),
                time: (chunks) => (
                  <time dateTime={document.updatedOn} className="font-semibold text-on-stage">
                    {chunks}
                  </time>
                ),
              })}
            </p>
          </div>
        </div>
        <div className="paper">
          <div className="mx-auto grid max-w-wrap gap-x-[clamp(40px,6vw,96px)] gap-y-10 px-gutter lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
            <nav aria-labelledby="legal-index-title" className="lg:sticky lg:top-6 lg:self-start">
              <p id="legal-index-title" className="text-[.8rem] font-bold tracking-[.1em] text-ink-2 uppercase">
                {t("contents")}
              </p>
              <ol role="list" className="m-0 mt-3 list-none border-l-2 border-ink p-0">
                {document.sections.map(({ heading }, index) => (
                  <li key={heading}>
                    <a
                      href={`#${sectionId(index)}`}
                      className="grid grid-cols-[2.25rem_minmax(0,1fr)] py-1.5 pl-3.5 text-[.95rem] leading-snug text-ink-2 no-underline hover:text-zone"
                    >
                      <span aria-hidden="true" className="font-bold tabular-nums text-zone">
                        {sectionNumber(index)}
                      </span>
                      <span>{heading}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="min-w-0 max-w-[68ch]">
              {document.sections.map(({ heading, paragraphs }, index) => (
                <section key={heading} aria-labelledby={sectionId(index)} className="border-t border-rule pt-8 pb-1 first:border-t-0 first:pt-0 [&+section]:mt-8">
                  <h2 id={sectionId(index)} className="flex scroll-mt-6 items-baseline gap-3 text-[clamp(1.5rem,3vw,2rem)] leading-tight">
                    <span aria-hidden="true" className="text-[.7em] tabular-nums text-zone">
                      {sectionNumber(index)}
                    </span>
                    {heading}
                  </h2>
                  {paragraphs.map((paragraph) => (
                    <p key={paragraph} className="mt-3 text-ink">
                      {paragraph}
                    </p>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
