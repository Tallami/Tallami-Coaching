// Las reglas de los pagos en la web, en un solo lugar: los proveedores, los estados
// de un pedido, los plazos y los límites. El resto del código (esquema, cliente de
// Mercado Pago, compra, entrega, limpieza) los lee de acá. No importa nada: el
// esquema de la base (`src/db/schema.ts`) importa este módulo, así que un import
// de más acá abriría un ciclo.

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Con quién se puede pagar en la web. */
export const PAYMENT_PROVIDERS = ["mercadopago"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

/** Cómo va un pedido. `created`: armado y sin pago a la vista; `pending`: pago en curso. */
export const ORDER_STATUSES = [
  "created",
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "refunded",
  "charged_back",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Cómo va la aplicación a la Temporada Pro. */
export const PRO_APPLICATION_STATUSES = ["new", "talking", "accepted", "rejected"] as const;
export type ProApplicationStatus = (typeof PRO_APPLICATION_STATUSES)[number];

/** Qué pide quien escribe desde el formulario del sitio. */
export const SITE_REQUEST_KINDS = ["withdrawal", "cancellation", "contact"] as const;
export type SiteRequestKind = (typeof SITE_REQUEST_KINDS)[number];

export const SITE_REQUEST_STATUSES = ["new", "handled"] as const;
export type SiteRequestStatus = (typeof SITE_REQUEST_STATUSES)[number];

/** El pago vence a la hora de armarse el pedido. */
export const ORDER_TTL_MS = HOUR_MS;

/** Horas de entrega de un VOD review, contadas desde que llegan los códigos de replay. */
export const REPLAY_DELIVERY_HOURS = { vodRecorded: 72, tournamentReview: 96 } as const;

/** Una compra sin usar vence a los 150 días de la fecha de cobro. */
export const PURCHASE_EXPIRY_DAYS = 150;

/** Los códigos de replay que manda el alumno: hasta 4000 caracteres. */
export const REPLAY_CODES_MAX_LENGTH = 4000;

/** El link de pago de la Temporada Pro vence a los 14 días (un solo uso). */
export const PRO_LINK_TTL_MS = 14 * DAY_MS;

/** Los pedidos que nunca se pagaron se borran a los 90 días. */
export const UNPAID_ORDER_RETENTION_DAYS = 90;

/** Aplicaciones y pedidos del sitio se borran a los 24 meses. */
export const PUBLIC_RECORD_RETENTION_MONTHS = 24;

/** Lo que dice el resumen de la tarjeta. */
export const STATEMENT_DESCRIPTOR = "TALLAMI";
