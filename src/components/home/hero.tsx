import Image from "next/image";
import { getTranslations } from "next-intl/server";
import heroPhoto from "@/assets/tallami-wide-1920.jpg";
import { Button } from "@/components/ui/button";
import { FNCS_TITLES } from "@/content/results";
import styles from "./hero.module.css";

const COACH_NAME = "Tomás “Tallami” Allami";

/** Portada: foto de escenario, título, botones y zócalo de nombre. */
export async function Hero() {
  const t = await getTranslations("Hero");

  return (
    <section className={`${styles.hero} stage`} aria-labelledby="hero-title">
      <Image
        src={heroPhoto}
        alt={t("imageAlt")}
        fill
        preload
        sizes="100vw"
        className={styles.photo}
      />
      <div className={`${styles.inner} mx-auto w-full max-w-wrap px-gutter`}>
        <h1 id="hero-title" className={styles.title}>
          {t("title", { count: FNCS_TITLES })}
        </h1>
        <p className={styles.lede}>{t("lede")}</p>
        <div className={styles.ctas}>
          <Button asChild>
            <a href="#services">{t("ctaServices")}</a>
          </Button>
          <Button asChild variant="stage-outline">
            <a href="#results">{t("ctaResults")}</a>
          </Button>
        </div>
        <div className={styles.lowerThird}>
          <div className={styles.ltName}>{COACH_NAME}</div>
          <div className={styles.ltRole}>{t("role")}</div>
        </div>
      </div>
    </section>
  );
}
