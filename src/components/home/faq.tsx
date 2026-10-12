import { getLocale, getTranslations } from "next-intl/server";
import { PRO_SEASON } from "@/content/services";
import { formatUsd } from "@/lib/format";
import styles from "./faq.module.css";

const FAQ_ITEMS = ["minors", "payment", "schedule", "pro"] as const;

/** Preguntas frecuentes. Son <details> nativos: abren con Enter o Espacio y sin JS. */
export async function Faq() {
  const t = await getTranslations("Faq");
  const locale = await getLocale();

  const answerArguments = {
    price: formatUsd(PRO_SEASON.priceUsd, locale),
    percent: PRO_SEASON.prizeSharePercent,
  };

  return (
    <section id="faq" className="paper" aria-labelledby="faq-title">
      <div className="mx-auto max-w-wrap px-gutter">
        <h2 id="faq-title">{t("title")}</h2>
        <div className={styles.faq}>
          {FAQ_ITEMS.map((item) => (
            <details key={item}>
              <summary>{t(`items.${item}.question`)}</summary>
              <p>
                {item === "pro"
                  ? t("items.pro.answer", answerArguments)
                  : t(`items.${item}.answer`)}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
