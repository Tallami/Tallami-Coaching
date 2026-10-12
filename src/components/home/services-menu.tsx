import { getLocale, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import {
  LESSON_PACK,
  PRO_SEASON,
  SERVICES,
  bookingHref,
  lessonPackSavingsUsd,
  type Service,
} from "@/content/services";
import { formatUsd } from "@/lib/format";
import styles from "./services-menu.module.css";

interface PriceRowProps {
  name: string;
  price: string;
  /** Aclaración debajo del precio: "por mes", "por dúo o trío"… */
  unit?: string;
}

/** Nombre, línea punteada y precio. El precio es lo que leen los tests. */
function PriceRow({ name, price, unit }: PriceRowProps) {
  return (
    <div className={styles.row}>
      <h3 className={styles.name}>{name}</h3>
      <span className={styles.leader} aria-hidden="true" />
      <span className={styles.amt} data-testid="price">
        {price}
        {unit ? (
          <>
            {" "}
            <small>{unit}</small>
          </>
        ) : null}
      </span>
    </div>
  );
}

async function ServiceItem({ service }: { service: Service }) {
  const t = await getTranslations("Services");
  const locale = await getLocale();
  const { id } = service;

  const description =
    id === "lesson"
      ? t("items.lesson.description", {
          sessions: LESSON_PACK.sessions,
          packPrice: formatUsd(LESSON_PACK.priceUsd, locale),
          savings: formatUsd(lessonPackSavingsUsd(), locale),
        })
      : t(`items.${id}.description`);

  return (
    <li>
      <PriceRow
        name={t(`items.${id}.name`)}
        price={formatUsd(service.priceUsd, locale)}
        unit={service.unit ? t(`units.${service.unit}`) : undefined}
      />
      <p>{description}</p>
      <Button asChild variant="ink-outline" size="sm">
        <a href={bookingHref(id)}>{t(`items.${id}.cta`)}</a>
      </Button>
    </li>
  );
}

/** Tarjeta oscura de Temporada Pro: va última y se entra por aplicación. */
async function ProSeasonCard() {
  const t = await getTranslations("Services");
  const locale = await getLocale();

  return (
    <div className={`${styles.pro} stage`}>
      <PriceRow
        name={t("pro.name")}
        price={formatUsd(PRO_SEASON.priceUsd, locale)}
        unit={t("pro.unit", { percent: PRO_SEASON.prizeSharePercent })}
      />
      <p>{t("pro.description")}</p>
      <Button asChild>
        <a href={bookingHref("proSeason")}>{t("pro.cta")}</a>
      </Button>
    </div>
  );
}

/** Pizarra de servicios: columna de introducción pegajosa y menú con precios. */
export async function ServicesMenu() {
  const t = await getTranslations("Services");

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
              <ServiceItem key={service.id} service={service} />
            ))}
          </ul>
          <ProSeasonCard />
        </div>
      </div>
    </section>
  );
}
