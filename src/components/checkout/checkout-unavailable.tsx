import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";

/** Falta algo para cobrar (las credenciales, el valor o el remitente): se ofrece el contacto. A quien compra no le importa qué. */
export async function CheckoutUnavailable({ locale }: { locale: Locale }) {
  const t = await getTranslations("Checkout.unavailable");

  return (
    <section aria-labelledby="checkout-unavailable-title" className="stage rounded-[4px] p-[clamp(24px,4vw,36px)]">
      <h2 id="checkout-unavailable-title" className="text-[clamp(1.6rem,3.5vw,2.25rem)] font-extrabold font-stretch-72% leading-none">
        {t("title")}
      </h2>
      <p className="mt-3 mb-6 text-on-stage-2">{t("body")}</p>
      <Button asChild>
        <a href={`/${locale}/contacto`}>{t("contact")}</a>
      </Button>
    </section>
  );
}
