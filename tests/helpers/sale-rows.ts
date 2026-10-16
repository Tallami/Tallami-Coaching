// Una venta tal como la lista el panel (`SaleRow`), para los tests de pantallas
// y de agrupación que no necesitan la base. Cada test cambia solo lo que prueba.

import type { SaleRow } from "@/admin/sales/repository";

let sequence = 0;

/** Una venta cobrada el 5/10/2026 de 40 dólares (a 1.500 pesos por dólar), sin facturar. */
export function saleRow(overrides: Partial<SaleRow> = {}): SaleRow {
  sequence += 1;
  const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  return {
    id,
    customerId: `11111111-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    customerName: `Alumno ${sequence}`,
    customerDiscord: null,
    customerCountry: "AR",
    item: "lesson",
    description: null,
    currency: "USD",
    amountMinor: 4000,
    arsPerUnit: "1500.0000",
    arsPerUsd: "1500.0000",
    rateSource: "fixed",
    rateQuotedOn: "2026-10-05",
    amountArsMinor: 6_000_000,
    amountUsdMinor: 4000,
    paymentMethod: "transfer",
    status: "paid",
    paidOn: "2026-10-05",
    dueAt: null,
    deliveredAt: null,
    invoiceStatus: "pending",
    invoiceType: null,
    invoiceNumber: null,
    invoicedOn: null,
    source: "manual",
    notes: null,
    createdAt: new Date("2026-10-05T15:00:00Z"),
    updatedAt: new Date("2026-10-05T15:00:00Z"),
    ...overrides,
  };
}
