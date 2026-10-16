// Tablas del panel de admin (Drizzle). Columnas en snake_case en la base.
// Las reglas de negocio que la base puede garantizar viven acá como
// restricciones `check`, así valen igual para el formulario, para los pagos
// online de más adelante y para cualquier script.
//
// Dinero: enteros en unidades menores (centavos) en `bigint`, leídos como
// `number` (los montos de este negocio entran de sobra en los 2^53 que
// representa un `number`). Los tipos de cambio son `numeric(14,4)` y se leen
// como texto decimal: la cuenta se hace con `BigInt`, nunca con decimales.

import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  CURRENCIES,
  INTEREST_ITEMS,
  INTEREST_LOCALES,
  INVOICE_STATUSES,
  INVOICE_TYPES,
  PAYMENT_METHODS,
  RATE_SOURCES,
  SALE_ITEMS,
  SALE_STATUSES,
} from "@/admin/catalog";

/**
 * `columna in ('a', 'b')` con los valores de una lista cerrada del catálogo.
 * Los valores son constantes del código (nunca texto del usuario), por eso
 * van como literales en el SQL de la restricción.
 */
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const literals = values.map((value) => `'${value}'`).join(", ");
  return sql`${column} in (${sql.raw(literals)})`;
}

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  discord: text("discord"),
  email: text("email"),
  /** ISO 3166-1 alfa-2 en mayúsculas ("AR", "BR", "MX"). */
  country: char("country", { length: 2 }),
  notes: text("notes"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Un alumno con ventas no se borra: las ventas se cancelan o reembolsan.
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    item: text("item").notNull(),
    description: text("description"),
    currency: text("currency").notNull(),
    /** Monto en la moneda cobrada, en unidades menores (centavos). */
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    /** Pesos por unidad de la moneda cobrada, al día de cobro. */
    arsPerUnit: numeric("ars_per_unit", { precision: 14, scale: 4 }).notNull(),
    arsPerUsd: numeric("ars_per_usd", { precision: 14, scale: 4 }).notNull(),
    rateSource: text("rate_source").notNull(),
    /** Fecha de la cotización usada (puede ser anterior a `paid_on`). */
    rateQuotedOn: date("rate_quoted_on"),
    amountArsMinor: bigint("amount_ars_minor", { mode: "number" }).notNull(),
    amountUsdMinor: bigint("amount_usd_minor", { mode: "number" }).notNull(),
    paymentMethod: text("payment_method").notNull(),
    status: text("status").notNull(),
    /** Fecha de cobro (día de Argentina): con ella se cuenta el ingreso. */
    paidOn: date("paid_on"),
    /** Entrega comprometida o fecha y hora de la sesión. */
    dueAt: timestamptz("due_at"),
    deliveredAt: timestamptz("delivered_at"),
    invoiceStatus: text("invoice_status").notNull().default("pending"),
    invoiceType: text("invoice_type"),
    invoiceNumber: text("invoice_number"),
    invoicedOn: date("invoiced_on"),
    /** "manual" o el proveedor de pagos que creó la venta. */
    source: text("source").notNull().default("manual"),
    notes: text("notes"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("sales_item_valid", oneOf(t.item, SALE_ITEMS)),
    check("sales_currency_valid", oneOf(t.currency, CURRENCIES)),
    check("sales_rate_source_valid", oneOf(t.rateSource, RATE_SOURCES)),
    check("sales_payment_method_valid", oneOf(t.paymentMethod, PAYMENT_METHODS)),
    check("sales_status_valid", oneOf(t.status, SALE_STATUSES)),
    check("sales_invoice_status_valid", oneOf(t.invoiceStatus, INVOICE_STATUSES)),
    check(
      "sales_invoice_type_valid",
      sql`${t.invoiceType} is null or ${oneOf(t.invoiceType, INVOICE_TYPES)}`,
    ),
    check("sales_amount_positive", sql`${t.amountMinor} > 0`),
    check(
      "sales_other_needs_description",
      sql`${t.item} <> 'other' or nullif(btrim(${t.description}), '') is not null`,
    ),
    check(
      "sales_paid_needs_paid_on",
      sql`${t.status} not in ('paid', 'delivered', 'refunded') or ${t.paidOn} is not null`,
    ),
    check(
      "sales_issued_invoice_needs_data",
      sql`${t.invoiceStatus} <> 'issued' or (
        ${t.invoiceType} is not null
        and nullif(btrim(${t.invoiceNumber}), '') is not null
        and ${t.invoicedOn} is not null
      )`,
    ),
    index("sales_paid_on_idx").on(t.paidOn),
    index("sales_customer_id_idx").on(t.customerId),
    index("sales_status_idx").on(t.status),
    index("sales_invoice_status_idx").on(t.invoiceStatus),
  ],
);

/** Configuración clave-valor (categoría y tope del monotributo, etc.). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamptz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Cotizaciones consultadas, para no repetir pedidos al BCRA. */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    currency: text("currency").notNull(),
    quotedOn: date("quoted_on").notNull(),
    arsPerUnit: numeric("ars_per_unit", { precision: 14, scale: 4 }).notNull(),
    source: text("source").notNull(),
    fetchedAt: timestamptz("fetched_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.currency, t.quotedOn] })],
);

/** Intentos de ingreso al panel; la IP se guarda solo como hash. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ipHash: text("ip_hash").notNull(),
    succeeded: boolean("succeeded").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [index("login_attempts_ip_hash_created_at_idx").on(t.ipHash, t.createdAt)],
);

/**
 * Un clic anónimo en un botón de reserva del sitio público (`/api/interest`):
 * qué servicio, en qué idioma, de qué país (encabezado de Vercel, si existe) y
 * cuándo. Sin cookies ni datos personales: la IP se guarda solo como HMAC, para
 * limitar ráfagas (30 por minuto por IP), nunca en claro.
 */
export const interestEvents = pgTable(
  "interest_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    item: text("item").notNull(),
    locale: text("locale").notNull(),
    /** ISO 3166-1 alfa-2 en mayúsculas, o `null` si el pedido no trajo uno válido. */
    country: char("country", { length: 2 }),
    ipHash: text("ip_hash").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("interest_events_item_valid", oneOf(t.item, INTEREST_ITEMS)),
    check("interest_events_locale_valid", oneOf(t.locale, INTEREST_LOCALES)),
    check("interest_events_country_valid", sql`${t.country} is null or ${t.country} ~ '^[A-Z]{2}$'`),
    index("interest_events_created_at_idx").on(t.createdAt),
    index("interest_events_ip_hash_created_at_idx").on(t.ipHash, t.createdAt),
  ],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Sale = typeof sales.$inferSelect;
export type NewSale = typeof sales.$inferInsert;
export type InterestEvent = typeof interestEvents.$inferSelect;
export type NewInterestEvent = typeof interestEvents.$inferInsert;
