// La tabla de pedidos, para quien compra: armar uno, leer el de una cuenta y cancelarlo. Lo que un
// pago le hace a un pedido lo decide `apply.ts`.

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { orders } from "@/db/schema";
import { isUuid } from "@/db/uuid";
import type { OrderStatus } from "./policy";

export type Order = typeof orders.$inferSelect;

export async function createOrder(db: Db, input: typeof orders.$inferInsert): Promise<Order> {
  const [order] = await db.insert(orders).values(input).returning();
  return order;
}

/**
 * El pedido, solo si es de esa cuenta. Lo de otra cuenta y lo que no existe dan lo mismo, `null`: el
 * id viene de la dirección, que la escribe cualquiera.
 */
export async function orderForAccount(db: Db, orderId: string, accountId: string): Promise<Order | null> {
  if (!isUuid(orderId)) return null;
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.accountId, accountId)));
  return order ?? null;
}

/** Cancela un pedido que todavía no tiene ningún pago a la vista. Uno con pago no se toca: lo decide el proveedor. */
export async function cancelOrder(db: Db, orderId: string): Promise<void> {
  await db
    .update(orders)
    .set({ status: "cancelled" })
    .where(and(eq(orders.id, orderId), eq(orders.status, "created")));
}

/**
 * Cómo va un pedido para quien lo hizo: `confirmed` tiene su compra; `unconfirmed` todavía puede pagarse o
 * se está pagando; `failed` no se pagó y hay que empezar de nuevo; `closed` se pagó y se devolvió.
 */
export type OrderProgress = "confirmed" | "unconfirmed" | "failed" | "closed";

/** Un `Record` para que un estado nuevo obligue a decidirlo. */
const STATUS_PROGRESS: Record<OrderStatus, OrderProgress> = {
  approved: "confirmed",
  created: "unconfirmed",
  pending: "unconfirmed",
  rejected: "failed",
  cancelled: "failed",
  refunded: "closed",
  charged_back: "closed",
};

/**
 * Lo único que decide esto: lo usan el aviso de la vuelta y la vista de la cuenta sin vincular. Nadie mueve
 * un pedido armado cuando vence, pero a esa hora Mercado Pago ya no acepta su pago: pasada la hora, falló.
 * Consultar el pago va antes de esto: uno pagado justo a tiempo sale de `created` al aplicarlo.
 */
export function orderProgress(order: Pick<Order, "status" | "expiresAt">, now: Date): OrderProgress {
  if (order.status === "created" && order.expiresAt <= now) return "failed";
  return STATUS_PROGRESS[order.status as OrderStatus];
}

/** Lo que importa de los pedidos de una cuenta sin vincular: está esperando un pago, o su último intento falló. */
export type AccountOrderState = Extract<OrderProgress, "unconfirmed" | "failed"> | null;

/**
 * Cómo van los pedidos de la cuenta. Uno que todavía puede pagarse manda, sea cual sea su fecha. Si no, habla
 * el más nuevo: una cuenta que compró y que Tallami desvinculó no está a mitad de ninguna compra, aunque
 * antes le hayan rechazado un pago.
 */
export async function accountOrderState(db: Db, accountId: string, now: Date = new Date()): Promise<AccountOrderState> {
  const rows = await db
    .select({ status: orders.status, expiresAt: orders.expiresAt })
    .from(orders)
    .where(eq(orders.accountId, accountId))
    .orderBy(desc(orders.createdAt));
  const progress = rows.map((order) => orderProgress(order, now));
  if (progress.includes("unconfirmed")) return "unconfirmed";
  return progress[0] === "failed" ? "failed" : null;
}
