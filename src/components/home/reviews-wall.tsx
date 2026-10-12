import { getLocale, getTranslations } from "next-intl/server";
import { MarqueeGroup, MarqueeRow } from "@/components/motion/marquee";
import { INTL_TAG } from "@/i18n/routing";
import type { TweetCard as TweetCardData } from "@/lib/tweets";
import styles from "./reviews-wall.module.css";
import { TweetCard } from "./tweet-card";

const TITLE_ID = "reviews-title";
/**
 * Segundos que una fila gasta por tarjeta en cada vuelta: con tarjetas de
 * 250 px y 14 px de separación, unos 37 px por segundo.
 */
const SECONDS_PER_CARD = 7.2;
/** Con menos tarjetas la copia se estira al ancho de la fila; la velocidad no sube de ahí. */
const MIN_CARDS_PER_LOOP = 5;
/** Los tweets se fechan en hora de Buenos Aires: la que vieron la mayoría de sus jugadores. */
const TWEET_TIME_ZONE = "America/Argentina/Buenos_Aires";

interface ReviewsWallProps {
  /** Tarjetas del más nuevo al más viejo (`getTweetCards`). */
  cards: readonly TweetCardData[];
}

function loopSeconds(cardCount: number): number {
  return Math.max(cardCount, MIN_CARDS_PER_LOOP) * SECONDS_PER_CARD;
}

/** Las tarjetas de una fila, en orden. Cada una se lee una vez como link a su tweet. */
async function CardList({ cards }: ReviewsWallProps) {
  const [t, locale] = await Promise.all([
    getTranslations("Reviews"),
    getLocale(),
  ]);
  const formatDate = new Intl.DateTimeFormat(INTL_TAG[locale], {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: TWEET_TIME_ZONE,
  });

  return (
    // `role="list"` porque Safari quita la semántica a las listas sin viñetas.
    // `translate="no"`: nombres, usuarios y textos de tweets no se traducen.
    <ul className={styles.list} role="list" translate="no">
      {cards.map((card) => (
        <li key={card.id} className={styles.item}>
          <TweetCard
            card={card}
            label={t("cardLabel", { name: card.author.name })}
            date={formatDate.format(new Date(card.createdAt))}
            viewOnX={t("viewOnX")}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Muro de Reviews: tweets reales de los jugadores en dos filas que pasan solas
 * en sentidos opuestos. Del más nuevo al más viejo, alternando: lugares pares
 * arriba, impares abajo. El lector de pantalla lee cada tarjeta una vez, y
 * una sola pausa vale para las dos filas. Sin tarjetas, la sección no existe.
 */
export async function ReviewsWall({ cards }: ReviewsWallProps) {
  if (cards.length === 0) return null;

  const t = await getTranslations("Reviews");
  const topCards = cards.filter((_, index) => index % 2 === 0);
  const bottomCards = cards.filter((_, index) => index % 2 === 1);

  return (
    <section
      id="reviews"
      className={`${styles.reviews} stage`}
      aria-labelledby={TITLE_ID}
    >
      <div className="mx-auto max-w-wrap px-gutter">
        <div className={styles.sectionHead}>
          <h2 id={TITLE_ID}>{t("title")}</h2>
          <p>{t("lede")}</p>
        </div>
      </div>
      <MarqueeGroup
        className={styles.wall}
        pauseLabel={t("pause")}
        resumeLabel={t("resume")}
      >
        <MarqueeRow direction="left" durationSeconds={loopSeconds(topCards.length)}>
          <CardList cards={topCards} />
        </MarqueeRow>
        {bottomCards.length > 0 && (
          <MarqueeRow
            direction="right"
            durationSeconds={loopSeconds(bottomCards.length)}
          >
            <CardList cards={bottomCards} />
          </MarqueeRow>
        )}
      </MarqueeGroup>
    </section>
  );
}
