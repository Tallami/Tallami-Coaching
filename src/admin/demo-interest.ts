// Clics de ejemplo en los botones de reserva del sitio, para ver la página
// Servicios con números. Se arman a partir de las ventas de ejemplo: cada
// servicio recibe unos 4 a 9 clics por cada venta de ese mes (una conversión de
// entre el 11 y el 25 %), con un mínimo para que ningún botón quede en cero
// salvo Temporada Pro, que solo tuvo clics hace 4 y 5 meses. Las ventas del
// pack de clases se suman a Clase 1 a 1: el sitio no tiene botón para el pack.
//
// Es determinístico (mismo día, mismos clics), usa su propio generador al azar
// para no tocar las ventas de ejemplo y reconoce sus filas por el id (un rango
// reservado) para poder borrarlas y volver a cargarlas.

import { SITE_BOOKING_ITEMS, type InterestItem, type InterestLocale } from "@/admin/catalog";
import { createRandom, pickWeighted, type Random } from "@/admin/demo-random";
import { addMonths, firstOfMonth, lastOfMonth } from "@/admin/metrics/period";
import type { NewInterestEvent, NewSale } from "@/db/schema";

export type DemoInterestEvent = NewInterestEvent & { id: number };

/** Los clics de ejemplo tienen ids desde acá: el `bigserial` de la base no llega a este rango. */
export const DEMO_INTEREST_ID_BASE = 9_000_000_000_000;
/** Valor fijo en lugar del hash de una IP: los datos de ejemplo no vienen de ninguna conexión. */
export const DEMO_INTEREST_IP_HASH = "demo";

const SEED = 0x1ee7_f00d;
const HISTORY_MONTHS = 14;
const MIN_CLICKS_PER_SALE = 4;
const EXTRA_CLICKS_PER_SALE = 5;
const MIN_CLICKS_PER_MONTH = 2;
const PRO_SEASON_CLICK_MONTHS: ReadonlySet<number> = new Set([4, 5]);
const PRO_SEASON_MIN_CLICKS = 3;
const PRO_SEASON_EXTRA_CLICKS = 4;
const FIRST_HOUR = 8;
const HOURS_AWAKE = 16;

const LOCALES: readonly (readonly [InterestLocale, number])[] = [
  ["es", 60],
  ["pt", 25],
  ["en", 15],
];
const COUNTRIES: readonly (readonly [string | null, number])[] = [
  ["AR", 38],
  ["BR", 22],
  ["MX", 10],
  ["CL", 5],
  ["CO", 4],
  ["UY", 3],
  ["ES", 3],
  [null, 15],
];

type DemoSaleRef = Pick<NewSale, "item" | "status" | "paidOn">;

const twoDigits = (value: number) => String(value).padStart(2, "0");

/** Cuántas ventas de ingreso tuvo cada ítem en el mes "AAAA-MM". */
function incomeSalesByItem(sales: readonly DemoSaleRef[], month: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sale of sales) {
    if ((sale.status !== "paid" && sale.status !== "delivered") || !sale.paidOn?.startsWith(month)) continue;
    counts.set(sale.item, (counts.get(sale.item) ?? 0) + 1);
  }
  return counts;
}

function clicksFor(item: InterestItem, monthsAgo: number, sold: Map<string, number>, random: Random): number {
  if (item === "proSeason") {
    return PRO_SEASON_CLICK_MONTHS.has(monthsAgo)
      ? PRO_SEASON_MIN_CLICKS + Math.floor(random() * PRO_SEASON_EXTRA_CLICKS)
      : 0;
  }
  // El pack de clases se pide desde el botón de Clase 1 a 1.
  const sales = (sold.get(item) ?? 0) + (item === "lesson" ? (sold.get("lessonPack") ?? 0) : 0);
  const perSale = MIN_CLICKS_PER_SALE + random() * EXTRA_CLICKS_PER_SALE;
  return Math.max(MIN_CLICKS_PER_MONTH, Math.round(sales * perSale));
}

interface Draft {
  item: InterestItem;
  at: Date;
  locale: InterestLocale;
  country: string | null;
}

function monthDrafts(
  sales: readonly DemoSaleRef[],
  today: string,
  monthsAgo: number,
  random: Random,
): Draft[] {
  const monthStart = addMonths(firstOfMonth(today), -monthsAgo);
  const month = monthStart.slice(0, 7);
  const lastDay = monthsAgo === 0 ? today : lastOfMonth(monthStart);
  const availableDays = Number(lastDay.slice(8, 10));
  const sold = incomeSalesByItem(sales, month);

  return SITE_BOOKING_ITEMS.flatMap((item) =>
    Array.from({ length: clicksFor(item, monthsAgo, sold, random) }, (): Draft => {
      const day = 1 + Math.floor(random() * availableDays);
      const hour = FIRST_HOUR + Math.floor(random() * HOURS_AWAKE);
      const minute = Math.floor(random() * 60);
      const second = Math.floor(random() * 60);
      return {
        item,
        // La hora es la de Argentina (UTC-3).
        at: new Date(`${month}-${twoDigits(day)}T${twoDigits(hour)}:${twoDigits(minute)}:${twoDigits(second)}-03:00`),
        locale: pickWeighted(random, LOCALES),
        country: pickWeighted(random, COUNTRIES),
      };
    }),
  );
}

/**
 * Los clics de ejemplo de 14 meses de historia hasta `today` ("AAAA-MM-DD",
 * hoy en Argentina), del más viejo al más nuevo, con ids desde `DEMO_INTEREST_ID_BASE`.
 */
export function buildDemoInterest(today: string, sales: readonly DemoSaleRef[]): DemoInterestEvent[] {
  const random = createRandom(SEED);
  const drafts = Array.from({ length: HISTORY_MONTHS }, (_, index) =>
    monthDrafts(sales, today, HISTORY_MONTHS - 1 - index, random),
  )
    .flat()
    .map((draft, order) => ({ draft, order }))
    .sort((a, b) => a.draft.at.getTime() - b.draft.at.getTime() || a.order - b.order);

  return drafts.map(({ draft }, index) => ({
    id: DEMO_INTEREST_ID_BASE + index + 1,
    item: draft.item,
    locale: draft.locale,
    country: draft.country,
    ipHash: DEMO_INTEREST_IP_HASH,
    createdAt: draft.at,
  }));
}
