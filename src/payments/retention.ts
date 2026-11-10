// La limpieza de lo que ya no hace falta guardar, con los plazos de `policy.ts`. Se llama de pasada
// (al ingresar al portal) y nunca toca una compra pagada: los pedidos aprobados, reembolsados o con
// contracargo quedan, porque respaldan una venta.

import { and, inArray, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { orders, proApplications, siteRequests } from "@/db/schema";
import { PUBLIC_RECORD_RETENTION_MONTHS, UNPAID_ORDER_RETENTION_DAYS, type OrderStatus } from "./policy";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Los pedidos que nunca cobraron, `pending` incluido: guardan un nombre y un email y no respaldan ninguna venta. */
const UNPAID_STATUSES: OrderStatus[] = ["created", "pending", "rejected", "cancelled"];

function monthsBefore(now: Date, months: number): Date {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
}

/**
 * Borra los pedidos sin pagar de más de 90 días, y las aplicaciones y pedidos del sitio de más de
 * 24 meses. Los links de pago se van con su aplicación (cascada); las ventas quedan.
 */
export async function purgeExpiredRecords(db: Db, now: Date = new Date()): Promise<void> {
  const unpaidCutoff = new Date(now.getTime() - UNPAID_ORDER_RETENTION_DAYS * DAY_MS);
  const publicCutoff = monthsBefore(now, PUBLIC_RECORD_RETENTION_MONTHS);
  await db.delete(orders).where(and(inArray(orders.status, UNPAID_STATUSES), lt(orders.createdAt, unpaidCutoff)));
  await db.delete(proApplications).where(lt(proApplications.createdAt, publicCutoff));
  await db.delete(siteRequests).where(lt(siteRequests.createdAt, publicCutoff));
}
