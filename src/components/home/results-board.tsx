import { getLocale, getTranslations } from "next-intl/server";
import {
  COACHING_EARNINGS_USD,
  EARNINGS_SINCE,
  OTHER_RESULTS,
  WINS,
  type OtherResult,
  type Win,
} from "@/content/results";
import type { Locale } from "@/i18n/routing";
import { formatList, formatPlace, formatUsd } from "@/lib/format";
import styles from "./results-board.module.css";

const FIRST_PLACE = 1;

/** " 2025" / " CH6S1" en gris, o nada si el resultado no tiene temporada. */
function Season({ value }: { value?: string }) {
  if (!value) return null;

  return (
    <>
      {" "}
      <span className={styles.season}>{value}</span>
    </>
  );
}

function WinRow({ win, locale }: { win: Win; locale: Locale }) {
  return (
    <tr role="row" className={styles.win}>
      <td role="cell" className={styles.place}>
        {formatPlace(FIRST_PLACE, locale)}
      </td>
      <td role="cell" className={styles.event}>
        {win.event}
        <Season value={win.season} />
      </td>
      <td role="cell" className={styles.players}>
        {formatList(win.players, locale)}
      </td>
    </tr>
  );
}

function OtherResultItem({
  result,
  locale,
}: {
  result: OtherResult;
  locale: Locale;
}) {
  return (
    <li>
      <span className={styles.place}>{formatPlace(result.place, locale)}</span>
      {result.event}
      <Season value={result.season} />
    </li>
  );
}

/** Tabla de posiciones: primeros puestos, otros resultados y ganancias. */
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
        {/* Los roles repiten los nativos a propósito: ≤640 px la tabla pasa a
            display block/grid y algunos navegadores le quitan la semántica. */}
        <table role="table" className={styles.board}>
          <caption>{t("caption")}</caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">
                {t("columnPlace")}
              </th>
              <th role="columnheader" scope="col">
                {t("columnEvent")}
              </th>
              <th role="columnheader" scope="col">
                {t("columnPlayers")}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {WINS.map((win) => (
              <WinRow
                key={`${win.event}-${win.season ?? ""}-${win.players.join("-")}`}
                win={win}
                locale={locale}
              />
            ))}
          </tbody>
        </table>
        <h3 className={styles.othersTitle}>{t("othersTitle")}</h3>
        <ul className={styles.others} role="list">
          {OTHER_RESULTS.map((result) => (
            <OtherResultItem
              key={`${result.event}-${result.season ?? ""}-${result.place}`}
              result={result}
              locale={locale}
            />
          ))}
        </ul>
        <div className={styles.earnings}>
          <strong>{formatUsd(COACHING_EARNINGS_USD, locale)}</strong>
          <span>{t("earnings", { since: EARNINGS_SINCE })}</span>
        </div>
      </div>
    </section>
  );
}
