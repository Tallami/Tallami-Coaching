// Fechas del negocio: el calendario y el reloj son los de Argentina
// (`America/Argentina/Buenos_Aires`), no los del servidor (UTC en Vercel).
// Los días se manejan como texto "AAAA-MM-DD" y las fechas con hora como el
// valor de un `<input type="datetime-local">` ("AAAA-MM-DDTHH:mm").

const BUSINESS_TIME_ZONE = "America/Argentina/Buenos_Aires";
/** Argentina no tiene horario de verano desde 2009: el desfase es fijo. */
const ARGENTINA_UTC_OFFSET = "-03:00";

/** Años que el panel acepta en una fecha: fuera de ese rango es un tipeo (Chrome vuelve "26" el año 0026). */
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** `en-CA` escribe la fecha como AAAA-MM-DD. */
const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const wallClockFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** ¿Es un día real del calendario, escrito "AAAA-MM-DD"? ("2026-02-30" no lo es). */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/** ¿Es un día real del calendario y de un año entre 2000 y 2100? Fuera de eso, la base lo rechazaría o sería un tipeo. */
export function isPlausibleDay(value: string): boolean {
  const year = Number(value.slice(0, 4));
  return isValidIsoDate(value) && year >= MIN_YEAR && year <= MAX_YEAR;
}

/** El día de hoy en Argentina ("2026-10-14"), aunque en UTC ya sea mañana. */
export function todayInArgentina(now: Date = new Date()): string {
  return dayFormat.format(now);
}

/**
 * Lee "AAAA-MM-DDTHH:mm" como hora de Argentina y devuelve ese instante, o
 * `null` si no es una fecha con hora real.
 */
export function argentinaLocalToDate(value: string): Date | null {
  if (!LOCAL_DATE_TIME.test(value) || !isValidIsoDate(value.slice(0, 10))) return null;
  const parsed = new Date(`${value}:00${ARGENTINA_UTC_OFFSET}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Un instante guardado, como la hora de pared de Argentina ("2026-10-20T15:00"). */
export function dateToArgentinaLocal(date: Date): string {
  const parts = new Map(wallClockFormat.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}`;
}

/** "2026-10-12" → "12/10/2026", como se escribe en Argentina. Es texto: no pasa por zonas horarias. */
export function formatDay(isoDay: string): string {
  const [year, month, day] = isoDay.split("-");
  return `${day}/${month}/${year}`;
}

/** Un instante en hora de Argentina, como se lee en pantalla: "15/10/2026, 14:30". */
export function formatMoment(date: Date): string {
  const [day, time] = dateToArgentinaLocal(date).split("T");
  return `${formatDay(day)}, ${time}`;
}
