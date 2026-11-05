// La tabla de pedidos, para quien compra: armar uno, leer el de una cuenta y cancelarlo. Lo que un
// pago le hace a un pedido lo decide `apply.ts`.

import { and, eq, gt, or } from "drizzle-orm";
import type { Db } from "@/db/client";
import { orders } from "@/db/schema";
import { isUuid } from "@/db/uuid";

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
 * ¿La cuenta está a mitad de una compra? Un pago en curso, o un pedido armado que todavía puede
 * pagarse: pasada la hora, ese pago ya no puede hacerse y deja de contar.
 */
export async function hasUnconfirmedOrder(db: Db, accountId: string, now: Date = new Date()): Promise<boolean> {
  const [order] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.accountId, accountId),
        or(eq(orders.status, "pending"), and(eq(orders.status, "created"), gt(orders.expiresAt, now))),
      ),
    )
    .limit(1);
  return order !== undefined;
}
