// Guardado de un clic con sus dos límites: 30 eventos por minuto por visitante
// (hash de IP, ver `ip-key.ts`) y un tope global de `INTEREST_GLOBAL_MAX_PER_WINDOW`
// eventos por minuto entre todos. El tope global acota cuánto puede escribir
// alguien que rote IPs: por encima de él, los clics se descartan en silencio.
// Los eventos viven en la tabla `interest_events` (no en memoria: en Vercel cada
// pedido puede caer en una instancia distinta) y se borran a los 400 días
// (`retention.ts`).
//
// Reservar antes de revisar, como el límite de ingresos al panel
// (`src/admin/auth/rate-limit.ts`): mirar el cupo y recién después anotar deja
// pasar una ráfaga, porque todos los pedidos simultáneos ven el mismo conteo.
// Por eso el evento se anota primero, se cuentan las ventanas incluyendo el
// propio y, si alguna se pasó del tope, se borra ese mismo evento. De los
// eventos que quedan, el último en anotarse contó a todos los demás, así que
// nunca sobreviven más del tope (en una ráfaga muy apretada pueden borrarse más
// de los necesarios: de quien insiste, eso no importa). Antes de reservar se
// mira el conteo una vez, para que un abuso sostenido no escriba ni borre filas.

import { and, count, eq, gt } from "drizzle-orm";
import type { InterestItem, InterestLocale } from "@/admin/catalog";
import type { Db } from "@/db/client";
import { interestEvents } from "@/db/schema";
import { purgeInterestIfDue } from "./retention";

/** Eventos que acepta un visitante por ventana. */
export const INTEREST_MAX_PER_WINDOW = 30;
/**
 * Eventos que acepta el sitio entero por ventana. Es generoso (el tráfico real
 * son unos pocos clics por minuto) y tiene un solo trabajo: que quien rote IPs
 * no pueda escribir sin límite. Se lee con el índice de `created_at`.
 */
export const INTEREST_GLOBAL_MAX_PER_WINDOW = 200;
/** Largo de la ventana deslizante: un minuto. */
export const INTEREST_WINDOW_MS = 60_000;

export interface InterestLimits {
  perIp: number;
  global: number;
}

const DEFAULT_LIMITS: InterestLimits = {
  perIp: INTEREST_MAX_PER_WINDOW,
  global: INTEREST_GLOBAL_MAX_PER_WINDOW,
};

export interface InterestEventInput {
  item: InterestItem;
  locale: InterestLocale;
  /** ISO 3166-1 alfa-2 en mayúsculas, o `null`. */
  country: string | null;
  /** HMAC de la clave del visitante con el día (`interestIpHash`): la IP en claro nunca llega acá. */
  ipHash: string;
}

/**
 * - `stored`: guardado.
 * - `rate-limited`: este visitante pasó su tope (el endpoint contesta 429).
 * - `dropped`: el sitio pasó el tope global (el endpoint contesta 204 sin guardar).
 */
export type RecordResult = "stored" | "rate-limited" | "dropped";

function windowStart(at: Date): Date {
  return new Date(at.getTime() - INTEREST_WINDOW_MS);
}

/** Eventos de este hash de IP en el último minuto, contando hasta `at`. */
async function countVisitor(db: Db, ipHash: string, at: Date): Promise<number> {
  const [row] = await db
    .select({ events: count() })
    .from(interestEvents)
    .where(and(eq(interestEvents.ipHash, ipHash), gt(interestEvents.createdAt, windowStart(at))));
  return row?.events ?? 0;
}

/** Eventos de todos en el último minuto, contando hasta `at`. */
async function countAll(db: Db, at: Date): Promise<number> {
  const [row] = await db
    .select({ events: count() })
    .from(interestEvents)
    .where(gt(interestEvents.createdAt, windowStart(at)));
  return row?.events ?? 0;
}

/**
 * ¿Se pasó algún tope? Primero el del visitante (quien insiste recibe 429) y
 * después el global. Con `includesOwnRow` el conteo ya trae el evento
 * reservado: pasarse es tener más que el tope; antes de reservar, tener ya el tope.
 */
async function verdict(
  db: Db,
  ipHash: string,
  at: Date,
  limits: InterestLimits,
  includesOwnRow: boolean,
): Promise<"ok" | "rate-limited" | "dropped"> {
  const over = (events: number, max: number) => (includesOwnRow ? events > max : events >= max);
  if (over(await countVisitor(db, ipHash, at), limits.perIp)) return "rate-limited";
  if (over(await countAll(db, at), limits.global)) return "dropped";
  return "ok";
}

/**
 * Guarda el evento si no se pasó ningún tope. La hora la pone la app (la misma
 * con la que se cuentan las ventanas). Si se pasó alguno no deja ninguna fila.
 * Al guardar, limpia los clics vencidos si toca (`purgeInterestIfDue`).
 */
export async function recordInterest(
  db: Db,
  event: InterestEventInput,
  at: Date = new Date(),
  limits: InterestLimits = DEFAULT_LIMITS,
): Promise<RecordResult> {
  const before = await verdict(db, event.ipHash, at, limits, false);
  if (before !== "ok") return before;

  const [reservation] = await db
    .insert(interestEvents)
    .values({ ...event, createdAt: at })
    .returning({ id: interestEvents.id });

  const after = await verdict(db, event.ipHash, at, limits, true);
  if (after !== "ok") {
    await db.delete(interestEvents).where(eq(interestEvents.id, reservation.id));
    return after;
  }

  await purgeInterestIfDue(db, at);
  return "stored";
}
