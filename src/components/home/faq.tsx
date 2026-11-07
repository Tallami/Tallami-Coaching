import { getTranslations } from "next-intl/server";
import styles from "./faq.module.css";

/** Las preguntas, en el orden del diseño de pagos: comprar, pagar, edad, sesiones, VOD, arrepentimiento, Pro y contacto. */
const FAQ_ITEMS = [
  "howToBuy",
  "afterPayment",
  "payment",
  "currencies",
  "minors",
  "schedule",
  "vodInput",
  "vodDelivery",
  "missedSession",
  "withdrawal",
  "results",
  "pro",
  "contact",
] as const;

/** Preguntas frecuentes. Son <details> nativos: abren con Enter o Espacio y sin JS. */
export async function Faq() {
  const t = await getTranslations("Faq");

  return (
    <section id="faq" className="paper" aria-labelledby="faq-title">
      <div className="mx-auto max-w-wrap px-gutter">
        <h2 id="faq-title">{t("title")}</h2>
        <div className={styles.faq}>
          {FAQ_ITEMS.map((item) => (
            <details key={item}>
              <summary>{t(`items.${item}.question`)}</summary>
              <p>{t(`items.${item}.answer`)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
