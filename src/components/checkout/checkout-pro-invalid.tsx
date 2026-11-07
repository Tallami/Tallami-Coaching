import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { PRO_SEASON_SLUG } from "@/content/services";
import type { Locale } from "@/i18n/routing";

/**
 * Temporada Pro sin un link que sirva (falta, venció, ya se usó o no existe): se explica y se lleva a
 * la aplicación. Dice lo mismo en todos los casos y no deja ver nada de ninguna venta.
 */
export async function CheckoutProInvalid({ locale }: { locale: Locale }) {
  const t = await getTranslations("Checkout.pro");

  return (
    <section aria-labelledby="checkout-pro-invalid-title" className="stage max-w-[40rem] rounded-[4px] p-[clamp(24px,4vw,36px)]">
      <h2 id="checkout-pro-invalid-title" className="text-[clamp(1.6rem,3.5vw,2.25rem)] font-extrabold font-stretch-72% leading-none">
        {t("invalidTitle")}
      </h2>
      <p className="mt-3 mb-6 text-on-stage-2">{t("invalidBody")}</p>
      <Button asChild>
        <a href={`/${locale}/${PRO_SEASON_SLUG}`}>{t("apply")}</a>
      </Button>
    </section>
  );
}
