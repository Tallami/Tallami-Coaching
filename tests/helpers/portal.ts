// Filas mínimas del portal del alumno para los tests: un alumno del panel, una
// cuenta del portal y una venta. Cada helper devuelve el id de lo que creó.

import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import { customers, portalAccounts, sales } from "@/db/schema";

/** Un alumno del panel (`customers`). */
export async function insertTestCustomer(db: Db, name: string = "Alumno de prueba"): Promise<string> {
  const [row] = await db.insert(customers).values({ name }).returning({ id: customers.id });
  return row.id;
}

/** Una cuenta del portal; sin cambios, con una identidad de Discord que no se repite. */
export async function insertTestAccount(
  db: Db,
  overrides: Partial<typeof portalAccounts.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(portalAccounts)
    .values({
      provider: "discord",
      providerUserId: randomUUID(),
      displayName: "Cuenta de prueba",
      ...overrides,
    })
    .returning({ id: portalAccounts.id });
  return row.id;
}

/** Una venta pagada de `customerId`. */
export async function insertTestSale(db: Db, customerId: string): Promise<string> {
  const [row] = await db
    .insert(sales)
    .values({
      customerId,
      item: "lesson",
      currency: "USD",
      amountMinor: 4000,
      arsPerUnit: "1500.0000",
      arsPerUsd: "1500.0000",
      rateSource: "manual",
      amountArsMinor: 6_000_000,
      amountUsdMinor: 4000,
      paymentMethod: "transfer",
      status: "paid",
      paidOn: "2026-10-12",
    })
    .returning({ id: sales.id });
  return row.id;
}
