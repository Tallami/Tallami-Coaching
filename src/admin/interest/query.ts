// Lectura de los clics para la página Servicios: cuántos clics tuvo cada botón
// en un rango de días de Argentina. Un día de Argentina va de las 00:00 a las
// 24:00 en UTC-3 (sin horario de verano), así un clic a las 23:30 del 30 de
// septiembre es de septiembre aunque en UTC ya sea 1.º de octubre.

import { and, count, gte, lt, lte } from "drizzle-orm";
import { INTEREST_ITEMS, type InterestItem } from "@/admin/catalog";
import { argentinaLocalToDate } from "@/admin/dates";
import { addDays, type DateRange } from "@/admin/metrics/period";
import type { Db } from "@/db/client";
import { interestDrops, interestEvents } from "@/db/schema";

export interface ItemClicks {
  item: InterestItem;
  clicks: number;
}

/** El instante en que empieza un día de Argentina ("AAAA-MM-DD"). */
function startOfDay(day: string): Date {
  const start = argentinaLocalToDate(`${day}T00:00`);
  if (!start) throw new RangeError(`Día inválido: "${day}" (se espera AAAA-MM-DD).`);
  return start;
}

/**
 * Clics por botón en el rango (los dos días incluidos), de todos los ítems con
 * clics posibles en el orden del catálogo y con cero para los que nadie tocó.
 */
export async function interestByItem(db: Db, range: DateRange): Promise<ItemClicks[]> {
  const rows = await db
    .select({ item: interestEvents.item, clicks: count() })
    .from(interestEvents)
    .where(
      and(
        gte(interestEvents.createdAt, startOfDay(range.from)),
        lt(interestEvents.createdAt, startOfDay(addDays(range.to, 1))),
      ),
    )
    .groupBy(interestEvents.item);

  const clicksByItem = new Map(rows.map((row) => [row.item, row.clicks]));
  return INTEREST_ITEMS.map((item) => ({ item, clicks: clicksByItem.get(item) ?? 0 }));
}

/**
 * Clics que el registro descartó por exceso (tope por minuto o por hora, ver
 * `record.ts`) en el rango de días de Argentina, los dos extremos incluidos.
 * Cero si no hubo ninguno.
 */
export async function interestDropsInRange(db: Db, range: DateRange): Promise<number> {
  const rows = await db
    .select({ dropped: interestDrops.dropped })
    .from(interestDrops)
    .where(and(gte(interestDrops.day, range.from), lte(interestDrops.day, range.to)));
  return rows.reduce((total, row) => total + row.dropped, 0);
}
