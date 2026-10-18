// Textos del resumen: rangos de fechas, meses, porcentajes, países y fechas de
// los pendientes. Los días son texto "AAAA-MM-DD" de Argentina y los nombres de
// meses y días van en una tabla propia (no dependen del motor de `Intl`), así
// "sep." sale igual en todos lados. Los países sí usan `Intl.DisplayNames`.

import { dateToArgentinaLocal } from "@/admin/dates";
import { NO_COUNTRY_LABEL } from "@/admin/metrics/series";
import type { DateRange } from "@/admin/metrics/period";

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
/** Domingo primero, como `getUTCDay()`. */
const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

interface DayParts {
  year: number;
  month: number;
  date: number;
}

function parts(day: string): DayParts {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), date: Number(day.slice(8, 10)) };
}

/**
 * Un rango corto para los rótulos: "1–13 sep." dentro de un mes, "1 ene. – 14
 * oct." entre meses. Lleva el año cuando no es el de `today` o cuando el rango
 * cruza dos años ("1 nov. 2025 – 14 oct. 2026").
 */
export function formatRangeLabel(range: DateRange, today: string): string {
  const from = parts(range.from);
  const to = parts(range.to);
  const monthOf = (month: number) => `${MONTHS_SHORT[month - 1]}.`;

  if (range.from === range.to) {
    const year = to.year === parts(today).year ? "" : ` ${to.year}`;
    return `${to.date} ${monthOf(to.month)}${year}`;
  }
  if (from.year !== to.year) {
    return `${from.date} ${monthOf(from.month)} ${from.year} – ${to.date} ${monthOf(to.month)} ${to.year}`;
  }
  const year = to.year === parts(today).year ? "" : ` ${to.year}`;
  if (from.month === to.month) {
    return `${from.date}–${to.date} ${monthOf(to.month)}${year}`;
  }
  return `${from.date} ${monthOf(from.month)} – ${to.date} ${monthOf(to.month)}${year}`;
}

export interface MonthLabels {
  /** "oct": el eje del gráfico. */
  short: string;
  /** "oct. 2026". */
  medium: string;
  /** "octubre de 2026": lo que leen los lectores de pantalla. */
  long: string;
}

/** Los nombres de un mes "AAAA-MM". */
export function monthLabels(month: string): MonthLabels {
  const year = month.slice(0, 4);
  const index = Number(month.slice(5, 7)) - 1;
  return {
    short: MONTHS_SHORT[index],
    medium: `${MONTHS_SHORT[index]}. ${year}`,
    long: `${MONTHS_LONG[index]} de ${year}`,
  };
}

/** Un porcentaje con coma decimal: 34,5 %. */
export function formatPercent(value: number): string {
  return `${String(value).replace(".", ",")} %`;
}

/** Una variación con su signo: +12,5 %, -3,2 %; el cero va sin signo. */
export function formatSignedPercent(value: number): string {
  if (value === 0) return formatPercent(0);
  return `${value > 0 ? "+" : ""}${formatPercent(value)}`;
}

const regionNames = new Intl.DisplayNames(["es"], { type: "region", fallback: "code" });

/** El nombre del país en español para un código ISO ("AR" → "Argentina"); lo que no se reconoce queda tal cual. */
export function countryLabel(code: string): string {
  if (code === NO_COUNTRY_LABEL) return code;
  try {
    return regionNames.of(code) ?? code;
  } catch {
    // `Intl.DisplayNames` tira RangeError con un código mal formado.
    return code;
  }
}

/** La hora de pared de Argentina de un instante: "2026-10-15T15:00" → partes. */
function argentinaWallClock(iso: string): { day: string; time: string } {
  const [day, time] = dateToArgentinaLocal(new Date(iso)).split("T");
  return { day, time };
}

/** "jue 15/10, 15:00": cuándo es una sesión, en hora de Argentina. */
export function formatSessionWhen(iso: string): string {
  const { day, time } = argentinaWallClock(iso);
  const { year, month, date } = parts(day);
  const weekday = WEEKDAYS_SHORT[new Date(Date.UTC(year, month - 1, date)).getUTCDay()];
  return `${weekday} ${String(date).padStart(2, "0")}/${String(month).padStart(2, "0")}, ${time}`;
}

/** "15/10": el día (de Argentina) de una fecha comprometida; con el año si no es el de `today`. */
export function formatDueDay(iso: string, today?: string): string {
  const { day } = argentinaWallClock(iso);
  const { year, month, date } = parts(day);
  const base = `${String(date).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
  return today !== undefined && year !== parts(today).year ? `${base}/${year}` : base;
}
