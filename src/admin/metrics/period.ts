// Períodos del resumen y aritmética de calendario sobre días "AAAA-MM-DD" de
// Argentina. Los días son texto y se comparan como texto (la fecha ISO ordena
// igual que el calendario); para sumar días o meses se usa aritmética de
// calendario en UTC, que no tiene horario de verano. Nunca se interpreta un
// "AAAA-MM-DD" con `new Date("AAAA-MM-DD")` para decidir un día de Argentina.

import { isValidIsoDate, todayInArgentina } from "@/admin/dates";

// "Hoy" en Argentina ya vive en `dates.ts`: se reutiliza tal cual.
export { todayInArgentina };

export const PERIODS = ["thisMonth", "lastMonth", "last30", "last12", "thisYear"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  thisMonth: "Este mes",
  lastMonth: "Mes pasado",
  last30: "Últimos 30 días",
  last12: "Últimos 12 meses",
  thisYear: "Este año",
};

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value);
}

/** Rango de días de Argentina, "AAAA-MM-DD", con los dos extremos incluidos. */
export interface DateRange {
  from: string;
  to: string;
}

const MS_PER_DAY = 86_400_000;
const LAST_30_DAYS = 30;
const MONTHS_IN_YEAR = 12;

interface DayParts {
  year: number;
  month: number;
  date: number;
}

function parseDay(day: string): DayParts {
  if (!isValidIsoDate(day)) {
    throw new RangeError(`Día inválido: "${day}" (se espera AAAA-MM-DD).`);
  }
  return {
    year: Number(day.slice(0, 4)),
    month: Number(day.slice(5, 7)),
    date: Number(day.slice(8, 10)),
  };
}

/** Milisegundos UTC de la medianoche de ese día (con `setUTCFullYear`, que no confunde los años 0 a 99). */
function utcMs(year: number, month: number, date: number): number {
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, date);
  return instant.getTime();
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  // El día 0 del mes siguiente es el último de este.
  const instant = new Date(0);
  instant.setUTCFullYear(year, month, 0);
  return instant.getUTCDate();
}

/** Suma (o resta, con un número negativo) días de calendario. */
export function addDays(day: string, days: number): string {
  const { year, month, date } = parseDay(day);
  return dayOf(utcMs(year, month, date) + days * MS_PER_DAY);
}

/**
 * Suma (o resta) meses de calendario. Si el mes de destino no tiene ese día,
 * queda el último: 31/3 menos un mes es 28/2 (29/2 en año bisiesto).
 */
export function addMonths(day: string, months: number): string {
  const { year, month, date } = parseDay(day);
  const absolute = year * MONTHS_IN_YEAR + (month - 1) + months;
  const targetYear = Math.floor(absolute / MONTHS_IN_YEAR);
  const targetMonth = (((absolute % MONTHS_IN_YEAR) + MONTHS_IN_YEAR) % MONTHS_IN_YEAR) + 1;
  const targetDate = Math.min(date, daysInMonth(targetYear, targetMonth));
  return `${String(targetYear).padStart(4, "0")}-${twoDigits(targetMonth)}-${twoDigits(targetDate)}`;
}

export function firstOfMonth(day: string): string {
  parseDay(day);
  return `${day.slice(0, 7)}-01`;
}

export function lastOfMonth(day: string): string {
  const { year, month } = parseDay(day);
  return `${day.slice(0, 7)}-${twoDigits(daysInMonth(year, month))}`;
}

/** "2026-10-13" → "2026-10". */
export function monthOf(day: string): string {
  parseDay(day);
  return day.slice(0, 7);
}

/** ¿Cae el día dentro del rango, extremos incluidos? */
export function isInRange(day: string, range: DateRange): boolean {
  return day >= range.from && day <= range.to;
}

/** Cantidad de días del rango, contando los dos extremos. */
function lengthInDays(range: DateRange): number {
  const from = parseDay(range.from);
  const to = parseDay(range.to);
  const days = (utcMs(to.year, to.month, to.date) - utcMs(from.year, from.month, from.date)) / MS_PER_DAY;
  return days + 1;
}

/**
 * El rango de un período, con "hoy" en Argentina. Los períodos de calendario
 * cubren el mes o el año entero aunque no hayan terminado (el último día puede
 * ser futuro): así "este mes" coincide con la última barra del gráfico mensual
 * y con "últimos 12 meses" (12 meses de calendario, el actual incluido).
 *
 * - `thisMonth`: del 1.º al último día del mes en curso.
 * - `lastMonth`: el mes anterior completo.
 * - `last30`: los 30 días que terminan hoy, hoy incluido.
 * - `last12`: del 1.º del mes de hace 11 meses al último día del mes en curso.
 * - `thisYear`: del 1 de enero al 31 de diciembre del año en curso.
 */
export function periodRange(period: Period, now: Date): DateRange {
  const today = todayInArgentina(now);
  switch (period) {
    case "thisMonth":
      return { from: firstOfMonth(today), to: lastOfMonth(today) };
    case "lastMonth": {
      const lastMonth = addMonths(firstOfMonth(today), -1);
      return { from: lastMonth, to: lastOfMonth(lastMonth) };
    }
    case "last30":
      return { from: addDays(today, -(LAST_30_DAYS - 1)), to: today };
    case "last12":
      return { from: addMonths(firstOfMonth(today), -(MONTHS_IN_YEAR - 1)), to: lastOfMonth(today) };
    case "thisYear":
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
  }
}

/** ¿El rango son meses de calendario completos (del 1.º al último día de un mes)? */
function isWholeMonths(range: DateRange): boolean {
  return range.from.endsWith("-01") && lastOfMonth(range.to) === range.to;
}

function monthsIn(range: DateRange): number {
  const from = parseDay(range.from);
  const to = parseDay(range.to);
  return (to.year - from.year) * MONTHS_IN_YEAR + (to.month - from.month) + 1;
}

/**
 * El rango anterior, para comparar: termina el día antes de que empiece este.
 * Si son meses de calendario completos (un mes, 12 meses, un año), el anterior
 * es la misma cantidad de meses completos justo antes ("el mes anterior
 * completo"); en cualquier otro caso tiene la misma cantidad de días.
 */
export function previousRange(range: DateRange): DateRange {
  if (range.from > range.to) {
    throw new RangeError(`El rango termina antes de empezar: ${range.from} a ${range.to}.`);
  }
  const to = addDays(range.from, -1);
  if (isWholeMonths(range)) {
    return { from: addMonths(range.from, -monthsIn(range)), to };
  }
  return { from: addDays(range.from, -lengthInDays(range)), to };
}

/**
 * El rango anterior de un período. Igual que `previousRange(periodRange(...))`
 * salvo en "últimos 30 días", que siempre compara contra 30 días aunque justo
 * coincidan con un mes de calendario (30/11: del 1/11 al 30/11).
 */
export function previousPeriodRange(period: Period, now: Date): DateRange {
  const range = periodRange(period, now);
  if (period === "last30") {
    return { from: addDays(range.from, -LAST_30_DAYS), to: addDays(range.from, -1) };
  }
  return previousRange(range);
}
