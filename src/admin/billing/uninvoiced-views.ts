// Las ventas por facturar como las dibuja la lista: textos ya escritos y solo los
// montos en números que el navegador necesita para sumar lo que se elige. Es
// lo único que cruza del servidor a la lista (que es un componente de cliente),
// así no viajan al navegador las notas ni los tipos de cambio de cada venta.

import { ITEM_LABELS } from "@/admin/catalog";
import { formatDay } from "@/admin/dates";
import { monthLabels } from "@/admin/overview/labels";
import type { UninvoicedGroup } from "@/admin/billing/summary";
import { formatMoney } from "@/lib/money";

export interface UninvoicedRowView {
  id: string;
  /** Día de cobro, dd/mm/aaaa. */
  paidOn: string;
  customerName: string;
  /** Discord y país del alumno, si los tiene; ayudan a reconocerlo. */
  customerDiscord: string | null;
  customerCountry: string | null;
  item: string;
  description: string | null;
  /** Lo cobrado, en la moneda cobrada: "USD 40,00". */
  charged: string;
  /** Lo cobrado en pesos: "$ 60.000,00". */
  ars: string;
  /** Lo cobrado en dólares: "USD 40,00". */
  usd: string;
  arsMinor: number;
  usdMinor: number;
}

export interface UninvoicedGroupView {
  month: string;
  /** "octubre de 2026". */
  label: string;
  count: number;
  ars: string;
  usd: string;
  rows: UninvoicedRowView[];
}

export function toGroupViews(groups: readonly UninvoicedGroup[]): UninvoicedGroupView[] {
  return groups.map((group) => ({
    month: group.month,
    label: monthLabels(group.month).long,
    count: group.count,
    ars: formatMoney(group.arsMinor, "ARS"),
    usd: formatMoney(group.usdMinor, "USD"),
    rows: group.rows.map((sale) => ({
      id: sale.id,
      // Las ventas por facturar siempre tienen día de cobro (ver `groupUninvoicedByMonth`).
      paidOn: sale.paidOn ? formatDay(sale.paidOn) : "",
      customerName: sale.customerName,
      customerDiscord: sale.customerDiscord,
      customerCountry: sale.customerCountry,
      item: ITEM_LABELS[sale.item],
      description: sale.description,
      charged: formatMoney(sale.amountMinor, sale.currency),
      ars: formatMoney(sale.amountArsMinor, "ARS"),
      usd: formatMoney(sale.amountUsdMinor, "USD"),
      arsMinor: sale.amountArsMinor,
      usdMinor: sale.amountUsdMinor,
    })),
  }));
}
