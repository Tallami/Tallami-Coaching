import { getTranslations } from "next-intl/server";
import { PricePair } from "@/components/home/price-pair";
import { serviceById, type ServiceId } from "@/content/services";
import type { Locale } from "@/i18n/routing";

interface CheckoutSummaryProps {
  item: ServiceId;
  /** Los pesos por dólar de ahora; sin valor se muestran solo los dólares. */
  rate: string | null;
  locale: Locale;
}

/** Lo que se paga, como en la carta de servicios de la portada: el total, la línea punteada y los dos precios, del mismo tamaño. */
export async function CheckoutSummary({ item, rate, locale }: CheckoutSummaryProps) {
  const t = await getTranslations("Checkout");

  return (
    <section aria-label={t("summaryLabel")}>
      <div className="flex items-baseline gap-3 border-t-4 border-ink pt-5">
        <p className="m-0 text-[1.3rem] font-bold font-stretch-90%">{t("total")}</p>
        <span aria-hidden="true" className="min-w-6 flex-1 -translate-y-1.5 border-b-2 border-dotted border-[#9aa39a]" />
        <PricePair
          priceUsd={serviceById(item).priceUsd}
          rate={rate}
          locale={locale}
          className="text-right text-[clamp(1.9rem,4.5vw,2.5rem)] font-extrabold font-stretch-80% leading-none whitespace-nowrap tabular-nums"
        />
      </div>
      {rate ? <p className="mt-5 max-w-[52ch] text-ink-2">{t("paymentNote")}</p> : null}
    </section>
  );
}
