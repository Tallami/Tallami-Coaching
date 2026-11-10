// Los códigos de replay de un VOD review (3 partidas o torneo completo): los manda el alumno desde el
// portal después de pagar, y desde que llegan corre el plazo de entrega (72 o 96 horas). El primer
// envío fija la hora y la fecha de entrega; corregir los códigos antes de que Tallami cargue una
// entrega cambia solo el texto. Una compra sin usar vence a los 150 días del cobro.

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { argentinaLocalToDate } from "@/admin/dates";
import type { Db } from "@/db/client";
import { deliveries, sales } from "@/db/schema";
import { isUuid } from "@/db/uuid";
import { PURCHASE_EXPIRY_DAYS, REPLAY_CODES_MAX_LENGTH, REPLAY_DELIVERY_HOURS } from "./policy";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

type ReplayItem = keyof typeof REPLAY_DELIVERY_HOURS;

/** Lo que el alumno ve de los códigos de una compra. */
export type StudentReplayCodes =
  | { state: "none" }
  | { state: "open" }
  | { state: "sent"; codes: string; dueAt: string; editable: boolean }
  | { state: "expired" };

export type SubmitReplayCodesResult = "saved" | "corrected" | "not-found" | "closed" | "invalid";

/** De la venta, lo único que hace falta para saber cómo van los códigos. */
export type ReplaySale = Pick<
  typeof sales.$inferSelect,
  "item" | "status" | "paidOn" | "dueAt" | "replayCodes" | "replayCodesSentAt"
>;

function isReplayItem(item: string): item is ReplayItem {
  return Object.hasOwn(REPLAY_DELIVERY_HOURS, item);
}

/** Desde cuándo no se aceptan códigos: 150 días después de que empezó el día de cobro (hora de Argentina). */
function expiresAtMs(paidOn: string | null): number | null {
  if (paidOn === null) return null;
  const start = argentinaLocalToDate(`${paidOn}T00:00`);
  return start ? start.getTime() + PURCHASE_EXPIRY_DAYS * DAY_MS : null;
}

function hasExpired(sale: Pick<ReplaySale, "paidOn">, now: Date): boolean {
  const limit = expiresAtMs(sale.paidOn);
  return limit !== null && now.getTime() >= limit;
}

/** Cuándo vence la entrega, contada desde que llegaron los códigos. */
function deliveryDueAt(item: ReplayItem, sentAt: Date): Date {
  return new Date(sentAt.getTime() + REPLAY_DELIVERY_HOURS[item] * HOUR_MS);
}

/** Una venta cancelada o reembolsada no muestra ni pide códigos. */
const CLOSED_SALE_STATUSES: ReadonlySet<string> = new Set(["cancelled", "refunded"]);

/**
 * Una fecha de entrega sin códigos la puso Tallami (una venta cargada a mano): ya tiene lo que necesita,
 * y los códigos del alumno no la pueden pisar.
 */
function hasManualDueAt(sale: Pick<ReplaySale, "dueAt" | "replayCodesSentAt">): boolean {
  return sale.dueAt !== null && sale.replayCodesSentAt === null;
}

/** El estado de los códigos de una compra para el alumno. `deliveryCount`: las entregas que ya tiene. */
export function replayState(sale: ReplaySale, deliveryCount: number, now: Date): StudentReplayCodes {
  if (!isReplayItem(sale.item) || CLOSED_SALE_STATUSES.has(sale.status)) return { state: "none" };
  if (sale.replayCodes !== null && sale.replayCodesSentAt !== null) {
    const dueAt = sale.dueAt ?? deliveryDueAt(sale.item, sale.replayCodesSentAt);
    return {
      state: "sent",
      codes: sale.replayCodes,
      dueAt: dueAt.toISOString(),
      editable: sale.status === "paid" && deliveryCount === 0,
    };
  }
  if (sale.status !== "paid" || deliveryCount > 0 || hasManualDueAt(sale)) return { state: "none" };
  return hasExpired(sale, now) ? { state: "expired" } : { state: "open" };
}

const noDeliveries = sql`not exists (select 1 from ${deliveries} where ${deliveries.saleId} = ${sales.id})`;

/**
 * Recibe los códigos de `customerId` para su venta `saleId`. La cuenta sale siempre de la sesión de
 * quien llama. Una venta ajena, de otro servicio o que no existe da lo mismo: `not-found`.
 *
 * El primer envío es un `update … where replay_codes_sent_at is null and due_at is null`: si dos llegan a
 * la vez, uno gana y fija la fecha de entrega; el otro cae en una corrección y no la mueve. Una venta con
 * fecha y sin códigos la cargó Tallami a mano: da `closed` y su fecha no se toca.
 */
export async function submitReplayCodes(
  db: Db,
  input: { customerId: string; saleId: string; codes: string },
  now: Date = new Date(),
): Promise<SubmitReplayCodesResult> {
  const { customerId, saleId } = input;
  if (!isUuid(customerId) || !isUuid(saleId)) return "not-found";
  const [sale] = await db
    .select({
      item: sales.item,
      status: sales.status,
      paidOn: sales.paidOn,
      dueAt: sales.dueAt,
      replayCodes: sales.replayCodes,
      replayCodesSentAt: sales.replayCodesSentAt,
    })
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.customerId, customerId)));
  if (!sale || !isReplayItem(sale.item)) return "not-found";
  if (sale.status !== "paid" || hasManualDueAt(sale)) return "closed";

  const codes = input.codes.trim();
  if (codes.length === 0 || codes.length > REPLAY_CODES_MAX_LENGTH) return "invalid";

  const target = and(eq(sales.id, saleId), eq(sales.customerId, customerId), eq(sales.status, "paid"), noDeliveries);

  if (sale.replayCodesSentAt === null) {
    if (hasExpired(sale, now)) return "closed";
    const first = await db
      .update(sales)
      .set({ replayCodes: codes, replayCodesSentAt: now, dueAt: deliveryDueAt(sale.item, now) })
      .where(and(target, isNull(sales.replayCodesSentAt), isNull(sales.dueAt)))
      .returning({ id: sales.id });
    if (first.length > 0) return "saved";
  }

  // Corregir es solo después de un primer envío: si Tallami puso una fecha mientras tanto, no se escribe nada.
  const corrected = await db
    .update(sales)
    .set({ replayCodes: codes })
    .where(and(target, isNotNull(sales.replayCodesSentAt)))
    .returning({ id: sales.id });
  return corrected.length > 0 ? "corrected" : "closed";
}
