// Validación de una venta cargada a mano (zod). La entrada es la del
// formulario: todo texto. La salida es la venta lista para guardar, con el
// monto en unidades menores, las fechas con hora como instantes y los tipos
// de cambio con 4 decimales. Los mensajes están en español, listos para
// mostrar debajo de cada campo.
//
// Los campos se validan sin `transform`: un `transform` que falla corta la
// validación y los chequeos entre campos (por ejemplo "Otro" sin descripción)
// no correrían, así que el usuario vería un error por vez. La conversión va al
// final, cuando ya se sabe que todo es válido.

import { z } from "zod";
import {
  CURRENCIES,
  PAYMENT_METHODS,
  SALE_ITEMS,
  SALE_STATUSES,
  needsOwnRate,
  type Currency,
  type PaymentMethod,
  type SaleItem,
  type SaleStatus,
} from "@/admin/catalog";
import {
  MAX_DISCORD_LENGTH,
  MAX_NAME_LENGTH,
} from "@/admin/customers/limits";
import { argentinaLocalToDate, isPlausibleDay } from "@/admin/dates";
import { MAX_DESCRIPTION_LENGTH, MAX_SALE_NOTES_LENGTH } from "@/admin/sales/limits";
import { cleanText, optionalText, requiredText } from "@/admin/zod-text";
import {
  InvalidAmountError,
  InvalidRateError,
  parseAmountToMinor,
  parseRateInput,
} from "@/lib/money";

export const RATE_MODES = ["auto", "manual"] as const;
export type RateMode = (typeof RATE_MODES)[number];

/**
 * Monto máximo de una venta: 100.000.000 en unidades enteras. Con un tipo de
 * cambio de hasta 100.000 pesos por unidad, el monto convertido a centavos de
 * peso sigue siendo un entero seguro de JavaScript.
 */
export const MAX_AMOUNT_MINOR = 10_000_000_000;
const MAX_AMOUNT_MESSAGE = "El monto es demasiado grande (máximo 100.000.000).";

/** Estados en los que la venta ya se cobró: la base exige su fecha de cobro. */
const STATUSES_WITH_PAYMENT = new Set<SaleStatus>(["paid", "delivered", "refunded"]);

const COUNTRY_CODE = /^[A-Z]{2}$/;

const MESSAGES = {
  student: "Elegí un alumno de la lista.",
  name: "Escribí el nombre del alumno.",
  nameTooLong: `El nombre es demasiado largo (máximo ${MAX_NAME_LENGTH} caracteres).`,
  discordTooLong: `El Discord es demasiado largo (máximo ${MAX_DISCORD_LENGTH} caracteres).`,
  country: "El país va con 2 letras, como AR, BR o MX.",
  item: "Elegí qué se vendió.",
  description: "Contanos qué se vendió: la descripción es obligatoria para «Otro».",
  descriptionTooLong: `La descripción es demasiado larga (máximo ${MAX_DESCRIPTION_LENGTH} caracteres).`,
  currency: "Elegí la moneda.",
  amount: "Ingresá un monto.",
  paymentMethod: "Elegí el medio de pago.",
  status: "Elegí el estado de la venta.",
  paidOnRequired: "Cargá la fecha de cobro.",
  date: "La fecha no es válida.",
  dateTime: "La fecha y hora no son válidas.",
  rateMode: "Elegí cómo cargar el tipo de cambio.",
  arsPerUsd: "Cargá los pesos por dólar.",
  arsPerUnit: "Cargá los pesos por real.",
  notesTooLong: `Las notas son demasiado largas (máximo ${MAX_SALE_NOTES_LENGTH} caracteres).`,
} as const;

const customerSchema = z.discriminatedUnion(
  "mode",
  [
    z.object({
      mode: z.literal("existing"),
      id: z.uuid({ error: MESSAGES.student }),
    }),
    z.object({
      mode: z.literal("new"),
      name: requiredText(MESSAGES.name, MAX_NAME_LENGTH, MESSAGES.nameTooLong),
      discord: optionalText(MAX_DISCORD_LENGTH, MESSAGES.discordTooLong),
      country: cleanText()
        .toUpperCase()
        .refine((value) => value === "" || COUNTRY_CODE.test(value), { error: MESSAGES.country })
        .optional(),
    }),
  ],
  { error: MESSAGES.student },
);

