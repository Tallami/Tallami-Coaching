import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { SiteFooter } from "@/components/home/site-footer";
import { PortalHeader } from "@/components/portal/portal-header";
import { RequestForm, type RequestFormLabels } from "@/components/site-requests/request-form";
import { routing } from "@/i18n/routing";

export type RequestPageKind = "withdrawal" | "cancellation" | "contact";

/** Estas páginas no se indexan: son trámites, no contenido. */
export async function requestPageMetadata(kind: RequestPageKind, localeParam: string): Promise<Metadata> {
  if (!hasLocale(routing.locales, localeParam)) notFound();
  const t = await getTranslations({ locale: localeParam, namespace: "SiteRequests" });
  return {
    title: t(`${kind}.metaTitle`),
    robots: { index: false, follow: false },
  };
}

/**
 * La página de un pedido del sitio. Es estática: el formulario es lo único que habla con el
 * servidor, y lo hace al enviarse.
 */
export async function RequestPage({ kind, localeParam }: { kind: RequestPageKind; localeParam: string }) {
  if (!hasLocale(routing.locales, localeParam)) notFound();
  const locale = localeParam;
  const t = await getTranslations({ locale, namespace: "SiteRequests" });
  const isContact = kind === "contact";
  const labels: RequestFormLabels = {
    label: t("form.label"),
    name: t("form.name"),
    email: t("form.email"),
    emailHint: t("form.emailHint"),
    orderReference: t("form.orderReference"),
    orderReferenceHint: t("form.orderReferenceHint"),
    message: t("form.message"),
    optional: t("form.optional"),
    trap: t("form.trap"),
    summary: t("form.summary"),
    submit: t(`${kind}.submit`),
    submitting: t("form.submitting"),
    required: t("errors.required"),
    invalid: t("errors.invalid"),
    tooLong: t.raw("errors.tooLong") as string,
    limited: t("errors.limited"),
    failed: t("errors.failed"),
    sentTitle: t("sent.title"),
    sentBody: isContact ? t("sent.contactBody") : null,
    codeLabel: t("sent.codeLabel"),
    saveCode: t("sent.saveCode"),
    home: t("sent.home"),
  };

  return (
    <>
      <PortalHeader />
      <main id="contenido">
        <div className="stage">
          <div className="mx-auto max-w-wrap px-gutter pt-4 pb-[clamp(36px,6vw,64px)]">
            <h1 className="max-w-[18ch] text-[clamp(2.5rem,8vw,5rem)] font-extrabold font-stretch-72% leading-none">{t(`${kind}.title`)}</h1>
            <p className="mt-5 max-w-[56ch] text-[1.0625rem] text-on-stage-2">{t(`${kind}.intro`)}</p>
            {isContact ? (
              <p className="mt-3 max-w-[56ch] text-on-stage-2">
                <strong className="text-on-stage">{t("contact.hoursLabel")}:</strong> {t("hours")}
              </p>
            ) : null}
          </div>
        </div>
        <div className="paper">
          <div className="mx-auto max-w-wrap px-gutter py-[clamp(32px,5vw,56px)]">
            <div className="max-w-[40rem]">
              <RequestForm kind={kind} locale={locale} labels={labels} homeHref={`/${locale}`} />
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
