import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";

const LEGAL_PAGES = [
  { path: "terminos", labelKey: "terms" },
  { path: "reembolsos", labelKey: "refunds" },
  { path: "privacidad", labelKey: "privacy" },
] as const;

const LINK_CLASS = "inline-block py-1 font-medium underline underline-offset-4 hover:text-zone";

/** Lo que conviene poder leer antes de pagar, y la salida para quien no paga desde Argentina. */
export async function CheckoutLegal({ locale }: { locale: Locale }) {
  const t = await getTranslations("Checkout.legal");

  return (
    <div className="mt-6 border-t border-rule pt-5">
      <nav aria-label={t("label")}>
        <ul role="list" className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0">
          {LEGAL_PAGES.map(({ path, labelKey }) => (
            <li key={path}>
              <a href={`/${locale}/${path}`} className={LINK_CLASS}>
                {t(labelKey)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="mt-3">
        <a href={`/${locale}/contacto`} className={LINK_CLASS}>
          {t("outsideArgentina")}
        </a>
      </p>
    </div>
  );
}
