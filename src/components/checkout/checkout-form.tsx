import { getTranslations } from "next-intl/server";
import { startCheckoutAction } from "@/app/[locale]/comprar/[service]/actions";
import type { Locale } from "@/i18n/routing";
import type { PortalAccount } from "@/portal/accounts";
import { PayButton } from "./pay-button";

interface CheckoutFormProps {
  account: PortalAccount;
  slug: string;
  locale: Locale;
  /** Los centavos de peso que muestra la pantalla: viajan solo para compararlos con los de ese momento. */
  shownArsMinor: number;
  linkToken: string | null;
}

/**
 * La casilla y el botón de pagar, en un formulario que funciona sin JavaScript. Es una tarjeta del color
 * del escenario, como la de Temporada Pro: lo único de la pantalla que pide hacer algo.
 */
export async function CheckoutForm({ account, slug, locale, shownArsMinor, linkToken }: CheckoutFormProps) {
  const t = await getTranslations("Checkout.form");

  return (
    <form action={startCheckoutAction} className="stage rounded-[4px] p-[clamp(24px,4vw,36px)]">
      <input type="hidden" name="service" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="shownArsMinor" value={shownArsMinor} />
      {linkToken ? <input type="hidden" name="link" value={linkToken} /> : null}
      <p className="m-0 text-[.95rem] text-on-stage-2 [overflow-wrap:anywhere]">{t("buyingAs", { name: account.displayName })}</p>
      <label className="mt-5 flex cursor-pointer items-start gap-3 font-semibold">
        <input type="checkbox" name="adult" value="yes" required className="mt-0.5 size-6 shrink-0 cursor-pointer accent-gold" />
        <span>{t("adult")}</span>
      </label>
      <PayButton label={t("pay")} pendingLabel={t("paying")} />
    </form>
  );
}
