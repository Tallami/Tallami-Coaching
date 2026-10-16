// Ventas de prueba cargadas por el mismo camino que usa el panel (validación
// del formulario + `createSale`), para los tests que necesitan filas reales.

import type { SaleRates } from "@/admin/sales/rates";
import { createSale } from "@/admin/sales/repository";
import { saleInputSchema } from "@/admin/sales/schema";
import type { Db } from "@/db/client";

export const RATES_1500: SaleRates = {
  arsPerUnit: "1500.0000",
  arsPerUsd: "1500.0000",
  source: "fixed",
  quotedOn: "2026-10-12",
};

let sequence = 0;

/**
 * Carga una venta de 40 dólares cobrada el 12/10/2026 a un alumno nuevo con
 * nombre único; `overrides` cambia lo que cada test prueba (con los nombres de
 * campo del formulario). Devuelve el id de la venta.
 */
export async function seedSale(
  db: Db,
  overrides: Record<string, unknown> = {},
  rates: SaleRates = RATES_1500,
): Promise<string> {
  sequence += 1;
  const input = saleInputSchema.parse({
    customer: { mode: "new", name: `Alumno de prueba ${sequence}` },
    item: "lesson",
    currency: "USD",
    amount: "40",
    paymentMethod: "transfer",
    status: "paid",
    paidOn: "2026-10-12",
    rateMode: "auto",
    ...overrides,
  });
  const { id } = await createSale(db, input, rates);
  return id;
}
