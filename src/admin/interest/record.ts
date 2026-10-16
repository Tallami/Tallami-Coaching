// Guardado de un clic con el límite por IP: 30 eventos por minuto por hash de
// IP. Los eventos viven en la tabla `interest_events` (no en memoria: en Vercel
// cada pedido puede caer en una instancia distinta).
//
// Reservar antes de revisar, como el límite de ingresos al panel
// (`src/admin/auth/rate-limit.ts`): mirar el cupo y recién después anotar deja
// pasar una ráfaga, porque todos los pedidos simultáneos ven el mismo conteo.
// Por eso el evento se anota primero, se cuenta la ventana incluyendo el propio
// y, si se pasó del tope, se borra ese mismo evento. De los eventos que quedan,
// el último en anotarse contó a todos los demás, así que nunca sobreviven más
// de `INTEREST_MAX_PER_WINDOW` (en una ráfaga muy apretada pueden borrarse más
// de los necesarios: de un bot que insiste, eso no importa). Antes de reservar
// se mira el conteo una vez, para que un abuso sostenido no escriba ni borre filas.

import { and, count, eq, gt } from "drizzle-orm";
import type { InterestItem, InterestLocale } from "@/admin/catalog";
import type { Db } from "@/db/client";
import { interestEvents } from "@/db/schema";

/** Eventos que acepta una IP por ventana. */
export const INTEREST_MAX_PER_WINDOW = 30;
/** Largo de la ventana deslizante: un minuto. */
export const INTEREST_WINDOW_MS = 60_000;

export interface InterestEventInput {
  item: InterestItem;
  locale: InterestLocale;
  /** ISO 3166-1 alfa-2 en mayúsculas, o `null`. */
  country: string | null;
  /** HMAC de la IP (`hashIp`): la IP en claro nunca llega acá. */
  ipHash: string;
}

export type RecordResult = "stored" | "rate-limited";

/** Eventos de este hash de IP en el último minuto, contando hasta `at`. */
async function countRecent(db: Db, ipHash: string, at: Date): Promise<number> {
  const since = new Date(at.getTime() - INTEREST_WINDOW_MS);
  const [row] = await db
    .select({ events: count() })
    .from(interestEvents)
    .where(and(eq(interestEvents.ipHash, ipHash), gt(interestEvents.createdAt, since)));
  return row?.events ?? 0;
}

/**
 * Guarda el evento si la IP no pasó el límite. La hora la pone la app (la misma
 * con la que se cuenta la ventana). Devuelve `"rate-limited"` sin dejar ninguna
 * fila si ya se alcanzó el tope.
 */
export async function recordInterest(
  db: Db,
  event: InterestEventInput,
  at: Date = new Date(),
): Promise<RecordResult> {
  if ((await countRecent(db, event.ipHash, at)) >= INTEREST_MAX_PER_WINDOW) return "rate-limited";

  const [reservation] = await db
    .insert(interestEvents)
    .values({ ...event, createdAt: at })
    .returning({ id: interestEvents.id });

  // Cuenta también el evento recién anotado: pasarse del tope es tener más de 30.
  if ((await countRecent(db, event.ipHash, at)) > INTEREST_MAX_PER_WINDOW) {
    await db.delete(interestEvents).where(eq(interestEvents.id, reservation.id));
    return "rate-limited";
  }
  return "stored";
}