/** Día de cobro opcional: vacío o un día real entre 2000 y 2100. */
const optionalDay = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || isPlausibleDay(value),
    { error: MESSAGES.date },
  )
  .optional();

/** Fecha con hora opcional (`datetime-local`, hora de Argentina), con el mismo rango de años que el día. */
const optionalDateTime = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === "" || (argentinaLocalToDate(value) !== null && isPlausibleDay(value.slice(0, 10))),
    { error: MESSAGES.dateTime },
  )
  .optional();

/** El monto escrito debe ser válido y entrar en el tope. */
const amountField = z.string({ error: MESSAGES.amount }).superRefine((text, ctx) => {
  try {
    if (parseAmountToMinor(text) > MAX_AMOUNT_MINOR) {
      ctx.addIssue({ code: "custom", message: MAX_AMOUNT_MESSAGE });
    }
  } catch (error) {
    if (!(error instanceof InvalidAmountError)) throw error;
    ctx.addIssue({ code: "custom", message: error.message });
  }
});

const fieldsSchema = z.object({
  customer: customerSchema,
  item: z.enum(SALE_ITEMS, { error: MESSAGES.item }),
  description: optionalText(MAX_DESCRIPTION_LENGTH, MESSAGES.descriptionTooLong),
  currency: z.enum(CURRENCIES, { error: MESSAGES.currency }),
  amount: amountField,
  paymentMethod: z.enum(PAYMENT_METHODS, { error: MESSAGES.paymentMethod }),
  status: z.enum(SALE_STATUSES, { error: MESSAGES.status }),
  paidOn: optionalDay,
  dueAt: optionalDateTime,
  deliveredAt: optionalDateTime,
  rateMode: z.enum(RATE_MODES, { error: MESSAGES.rateMode }).default("auto"),
  arsPerUnit: z.string().trim().optional(),
  arsPerUsd: z.string().trim().optional(),
  notes: optionalText(MAX_SALE_NOTES_LENGTH, MESSAGES.notesTooLong),
});

type RawSale = z.output<typeof fieldsSchema>;

/** El alumno de la venta: uno que ya existe o uno nuevo. */
export type SaleCustomerInput =
  | { mode: "existing"; id: string }
  | { mode: "new"; name: string; discord?: string; country?: string };

/** Una venta válida, lista para guardar. */
export interface SaleInput {
  customer: SaleCustomerInput;
  item: SaleItem;
  /** Obligatoria para «Otro». */
  description?: string;
  currency: Currency;
  /** Monto en la moneda cobrada, en unidades menores (centavos). */
  amountMinor: number;
  paymentMethod: PaymentMethod;
  status: SaleStatus;
  /** Día de cobro (Argentina), "AAAA-MM-DD". */
  paidOn?: string;
  /** Entrega comprometida o sesión. */
  dueAt?: Date;
  deliveredAt?: Date;
  rateMode: RateMode;
  /** Solo en modo manual: pesos por unidad de la moneda (solo reales), con 4 decimales. */
  arsPerUnit?: string;
  /** Solo en modo manual: pesos por dólar, con 4 decimales. */
  arsPerUsd?: string;
  notes?: string;
}

/** El problema de un tipo de cambio escrito a mano, o `undefined` si está bien. */
function manualRateProblem(text: string | undefined, missing: string): string | undefined {
  if (!text) return missing;
  try {
    parseRateInput(text);
    return undefined;
  } catch (error) {
    if (error instanceof InvalidRateError) return error.message;
    throw error;
  }
}

/** Los campos donde pueden caer las reglas que cruzan campos. */
const CROSS_FIELD_PATHS = ["description", "paidOn", "arsPerUsd", "arsPerUnit"] as const;
type CrossFieldPath = (typeof CROSS_FIELD_PATHS)[number];

