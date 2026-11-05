// Un pedido de la web y el pago que lo paga, para los tests de pagos. El pedido es el VOD
// de 3 partidas a 1500 pesos por dólar: USD 30 y ARS 45.000. Se armó a las 23:45 del 1 de
// noviembre en Argentina, cuando en UTC ya era el 2.

import type { Db } from "@/db/client";
import { orders } from "@/db/schema";
import { ORDER_TTL_MS } from "@/payments/policy";
import type { ProviderPayment } from "@/payments/provider";

export const ORDER_CREATED_AT = new Date("2026-11-01T23:45:00.000-03:00");
/** 23:30 del 2 de noviembre en Argentina: en UTC ya es el 3. */
export const PAYMENT_APPROVED_AT = new Date("2026-11-02T23:30:00.000-03:00");
export const PAYMENT_ID = "123456789";
export const ORDER_ARS_MINOR = 4_500_000;

export type TestOrder = typeof orders.$inferSelect;

/** Un pedido sin pagar, con la copia de los datos del comprador; sin cambios, sin cuenta. */
export async function insertTestOrder(
  db: Db,
  overrides: Partial<typeof orders.$inferInsert> = {},
): Promise<TestOrder> {
  const [row] = await db
    .insert(orders)
    .values({
      provider: "mercadopago",
      buyerName: "Ana Compradora",
      buyerEmail: "ana@example.com",
      buyerHandle: "ana_fn",
      item: "vodRecorded",
      amountUsdMinor: 3000,
      arsPerUsd: "1500.0000",
      amountArsMinor: ORDER_ARS_MINOR,
      adultConfirmedAt: ORDER_CREATED_AT,
      locale: "es",
      createdAt: ORDER_CREATED_AT,
      expiresAt: new Date(ORDER_CREATED_AT.getTime() + ORDER_TTL_MS),
      ...overrides,
    })
    .returning();
  return row;
}

/** El pago aprobado de un pedido, por el monto justo; `overrides` cambia lo que cada test prueba. */
export function testPayment(orderId: string | null, overrides: Partial<ProviderPayment> = {}): ProviderPayment {
  return {
    providerPaymentId: PAYMENT_ID,
    orderId,
    status: "approved",
    amountMinor: ORDER_ARS_MINOR,
    currency: "ARS",
    approvedAt: PAYMENT_APPROVED_AT,
    ...overrides,
  };
}
