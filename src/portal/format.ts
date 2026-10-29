// Cómo se escribe en la página del alumno lo que viene de la base: el monto de una compra, sus
// fechas y el dominio de un link. A diferencia del panel (`src/lib/money.ts`, siempre es-AR), la
// página está en es, pt y en: el número y la fecha siguen las reglas del idioma de quien lee.

import type { Currency } from "@/admin/catalog";
import { INTL_TAG, type Locale } from "@/i18n/routing";

const CENTS_PER_UNIT = 100;
/** Las fechas del negocio son las de Argentina, como en el panel (`src/admin/dates.ts`). */
const BUSINESS_TIME_ZONE = "America/Argentina/Buenos_Aires";
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Un monto en unidades menores, con el código de su moneda delante: "USD 30", "USD 30,50" (es, pt)
 * o "USD 30.50" (en). Sin centavos si no los hay. El código y no un símbolo, porque `$` es del dólar
 * y del peso a la vez y la compra puede estar en cualquiera de las cuatro monedas.
 */
export function formatPortalMoney(amountMinor: number, currency: Currency, locale: Locale): string {
  const hasCents = amountMinor % CENTS_PER_UNIT !== 0;
  const number = new Intl.NumberFormat(INTL_TAG[locale], {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amountMinor / CENTS_PER_UNIT);
  return `${currency} ${number}`;
}

function dateFormat(locale: Locale, timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(INTL_TAG[locale], { dateStyle: "medium", timeZone });
}

/**
 * Un día guardado ("2026-10-12") como se lee en el idioma: "12 oct 2026", "12 de out. de 2026",
 * "Oct 12, 2026". Es el día escrito, no un instante: no pasa por la zona horaria del servidor.
 * Lo que no es un día real del calendario se devuelve tal cual.
 */
export function formatPortalDay(isoDay: string, locale: Locale): string {
  const match = ISO_DAY.exec(isoDay);
  if (!match) return isoDay;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== isoDay) return isoDay;
  return dateFormat(locale, "UTC").format(date);
}

/**
 * El día de un instante guardado (ISO 8601), en hora de Argentina como el panel: lo que se cargó a las
 * 22:30 del 12 no figura el 13 aunque en UTC ya sea mañana. Lo que no es un instante se devuelve tal cual.
 */
export function formatPortalMoment(iso: string, locale: Locale): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat(locale, BUSINESS_TIME_ZONE).format(date);
}

/**
 * El dominio al que va un link (`drive.google.com`), para mostrarlo junto al botón: sin usuario,
 * puerto, camino ni parámetros. `null` si no es un link.
 */
export function linkDomain(link: string): string | null {
  return URL.canParse(link) ? new URL(link).hostname : null;
}
