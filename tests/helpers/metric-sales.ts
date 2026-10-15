// Datos de prueba de las métricas del panel: la hora fija de "ahora" y una
// fábrica de ventas con los campos que usan las cuentas.

import type { MetricSale } from "@/admin/metrics/metric-sale";

// "Ahora" de los tests de métricas: martes 13/10/2026, 15:00 en Argentina (UTC-3).
export const NOW = new Date("2026-10-13T18:00:00.000Z");
export const ARS_PER_USD = 1500;
/** Octubre entero: un rango cualquiera para los desgloses, que reciben el rango que se les pase. */
export const THIS_MONTH = { from: "2026-10-01", to: "2026-10-31" };

export type SaleOverrides = Partial<MetricSale> & { dollars?: number };

let sequence = 0;

/** "ana" → "Ana": el nombre que lleva una venta cuando el test no fija otro. */
function nameOf(customerId: string): string {
  return customerId.charAt(0).toUpperCase() + customerId.slice(1);
}

/**
 * Una venta cobrada de 40 dólares el 5/10/2026, ya facturada; cada test cambia
 * solo lo que prueba. `dollars` fija los dos montos (a 1.500 pesos por dólar).
 */
export function sale({ dollars = 40, ...overrides }: SaleOverrides = {}): MetricSale {
  sequence += 1;
  const customerId = overrides.customerId ?? "ana";
  return {
    id: `sale-${String(sequence).padStart(3, "0")}`,
    customerId,
    customerName: nameOf(customerId),
    item: "lesson",
    status: "paid",
    paidOn: "2026-10-05",
    dueAt: null,
    deliveredAt: null,
    amountUsdMinor: dollars * 100,
    amountArsMinor: dollars * 100 * ARS_PER_USD,
    paymentMethod: "transfer",
    country: "AR",
    invoiceStatus: "issued",
    ...overrides,
  };
}

export function ids(sales: readonly { id: string }[]): string[] {
  return sales.map((entry) => entry.id);
}
