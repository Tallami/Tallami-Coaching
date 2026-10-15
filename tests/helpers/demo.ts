// Los datos de ejemplo del panel tal como los leen las métricas. Los usan el
// test unitario del generador y los e2e del resumen: calculan lo esperado con
// las mismas funciones puras que usa la página, sobre `buildDemoData`.

import { buildDemoData, type DemoData } from "@/admin/demo-data";
import type { MetricSale } from "@/admin/metrics/metric-sale";
import { todayInArgentina } from "@/admin/metrics/period";
import type { InvoiceStatus, PaymentMethod, SaleItem, SaleStatus } from "@/admin/catalog";

/** Las ventas de ejemplo como `MetricSale` (con el nombre y el país de cada alumno). */
export function demoMetricSales(data: DemoData): MetricSale[] {
  const customers = new Map(data.customers.map((customer) => [customer.id, customer]));
  return data.sales.map((sale) => {
    const customer = customers.get(sale.customerId);
    if (!customer) throw new Error(`La venta ${sale.id} apunta a un alumno que no existe.`);
    return {
      id: sale.id,
      customerId: sale.customerId,
      customerName: customer.name,
      item: sale.item as SaleItem,
      status: sale.status as SaleStatus,
      paidOn: sale.paidOn ?? null,
      dueAt: sale.dueAt?.toISOString() ?? null,
      deliveredAt: sale.deliveredAt?.toISOString() ?? null,
      amountArsMinor: sale.amountArsMinor,
      amountUsdMinor: sale.amountUsdMinor,
      paymentMethod: sale.paymentMethod as PaymentMethod,
      country: customer.country?.trim() || null,
      invoiceStatus: (sale.invoiceStatus ?? "pending") as InvoiceStatus,
    };
  });
}

/** Los datos de ejemplo de hoy (en Argentina) y su momento de referencia. */
export function demoToday(now: Date = new Date()): { today: string; data: DemoData; sales: MetricSale[] } {
  const today = todayInArgentina(now);
  const data = buildDemoData(today);
  return { today, data, sales: demoMetricSales(data) };
}
