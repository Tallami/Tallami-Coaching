import { getTranslations } from "next-intl/server";
import { MarqueeGroup, MarqueeRow } from "@/components/motion/marquee";
import { PLAYERS } from "@/content/players";
import { PlayerChip } from "./player-chip";
import styles from "./players-strip.module.css";

const LABEL_ID = "players-label";
/** Una vuelta de la franja: con los 11 jugadores, unos 33 px por segundo. */
const LOOP_SECONDS = 40;

/**
 * Franja "Trabajé con", justo debajo de la portada: jugadores que entrenó
 * Tallami, pasando solos en loop. El lector de pantalla los lee una vez, como
 * lista; la copia del loop la arma `MarqueeRow`.
 */
export async function PlayersStrip() {
  const t = await getTranslations("Players");

  return (
    <section className={`${styles.strip} stage`} aria-labelledby={LABEL_ID}>
      <MarqueeGroup
        className={styles.group}
        pauseLabel={t("pause")}
        resumeLabel={t("resume")}
      >
        <p id={LABEL_ID} className={styles.label}>
          {t("label")}
        </p>
        <div className={styles.band}>
          <MarqueeRow
            direction="left"
            durationSeconds={LOOP_SECONDS}
            labelledBy={LABEL_ID}
          >
            {/* `role="list"` porque Safari quita la semántica a las listas sin viñetas.
                `translate="no"`: los nombres de jugador no se traducen. */}
            <ul
              className={styles.list}
              role="list"
              aria-labelledby={LABEL_ID}
              translate="no"
            >
              {PLAYERS.map((player) => (
                <PlayerChip key={player.handle} player={player} />
              ))}
            </ul>
          </MarqueeRow>
        </div>
      </MarqueeGroup>
    </section>
  );
}
