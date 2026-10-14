// Los valores del formulario de venta: todo texto, como lo escribe la persona.
// Es lo que el formulario muestra al abrirse (vacío para una venta nueva,
// cargado para una existente) y lo que conserva cuando algo sale mal.

import type { Currency } from "@/admin/catalog";
import { dateToArgentinaLocal } from "@/admin/dates";
import type { SaleRow } from "@/admin/sales/repository";
import type { RateMode } from "@/admin/sales/schema";

export type CustomerMode = "existing" | "new";

export interface SaleFormValues {
  customerMode: CustomerMode;
  /** El alumno elegido (modo "existente"). */
  customerId: string;
  /** Cómo se ve el alumno elegido: su nombre, y el Discord si tiene. */
  customerLabel: string;
  customerName: string;
  customerDiscord: string;
  customerCountry: string;
  /** Un `SaleItem`, o vacío mientras no se eligió. */
  item: string;
  description: string;
  currency: Currency;
  amount: string;
  /** Un `PaymentMethod`, o vacío mientras no se eligió. */
  paymentMethod: string;
  /** Un `SaleStatus`. */
  status: string;
  paidOn: string;
  dueAt: string;
  deliveredAt: string;
  rateMode: RateMode;
  arsPerUnit: string;
  arsPerUsd: string;
  notes: string;
}

/**
 * Venta nueva: cobrada hoy, en dólares y con el dólar oficial. Con alumnos ya
 * cargados se arranca buscando uno; sin ninguno, cargando uno nuevo.
 */
export function emptySaleFormValues(today: string, hasCustomers: boolean): SaleFormValues {
  return {
    customerMode: hasCustomers ? "existing" : "new",
    customerId: "",
    customerLabel: "",
    customerName: "",
    customerDiscord: "",
    customerCountry: "",
    item: "",
    description: "",
    currency: "USD",
    amount: "",
    paymentMethod: "",
    status: "paid",
    paidOn: today,
    dueAt: "",
    deliveredAt: "",
    rateMode: "auto",
    arsPerUnit: "",
    arsPerUsd: "",
    notes: "",
  };
}

/** "Ana Pérez" o "Ana Pérez (ana.fn)". */
export function customerLabel(name: string, discord: string | null): string {
  return discord ? `${name} (${discord})` : name;
}

/** Monto en unidades menores → el texto que se escribiría: 12050 → "120,50"; 12000 → "120". */
function amountToText(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const cents = minor % 100;
  return cents === 0 ? String(whole) : `${whole},${String(cents).padStart(2, "0")}`;
}

/**
 * Tipo de cambio guardado ("1400.5000") → texto para el campo ("1400,5"), sin
 * ceros de sobra. Con tres decimales exactos se deja el cuarto cero ("59,8750"):
 * "59,875" se leería como miles ("ambiguo") y el formulario rechazaría un valor
 * que él mismo escribió.
 */
function rateToText(rate: string): string {
  const [whole, fraction = ""] = rate.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  if (!trimmed) return whole;
  return `${whole},${trimmed.length === 3 ? trimmed.padEnd(4, "0") : trimmed}`;
}

/** La venta guardada, como la muestra el formulario de edición. */
export function saleToFormValues(sale: SaleRow): SaleFormValues {
  const isManual = sale.rateSource === "manual";
  return {
    customerMode: "existing",
    customerId: sale.customerId,
    customerLabel: customerLabel(sale.customerName, sale.customerDiscord),
    customerName: "",
    customerDiscord: "",
    customerCountry: "",
    item: sale.item,
    description: sale.description ?? "",
    currency: sale.currency,
    amount: amountToText(sale.amountMinor),
    paymentMethod: sale.paymentMethod,
    status: sale.status,
    paidOn: sale.paidOn ?? "",
    dueAt: sale.dueAt ? dateToArgentinaLocal(sale.dueAt) : "",
    deliveredAt: sale.deliveredAt ? dateToArgentinaLocal(sale.deliveredAt) : "",
    rateMode: isManual ? "manual" : "auto",
    arsPerUnit: isManual && sale.currency === "BRL" ? rateToText(sale.arsPerUnit) : "",
    arsPerUsd: isManual ? rateToText(sale.arsPerUsd) : "",
    notes: sale.notes ?? "",
  };
}
