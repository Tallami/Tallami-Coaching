// Listas cerradas del panel de admin: qué se vende, en qué moneda, cómo se
// cobró y en qué estado está cada venta. Las usan la base (restricciones
// `check` de `src/db/schema.ts`), la validación de formularios y las etiquetas
// en español. Los precios sugeridos salen de `src/content/services.ts`, la
// misma fuente que el sitio público.

import { LESSON_PACK, PRO_SEASON, SERVICES } from "@/content/services";

export const SALE_ITEMS = [
  "vodRecorded",
  "vodLive",
  "lesson",
  "lessonPack",
  "gamePlan",
  "tournament",
  "proSeason",
  "other",
] as const;
export type SaleItem = (typeof SALE_ITEMS)[number];

export const CURRENCIES = ["USD", "ARS", "BRL", "USDT"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** USD y USDT valen un dólar: su monto en dólares es el mismo número. */
export function isDollarCurrency(currency: Currency): boolean {
  return currency === "USD" || currency === "USDT";
}

/**
 * La moneda cobrada necesita su propia cotización además de la del dólar
 * (hoy, solo el real). El dólar y el peso se resuelven con la del dólar.
 */
export function needsOwnRate(currency: Currency): boolean {
  return currency === "BRL";
}

export const PAYMENT_METHODS = [
  "mercadopago",
  "pix",
  "paypal",
  "crypto",
  "transfer",
  "cash",
  "other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SALE_STATUSES = [
  "pending",
  "paid",
  "delivered",
  "cancelled",
  "refunded",
] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

/** Estados que cuentan como ingreso (por fecha de cobro). */
export const INCOME_STATUSES = ["paid", "delivered"] as const;

export const INVOICE_STATUSES = ["pending", "issued", "not_required"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_TYPES = ["C", "E"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

/** De dónde salió el tipo de cambio guardado en la venta. */
export const RATE_SOURCES = ["bcra", "manual", "fixed"] as const;
export type RateSource = (typeof RATE_SOURCES)[number];

export const CURRENCY_LABELS: Record<Currency, string> = {
  USD: "USD (dólar)",
  ARS: "ARS (peso)",
  BRL: "BRL (real)",
  USDT: "USDT (dólar cripto)",
};

export const RATE_SOURCE_LABELS: Record<RateSource, string> = {
  bcra: "BCRA (oficial)",
  manual: "cargado a mano",
  fixed: "valor fijo de prueba",
};

export const ITEM_LABELS: Record<SaleItem, string> = {
  vodRecorded: "VOD review grabado",
  vodLive: "VOD review en vivo",
  lesson: "Clase 1 a 1",
  lessonPack: "Pack de 4 clases",
  gamePlan: "Plan de juego personalizado",
  tournament: "Coaching de torneo",
  proSeason: "Temporada Pro",
  other: "Otro",
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  mercadopago: "Mercado Pago",
  pix: "Pix",
  paypal: "PayPal",
  crypto: "Cripto",
  transfer: "Transferencia",
  cash: "Efectivo",
  other: "Otro",
};

export const STATUS_LABELS: Record<SaleStatus, string> = {
  pending: "Pendiente",
  paid: "Cobrada",
  delivered: "Entregada",
  cancelled: "Cancelada",
  refunded: "Reembolsada",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  pending: "Sin facturar",
  issued: "Facturada",
  not_required: "No requiere",
};

/**
 * Precio sugerido en USD enteros al elegir el ítem en el formulario de venta,
 * o `null` si no hay precio de lista ("Otro"). Es solo una sugerencia: el monto
 * se puede editar.
 */
export function suggestedPriceUsd(item: SaleItem): number | null {
  switch (item) {
    case "lessonPack":
      return LESSON_PACK.priceUsd;
    case "proSeason":
      return PRO_SEASON.priceUsd;
    case "other":
      return null;
    default:
      return SERVICES.find((service) => service.id === item)?.priceUsd ?? null;
  }
}
