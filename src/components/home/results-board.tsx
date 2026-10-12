import { Fragment, type ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import {
  LAN_RESULTS,
  WINS,
  type LanResult,
  type Win,
} from "@/content/results";
import type { Locale } from "@/i18n/routing";
import { formatListParts, formatPlace } from "@/lib/format";
import styles from "./results-board.module.css";

const FIRST_PLACE = 1;

/**
 * Nombres propios (torneos, temporadas, jugadores): `translate="no"` evita que
 * el traductor del navegador los cambie ("Fazer" → "Do").
 */
function Name({ children }: { children: string }) {
  return <span translate="no">{children}</span>;
}

/** " 2025" / " CH6S1" tras el torneo, o nada si el resultado no lo tiene. */
function Detail({ value, className }: { value?: string; className?: string }) {
  if (!value) return null;

  return (
    <>
      {" "}
      <span className={className} translate="no">
        {value}
      </span>
    </>
  );
}

/** "K1ng, Fazer y Phzin": los nombres no se traducen, la conjunción sí. */
function Players({
  players,
  locale,
}: {
  players: readonly string[];
  locale: Locale;
}) {
  return (
    <>
      {formatListParts(players, locale).map(({ type, value }, index) => (
        <Fragment key={index}>
          {type === "element" ? <Name>{value}</Name> : value}
        </Fragment>
      ))}
    </>
  );
}

/*
 * Los espacios `{" "}` entre puesto y torneo no se ven (el flex los ignora),
 * pero sin ellos un lector de pantalla leería "5ºEsports World Cup".
 */
function LanItem({ result, locale }: { result: LanResult; locale: Locale }) {
  return (
    <li className={styles.lan}>
      <span className={styles.place}>{formatPlace(result.place, locale)}</span>{" "}
      <span>
        <span className={styles.event}>
          <Name>{result.event}</Name>
        </span>
        <Detail value={result.label} className={styles.muted} />
      </span>
    </li>
  );
}

function WinItem({ win, locale }: { win: Win; locale: Locale }) {
  return (
    <li className={styles.win}>
      <span className={styles.place}>{formatPlace(FIRST_PLACE, locale)}</span>{" "}
      <span>
        <Name>{win.event}</Name>
        <Detail value={win.season} />{" "}
        <span className={styles.players}>
          <Players players={win.players} locale={locale} />
        </span>
      </span>
    </li>
  );
}

/** Una columna: título en dorado y su lista, nombrada por ese título. */
function Group({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h3 id={id} className={styles.groupTitle}>
        {title}
      </h3>
      {/* `role="list"` porque Safari quita la semántica a las listas sin viñetas. */}
      <ul className={styles.list} role="list" aria-labelledby={id}>
        {children}
      </ul>
    </div>
  );
}

/** Resultados en dos columnas: campeonatos presenciales y campeonatos online. */
export async function ResultsBoard() {
  const t = await getTranslations("Results");
  const locale = await getLocale();

  return (
    <section
      id="results"
      className={`${styles.results} stage`}
      aria-labelledby="res-title"
    >
      <div className="mx-auto max-w-wrap px-gutter">
        <div className={styles.sectionHead}>
          <h2 id="res-title">{t("title")}</h2>
          <p>{t("intro")}</p>
        </div>
        {/* Presenciales primero: en celular es la columna de arriba. */}
        <div className={styles.columns}>
          <Group id="res-lan-title" title={t("lanTitle")}>
            {LAN_RESULTS.map((result) => (
              <LanItem
                key={`${result.event}-${result.label}-${result.place}`}
                result={result}
                locale={locale}
              />
            ))}
          </Group>
          <Group id="res-online-title" title={t("onlineTitle")}>
            {WINS.map((win) => (
              <WinItem
                key={`${win.event}-${win.season ?? ""}-${win.players.join("-")}`}
                win={win}
                locale={locale}
              />
            ))}
          </Group>
        </div>
      </div>
    </section>
  );
}
