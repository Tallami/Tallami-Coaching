// Guardado de un clic con sus límites: 30 eventos por minuto por visitante
// (hash de IP, ver `ip-key.ts`) y dos topes globales entre todos los visitantes:
// `INTEREST_GLOBAL_MAX_PER_WINDOW` eventos por minuto y `INTEREST_GLOBAL_MAX_PER_HOUR`
// por hora. Los topes globales acotan cuánto puede escribir alguien que rote IPs
// (el de la hora, cuánto en total aunque reparta el abuso en minutos): por
// encima de cualquiera de los dos, los clics se descartan en silencio y se
// cuentan por día (`drops.ts`, `interest_drops`), para que la página Servicios
// diga cuántos fueron. Un visitante que pasa su propio tope recibe un 429 y no
// cuenta como descarte. Los eventos viven en la tabla `interest_events` (no en
// memoria: en Vercel cada pedido puede caer en una instancia distinta) y se
// borran a los 400 días (`retention.ts`).
//
// Reservar antes de revisar, como el límite de ingresos al panel
// (`src/admin/auth/rate-limit.ts`): mirar el cupo y recién después anotar deja
// pasar una ráfaga, porque todos los pedidos simultáneos ven el mismo conteo.
// Por eso el evento se anota primero, se cuentan las ventanas incluyendo el
// propio y, si alguna se pasó del tope, se borra ese mismo evento. De los
// eventos que quedan, el último en anotarse contó a todos los demás, así que
// nunca sobreviven más del tope (en una ráfaga muy apretada pueden borrarse más
// de los necesarios: de quien insiste, eso no importa). Antes de reservar se
// mira el conteo una vez, para que un abuso sostenido no escriba ni borre filas
// de eventos (lo único que escribe un descarte es sumar uno al día).

import { and, count, eq, gt } from "drizzle-orm";
import type { InterestItem, InterestLocale } from "@/admin/catalog";
import type { Db } from "@/db/client";
import { interestEvents } from "@/db/schema";
import { countDroppedClick } from "./drops";
import { purgeInterestIfDue } from "./retention";

/** Eventos que acepta un visitante por ventana. */
export const INTEREST_MAX_PER_WINDOW = 30;
/**
 * Eventos que acepta el sitio entero por ventana. Es generoso (el tráfico real
 * son unos pocos clics por minuto) y tiene un solo trabajo: que quien rote IPs
 * no pueda escribir sin límite. Se lee con el índice de `created_at`.
 */
export const INTEREST_GLOBAL_MAX_PER_WINDOW = 200;
/**
 * Eventos que acepta el sitio entero por hora. El tope por minuto solo permitiría
 * 12.000 por hora; este corta antes a quien reparte un abuso en muchos minutos.
 * También es holgado: el tráfico real es una fracción de esto.
 */
export const INTEREST_GLOBAL_MAX_PER_HOUR = 2000;
/** Largo de la ventana deslizante: un minuto. */
export const INTEREST_WINDOW_MS = 60_000;
/** Largo de la ventana del tope por hora. */
export const INTEREST_HOUR_MS = 60 * INTEREST_WINDOW_MS;

export interface InterestLimits {
  perIp: number;
  global: number;
  hourly: number;
}

const DEFAULT_LIMITS: InterestLimits = {
  perIp: INTEREST_MAX_PER_WINDOW,
  global: INTEREST_GLOBAL_MAX_PER_WINDOW,
  hourly: INTEREST_GLOBAL_MAX_PER_HOUR,
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
 * - `dropped`: el sitio pasó el tope global, por minuto o por hora (el endpoint
 *   contesta 204 sin guardar); queda contado en el día.
 */
export type RecordResult = "stored" | "rate-limited" | "dropped";

function windowStart(at: Date, windowMs: number): Date {
  return new Date(at.getTime() - windowMs);
}

/** Eventos de este hash de IP en el último minuto, contando hasta `at`. */
async function countVisitor(db: Db, ipHash: string, at: Date): Promise<number> {
  const [row] = await db
    .select({ events: count() })
    .from(interestEvents)
    .where(and(eq(interestEvents.ipHash, ipHash), gt(interestEvents.createdAt, windowStart(at, INTEREST_WINDOW_MS))));
  return row?.events ?? 0;
}

/** Eventos de todos en la ventana de `windowMs` que termina en `at`. */
async function countAll(db: Db, at: Date, windowMs: number): Promise<number> {
  const [row] = await db
    .select({ events: count() })
    .from(interestEvents)
    .where(gt(interestEvents.createdAt, windowStart(at, windowMs)));
  return row?.events ?? 0;
}

/**
 * ¿Se pasó algún tope? Primero el del visitante (quien insiste recibe 429),
 * después el global del minuto y el de la hora. Con `includesOwnRow` el conteo
 * ya trae el evento reservado: pasarse es tener más que el tope; antes de
 * reservar, tener ya el tope.
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
  if (over(await countAll(db, at, INTEREST_WINDOW_MS), limits.global)) return "dropped";
  if (over(await countAll(db, at, INTEREST_HOUR_MS), limits.hourly)) return "dropped";
  return "ok";
}

/**
 * Guarda el evento si no se pasó ningún tope. La hora la pone la app (la misma
 * con la que se cuentan las ventanas). Si se pasó alguno no deja ninguna fila;
 * un descarte por los topes globales se suma al día (`countDroppedClick`).
 * Al guardar, limpia los clics vencidos si toca (`purgeInterestIfDue`).
 * `limits` puede traer solo algunos topes: los demás son los de siempre.
 */
export async function recordInterest(
  db: Db,
  event: InterestEventInput,
  at: Date = new Date(),
  limits: Partial<InterestLimits> = {},
): Promise<RecordResult> {
  const effective: InterestLimits = { ...DEFAULT_LIMITS, ...limits };

  const before = await verdict(db, event.ipHash, at, effective, false);
  if (before !== "ok") return finish(db, before, at);

  const [reservation] = await db
    .insert(interestEvents)
    .values({ ...event, createdAt: at })
    .returning({ id: interestEvents.id });

  const after = await verdict(db, event.ipHash, at, effective, true);
  if (after !== "ok") {
    await db.delete(interestEvents).where(eq(interestEvents.id, reservation.id));
    return finish(db, after, at);
  }

  await purgeInterestIfDue(db, at);
  return "stored";
}

/** Cuenta el descarte (solo los de los topes globales) y devuelve el resultado. */
async function finish(db: Db, result: "rate-limited" | "dropped", at: Date): Promise<RecordResult> {
  if (result === "dropped") await countDroppedClick(db, at);
  return result;
}