/** El problema de `field` que sale de mirar varios campos juntos, o `undefined`. */
function crossFieldProblem(value: RawSale, field: CrossFieldPath): string | undefined {
  switch (field) {
    case "description":
      return value.item === "other" && !value.description ? MESSAGES.description : undefined;
    case "paidOn":
      return STATUSES_WITH_PAYMENT.has(value.status) && !value.paidOn
        ? MESSAGES.paidOnRequired
        : undefined;
    case "arsPerUsd":
      return value.rateMode === "manual"
        ? manualRateProblem(value.arsPerUsd, MESSAGES.arsPerUsd)
        : undefined;
    case "arsPerUnit":
      return value.rateMode === "manual" && needsOwnRate(value.currency)
        ? manualRateProblem(value.arsPerUnit, MESSAGES.arsPerUnit)
        : undefined;
  }
}

/**
 * Agrega las reglas que cruzan campos, una por campo afectado. Corren aunque
 * otro campo ya tenga un error (por eso `when`): así se ven todos los
 * problemas juntos y no uno por vez.
 */
function withCrossFieldRules(schema: typeof fieldsSchema): typeof fieldsSchema {
  return CROSS_FIELD_PATHS.reduce(
    (current, field) =>
      current.refine((value) => crossFieldProblem(value, field) === undefined, {
        path: [field],
        when: () => true,
        error: (issue) => crossFieldProblem(issue.input as RawSale, field),
      }),
    schema,
  );
}

function buildCustomer(customer: RawSale["customer"]): SaleCustomerInput {
  if (customer.mode === "existing") return { mode: "existing", id: customer.id };
  return {
    mode: "new",
    name: customer.name,
    ...(customer.discord ? { discord: customer.discord } : {}),
    ...(customer.country ? { country: customer.country } : {}),
  };
}

/** Pasa la venta ya validada a su forma final (monto en centavos, fechas como instantes). */
function buildSaleInput(value: RawSale): SaleInput {
  const isManual = value.rateMode === "manual";
  return {
    customer: buildCustomer(value.customer),
    item: value.item,
    ...(value.description ? { description: value.description } : {}),
    currency: value.currency,
    amountMinor: parseAmountToMinor(value.amount),
    paymentMethod: value.paymentMethod,
    status: value.status,
    ...(value.paidOn ? { paidOn: value.paidOn } : {}),
    ...(value.dueAt ? { dueAt: argentinaLocalToDate(value.dueAt) ?? undefined } : {}),
    ...(value.deliveredAt
      ? { deliveredAt: argentinaLocalToDate(value.deliveredAt) ?? undefined }
      : {}),
    rateMode: value.rateMode,
    ...(isManual && value.arsPerUsd ? { arsPerUsd: parseRateInput(value.arsPerUsd) } : {}),
    ...(isManual && needsOwnRate(value.currency) && value.arsPerUnit
      ? { arsPerUnit: parseRateInput(value.arsPerUnit) }
      : {}),
    ...(value.notes ? { notes: value.notes } : {}),
  };
}

/**
 * Una venta cargada a mano: alumno existente o nuevo, qué se vendió, monto
 * (texto), cómo y cuándo se cobró y cómo se resuelve el tipo de cambio.
 */
export const saleInputSchema = withCrossFieldRules(fieldsSchema).transform(buildSaleInput);

/** Nombre de campo del formulario para cada problema de `customer`. */
const CUSTOMER_FIELD: Record<string, string> = {
  id: "customerId",
  name: "customerName",
  discord: "customerDiscord",
  country: "customerCountry",
};

/**
 * El primer mensaje de cada campo, con los nombres de campo del formulario
 * (`customerName`, `amount`, `paidOn`, …).
 */
export function saleFieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const [head, child] = issue.path;
    const field =
      head === "customer" ? (CUSTOMER_FIELD[String(child)] ?? "customer") : String(head ?? "form");
    errors[field] ??= issue.message;
  }
  return errors;
}
