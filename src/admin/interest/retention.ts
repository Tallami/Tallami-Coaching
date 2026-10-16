// Cuánto se guardan los clics. Ninguna pantalla muestra clics de hace más de un
// período de 12 meses, así que a los 400 días (13 meses y un poco más) se
// borran. La limpieza es oportunista, sin tarea programada: al guardar un clic,
// y como mucho una vez por hora por proceso, se borran los vencidos con un
// `delete` sobre el índice de `created_at`.

import { lt } from "drizzle-orm";
import { todayInArgentina } from "@/admin/dates";
import type { Db } from "@/db/client";
import { interestDrops, interestEvents } from "@/db/schema";

/** Días que se conserva un clic. */
export const INTEREST_RETENTION_DAYS = 400;
/** Cada cuánto, como mucho, se hace la limpieza. */
export const PURGE_EVERY_MS = 60 * 60 * 1000;

const DAY_MS = 86_400_000;

/**
 * Borra los clics de más de `INTEREST_RETENTION_DAYS` días (el que cumple justo 400
 * se queda) y la cuenta de clics descartados de los días anteriores a ese corte.
 */
export async function purgeOldInterest(db: Db, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - INTEREST_RETENTION_DAYS * DAY_MS);
  await db.delete(interestEvents).where(lt(interestEvents.createdAt, cutoff));
  await db.delete(interestDrops).where(lt(interestDrops.day, todayInArgentina(cutoff)));
}

// Por base de datos y no global: así cada base de los tests lleva su propia cuenta y, en el
// servidor, que usa una sola, es una vez por hora por proceso.
const lastPurgeAt = new WeakMap<Db, number>();

/**
 * Limpia si pasó una hora desde la última vez (y nunca hacia atrás en el
 * tiempo). Devuelve si limpió. Un fallo se registra (solo el tipo de error) y
 * no se propaga: guardar el clic no depende de la limpieza.
 */
export async function purgeInterestIfDue(db: Db, now: Date): Promise<boolean> {
  const last = lastPurgeAt.get(db);
  if (last !== undefined && now.getTime() - last < PURGE_EVERY_MS) return false;
  lastPurgeAt.set(db, now.getTime());
  try {
    await purgeOldInterest(db, now);
  } catch (error) {
    console.error("[interest] no se pudieron borrar los clics vencidos:", error instanceof Error ? error.name : "error");
  }
  return true;
}
