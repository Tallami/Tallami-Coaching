import { getTranslations } from "next-intl/server";
import styles from "./how-it-works.module.css";

/** Los cuatro pasos, en orden; el número lo pone el CSS con un contador. */
const STEPS = ["choose", "pay", "schedule", "train"] as const;

/** Ruta de cuatro pasos: elegir, pagar, agendar y entrenar. */
export async function HowItWorks() {
  const t = await getTranslations("HowItWorks");

  return (
    <section id="how-it-works" className="paper" aria-labelledby="how-title">
      <div className="mx-auto max-w-wrap px-gutter">
        <h2 id="how-title">{t("title")}</h2>
        <ol className={styles.route} role="list">
          {STEPS.map((step) => (
            <li key={step}>
              <h3>{t(`steps.${step}.title`)}</h3>
              <p>{t(`steps.${step}.body`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
