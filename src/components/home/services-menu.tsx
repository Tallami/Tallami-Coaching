import { getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { PRO_SEASON, SERVICES, bookingHref, type Service } from "@/content/services";
import type { Locale } from "@/i18n/routing";
import { getPublicPesosPerDollar } from "@/payments/cached-rate";
import { BookingLink } from "./booking-link";
import { PricePair } from "./price-pair";
import styles from "./services-menu.module.css";

interface PriceRowProps {
  name: string;
  priceUsd: number;
  rate: string | null;
  locale: Locale;
  /** Aclaración junto al precio: "por equipo, toda la temporada". */
  unit?: string;
}

/** Nombre, línea punteada y los dos precios (dólares y pesos). */
function PriceRow({ name, priceUsd, rate, locale, unit }: PriceRowProps) {
  return (
    <div className={styles.row}>
      <h3 className={styles.name}>{name}</h3>
      <span className={styles.leader} aria-hidden="true" />
      <PricePair priceUsd={priceUsd} rate={rate} locale={locale} className={styles.amt} unit={unit} />
    </div>
  );
}

async function ServiceItem({ service, rate }: { service: Service; rate: string | null }) {
  const t = await getTranslations("Services");
  const locale = (await getLocale()) as Locale;
  const { id } = service;

  return (
    <li>
      <PriceRow name={t(`items.${id}.name`)} priceUsd={service.priceUsd} rate={rate} locale={locale} />
      <p>{t(`items.${id}.description`)}</p>
      <Button asChild variant="ink-outline" size="sm">
        <BookingLink item={id} locale={locale} href={bookingHref(id)}>
          {t(`items.${id}.cta`)}
        </BookingLink>
      </Button>
    </li>
  );
}

/** Tarjeta oscura de Temporada Pro: va última y se entra por aplicación. */
async function ProSeasonCard({ rate }: { rate: string | null }) {
  const t = await getTranslations("Services");
  const locale = (await getLocale()) as Locale;

  return (
    <div className={`${styles.pro} stage`}>
      <PriceRow
        name={t("pro.name")}
        priceUsd={PRO_SEASON.priceUsd}
        rate={rate}
        locale={locale}
        unit={t("pro.unit")}
      />
      <p>{t("pro.description")}</p>
      <Button asChild>
        <BookingLink item="proSeason" locale={locale} href={bookingHref("proSeason")}>
          {t("pro.cta")}
        </BookingLink>
      </Button>
    </div>
  );
}

/** Pizarra de servicios: columna de introducción pegajosa y menú con precios. */
export async function ServicesMenu() {
  const t = await getTranslations("Services");
  const rate = await getPublicPesosPerDollar();

  return (
    <section id="services" className="paper" aria-labelledby="svc-title">
      <div className={`${styles.layout} mx-auto max-w-wrap px-gutter`}>
        <div className={styles.intro}>
          <h2 id="svc-title">{t("title")}</h2>
          <p>{t("payments")}</p>
          <p>{t("minors")}</p>
          <p className={styles.tip}>{t("tip")}</p>
        </div>
        <div>
          <ul className={styles.menu} role="list">
            {SERVICES.map((service) => (
              <ServiceItem key={service.id} service={service} rate={rate} />
            ))}
          </ul>
          <ProSeasonCard rate={rate} />
        </div>
      </div>
    </section>
  );
}
