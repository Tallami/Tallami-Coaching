import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { SiteFooter } from "@/components/home/site-footer";
import { PortalHeader } from "@/components/portal/portal-header";
import { ApplicationForm, type ApplicationFormLabels } from "@/components/pro/application-form";
import { PRO_SEASON_SLUG } from "@/content/services";
import { getPathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: PageProps<"/[locale]/temporada-pro">): Promise<Metadata> {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const t = await getTranslations({ locale, namespace: "Pro" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: getPathname({ locale, href: `/${PRO_SEASON_SLUG}` }) },
  };
}

/**
 * `/[locale]/temporada-pro`: la aplicación. Toda la página es estática: el formulario es lo único
 * que habla con el servidor, y lo hace al enviarse.
 */
export default async function ProSeasonPage(props: PageProps<"/[locale]/temporada-pro">) {
  const { locale } = await props.params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const [t, services] = await Promise.all([
    getTranslations({ locale, namespace: "Pro" }),
    getTranslations({ locale, namespace: "Services" }),
  ]);
  const labels: ApplicationFormLabels = {
    label: t("form.label"),
    name: t("form.name"),
    discord: t("form.discord"),
    discordHint: t("form.discordHint"),
    teamMembers: t("form.teamMembers"),
    teamMembersHint: t("form.teamMembersHint"),
    results: t("form.results"),
    resultsHint: t("form.resultsHint"),
    message: t("form.message"),
    optional: t("form.optional"),
    messageHint: t("form.messageHint"),
    privacy: t("form.privacy"),
    privacyLink: t("form.privacyLink"),
    submit: t("form.submit"),
    submitting: t("form.submitting"),
    trap: t("form.trap"),
    summary: t("form.summary"),
    required: t("errors.required"),
    tooLong: t.raw("errors.tooLong") as string,
    privacyError: t("errors.privacy"),
    limited: t("errors.limited"),
    failed: t("errors.failed"),
    sentTitle: t("sent.title"),
    sentBody: t("sent.body"),
    home: t("sent.home"),
  };

  return (
    <>
      <PortalHeader />
      <main id="contenido">
        <div className="stage">
          <div className="mx-auto max-w-wrap px-gutter pt-4 pb-[clamp(36px,6vw,64px)]">
            <p className="mb-3 text-[.95rem] font-bold tracking-[.08em] text-gold uppercase">{t("eyebrow")}</p>
            <h1 className="max-w-[18ch] text-[clamp(2.5rem,8vw,5rem)] font-extrabold font-stretch-72% leading-none">{t("title")}</h1>
            <p className="mt-5 max-w-[56ch] text-[1.0625rem] text-on-stage-2">{t("intro")}</p>
            <p className="mt-3 max-w-[56ch] text-on-stage-2">{services("pro.description")}</p>
          </div>
        </div>
        <div className="paper">
          <div className="mx-auto max-w-wrap px-gutter py-[clamp(32px,5vw,56px)]">
            <div className="max-w-[40rem]">
              <ApplicationForm locale={locale} labels={labels} homeHref={`/${locale}`} privacyHref={`/${locale}/privacidad`} />
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
