// Datos de ejemplo del panel: alumnos y ventas ficticios para ver el resumen
// con números. Todo se calcula a partir de un día ("hoy" en Argentina) y de un
// generador de números al azar con semilla fija: el mismo día da siempre los
// mismos datos, y las fechas quedan relativas a ese día (14 meses de historia,
// pendientes de esta semana).
//
// Solo se cargan en una base local (`npm run db:seed:demo`, que se niega si
// hay `DATABASE_URL`) y en los e2e del resumen. Los nombres son claramente
// falsos ("Alumno de prueba N") y los tipos de cambio salen marcados como
// "valor fijo de prueba".

import {
  isDollarCurrency,
  suggestedPriceUsd,
  type Currency,
  type InvoiceStatus,
  type PaymentMethod,
  type SaleItem,
  type SaleStatus,
} from "@/admin/catalog";
import { buildDemoInterest, type DemoInterestEvent } from "@/admin/demo-interest";
import { createRandom, pickWeighted, type Random } from "@/admin/demo-random";
import type { MonotributoSettings } from "@/admin/metrics/monotributo";
import { addDays, addMonths, firstOfMonth, lastOfMonth } from "@/admin/metrics/period";
import type { NewCustomer, NewSale } from "@/db/schema";
import { arsToUsdMinor, convertToArsMinor, normalizeRate } from "@/lib/money";

export type DemoCustomer = NewCustomer & { id: string };
export type DemoSale = NewSale & { id: string };

export interface DemoData {
  customers: DemoCustomer[];
  sales: DemoSale[];
  /** Clics de ejemplo en los botones de reserva del sitio (ver `demo-interest.ts`). */
  interest: DemoInterestEvent[];
}

/**
 * La categoría y el tope con que se muestra el medidor de monotributo en los
 * datos de ejemplo (el tope es de ejemplo; el verdadero lo carga Tallami).
 */
export const DEMO_MONOTRIBUTO_SETTINGS: MonotributoSettings = {
  category: "D",
  annualCapArsMinor: 2_600_000_000,
  validFrom: "2026-08-01",
};

// --- Números al azar con semilla fija --------------------------------------

const SEED = 0x5eed_c0de;

// --- Alumnos ----------------------------------------------------------------

/** País y cuántos meses atrás compró por primera vez (0 = este mes). */
const STUDENTS: readonly { country: string | null; joinedMonthsAgo: number }[] = [
  { country: "AR", joinedMonthsAgo: 13 },
  { country: "AR", joinedMonthsAgo: 13 },
  { country: "BR", joinedMonthsAgo: 12 },
  { country: "AR", joinedMonthsAgo: 12 },
  { country: "MX", joinedMonthsAgo: 11 },
  { country: "AR", joinedMonthsAgo: 10 },
  { country: "AR", joinedMonthsAgo: 10 },
  { country: "BR", joinedMonthsAgo: 9 },
  { country: "AR", joinedMonthsAgo: 8 },
  { country: "CL", joinedMonthsAgo: 8 },
  { country: "BR", joinedMonthsAgo: 7 },
  { country: "AR", joinedMonthsAgo: 7 },
  { country: "BR", joinedMonthsAgo: 6 },
  { country: "MX", joinedMonthsAgo: 5 },
  { country: "AR", joinedMonthsAgo: 5 },
  { country: "ES", joinedMonthsAgo: 4 },
  { country: "UY", joinedMonthsAgo: 4 },
  { country: "BR", joinedMonthsAgo: 3 },
  { country: "AR", joinedMonthsAgo: 3 },
  { country: "CO", joinedMonthsAgo: 2 },
  { country: null, joinedMonthsAgo: 2 },
  { country: "MX", joinedMonthsAgo: 1 },
  { country: null, joinedMonthsAgo: 1 },
  { country: "AR", joinedMonthsAgo: 0 },
  { country: "BR", joinedMonthsAgo: 0 },
];

const HISTORY_MONTHS = 14;
/** Ventas de los meses 13 a 1 atrás; el mes en curso se reparte según los días que pasaron. */
const SALES_PER_PAST_MONTH = [3, 4, 4, 5, 6, 6, 7, 7, 8, 8, 9, 10, 10] as const;
const SALES_IN_FULL_CURRENT_MONTH = 12;
const MIN_SALES_IN_CURRENT_MONTH = 2;

/**
 * Los ids de ejemplo tienen un principio fijo que ningún id al azar (uuid v4) de
 * un alumno o una venta reales puede tener: así se reconocen para reemplazarlos
 * o para borrarlos (`scripts/seed-demo.ts`), sin importar de qué día se cargaron
 * (cada día trae una cantidad distinta de ventas).
 */
export const DEMO_CUSTOMER_ID_PREFIX = "de000000-0000-4000-8000-";
export const DEMO_SALE_ID_PREFIX = "de100000-0000-4000-8000-";

function indexedId(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(12, "0")}`;
}
const customerId = (index: number) => indexedId(DEMO_CUSTOMER_ID_PREFIX, index);
const saleId = (index: number) => indexedId(DEMO_SALE_ID_PREFIX, index);

function buildCustomers(): DemoCustomer[] {
  return STUDENTS.map(({ country }, index) => ({
    id: customerId(index + 1),
    name: `Alumno de prueba ${index + 1}`,
    discord: `alumno_prueba_${index + 1}`,
    country,
    notes: "Alumno de ejemplo: no existe.",
  }));
}

// --- Cobro y tipo de cambio -------------------------------------------------

interface Payment {
  currency: Currency;
  paymentMethod: PaymentMethod;
}

function pickPayment(random: Random, country: string | null): Payment {
  if (country === "AR") {
    return pickWeighted<Payment>(random, [
      [{ currency: "ARS", paymentMethod: "mercadopago" }, 45],
      [{ currency: "ARS", paymentMethod: "transfer" }, 20],
      [{ currency: "USD", paymentMethod: "paypal" }, 20],
      [{ currency: "USDT", paymentMethod: "crypto" }, 15],
    ]);
  }
  if (country === "BR") {
    return pickWeighted<Payment>(random, [
      [{ currency: "BRL", paymentMethod: "pix" }, 85],
      [{ currency: "USD", paymentMethod: "paypal" }, 15],
    ]);
  }
  return pickWeighted<Payment>(random, [
    [{ currency: "USD", paymentMethod: "paypal" }, 55],
    [{ currency: "USDT", paymentMethod: "crypto" }, 30],
    [{ currency: "USD", paymentMethod: "transfer" }, 10],
    [{ currency: "USD", paymentMethod: "cash" }, 5],
  ]);
}

/** Pesos por dólar de ejemplo: sube de a poco, mes a mes, hasta 1.500. */
function arsPerUsdFor(monthsAgo: number): number {
  return 1500 - 8 * monthsAgo + ((monthsAgo * 37) % 100) / 100;
}
const BRL_PER_USD = 5.4;
const ARS_ROUNDING_STEP = 500;
const BRL_ROUNDING_STEP = 5;
const MAX_MONTHS_AGO_FOR_RATES = 13;

interface Priced {
  currency: Currency;
  amountMinor: number;
  arsPerUnit: string;
  arsPerUsd: string;
}

/** El monto en la moneda cobrada para un precio en dólares, con su cotización de ejemplo. */
function priceIn(payment: Payment, priceUsd: number, monthsAgo: number): Priced {
  const rateNumber = arsPerUsdFor(Math.min(monthsAgo, MAX_MONTHS_AGO_FOR_RATES));
  const arsPerUsd = normalizeRate(rateNumber.toFixed(2));
  switch (payment.currency) {
    case "ARS": {
      const pesos = Math.round((priceUsd * rateNumber) / ARS_ROUNDING_STEP) * ARS_ROUNDING_STEP;
      return { currency: "ARS", amountMinor: pesos * 100, arsPerUnit: "1.0000", arsPerUsd };
    }
    case "BRL": {
      const reais = Math.round((priceUsd * BRL_PER_USD) / BRL_ROUNDING_STEP) * BRL_ROUNDING_STEP;
      return {
        currency: "BRL",
        amountMinor: reais * 100,
        arsPerUnit: normalizeRate((rateNumber / BRL_PER_USD).toFixed(2)),
        arsPerUsd,
      };
    }
    default:
      return { currency: payment.currency, amountMinor: priceUsd * 100, arsPerUnit: arsPerUsd, arsPerUsd };
  }
}

// --- Fechas -----------------------------------------------------------------

/** El instante de un día de Argentina a cierta hora (UTC-3, sin horario de verano). */
function argentinaTime(day: string, hour: number): Date {
  return new Date(`${day}T${String(hour).padStart(2, "0")}:00:00-03:00`);
}

const SESSION_HOURS = [17, 18, 19, 20, 21] as const;
const HOURS_AFTER_SESSION = 2;

/** Cuándo se entrega o se da cada servicio, a partir de su día de cobro. */
function scheduleFor(item: SaleItem, paidOn: string, random: Random): Date {
  const hour = SESSION_HOURS[Math.floor(random() * SESSION_HOURS.length)];
  switch (item) {
    case "vodRecorded":
      return argentinaTime(addDays(paidOn, 3), 18);
    case "gamePlan":
      return argentinaTime(addDays(paidOn, 7), 18);
    case "proSeason":
      return argentinaTime(addDays(paidOn, 7), 20);
    case "other":
      return argentinaTime(paidOn, 15);
    case "lessonPack":
      return argentinaTime(addDays(paidOn, 3), hour);
    default:
      return argentinaTime(addDays(paidOn, 2 + Math.floor(random() * 5)), hour);
  }
}

// --- Ventas -----------------------------------------------------------------

/** Lo que define una venta; el resto (monto, cotización, factura) se deriva. */
interface SaleSpec {
  student: number;
  item: SaleItem;
  status: SaleStatus;
  paidOn: string | null;
  dueAt?: Date | null;
  deliveredAt?: Date | null;
  priceUsd?: number;
  description?: string;
  monthsAgo: number;
}

type SaleDraft = Omit<DemoSale, "id" | "invoiceStatus" | "invoiceType" | "invoiceNumber" | "invoicedOn">;

function toDraft(spec: SaleSpec, random: Random): SaleDraft {
  const student = STUDENTS[spec.student - 1];
  const priceUsd = spec.priceUsd ?? suggestedPriceUsd(spec.item) ?? 50;
  const payment = pickPayment(random, student.country);
  const priced = priceIn(payment, priceUsd, spec.monthsAgo);
  const amountArsMinor = convertToArsMinor(priced.amountMinor, priced.arsPerUnit);
  return {
    customerId: customerId(spec.student),
    item: spec.item,
    description: spec.description ?? null,
    currency: priced.currency,
    amountMinor: priced.amountMinor,
    arsPerUnit: priced.arsPerUnit,
    arsPerUsd: priced.arsPerUsd,
    rateSource: "fixed",
    rateQuotedOn: spec.paidOn,
    amountArsMinor,
    amountUsdMinor: isDollarCurrency(priced.currency)
      ? priced.amountMinor
      : arsToUsdMinor(amountArsMinor, priced.arsPerUsd),
    paymentMethod: payment.paymentMethod,
    status: spec.status,
    paidOn: spec.paidOn,
    dueAt: spec.dueAt ?? null,
    deliveredAt: spec.deliveredAt ?? null,
    source: "manual",
    notes: "Venta de ejemplo.",
  };
}

const ITEM_WEIGHTS = [
  ["lesson", 22],
  ["vodRecorded", 12],
  ["vodLive", 14],
  ["gamePlan", 16],
  ["lessonPack", 14],
  ["tournament", 14],
] as const satisfies readonly (readonly [SaleItem, number])[];
const DISCOUNT_CHANCE = 0.12;
const DISCOUNT_FACTOR = 0.9;

/** Una venta cobrada del historial: entregada si su fecha ya pasó, cobrada si todavía no. */
function historySpec(
  random: Random,
  student: number,
  paidOn: string,
  today: string,
  monthsAgo: number,
): SaleSpec {
  const item = pickWeighted<SaleItem>(random, ITEM_WEIGHTS);
  const listPrice = suggestedPriceUsd(item) ?? 50;
  const priceUsd = random() < DISCOUNT_CHANCE ? Math.round(listPrice * DISCOUNT_FACTOR) : listPrice;
  const dueAt = scheduleFor(item, paidOn, random);
  const dueDay = dueAt.toISOString().slice(0, 10);
  const isPast = dueDay < today;
  return {
    student,
    item,
    status: isPast ? "delivered" : "paid",
    paidOn,
    dueAt,
    deliveredAt: isPast ? new Date(dueAt.getTime() + HOURS_AFTER_SESSION * 3_600_000) : null,
    priceUsd,
    monthsAgo,
  };
}

/** Cuántas ventas tiene el mes en curso: las del mes completo, en proporción a los días que pasaron. */
function currentMonthSales(today: string): number {
  const elapsed = Number(today.slice(8, 10));
  const length = Number(lastOfMonth(today).slice(8, 10));
  return Math.max(
    MIN_SALES_IN_CURRENT_MONTH,
    Math.round((SALES_IN_FULL_CURRENT_MONTH * elapsed) / length),
  );
}

function shuffle<T>(random: Random, items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** El alumno que repite compra: los primeros alumnos compran más seguido. */
function pickReturning(random: Random, candidates: readonly number[]): number {
  return pickWeighted(
    random,
    candidates.map((student) => [student, Math.max(1, 6 - Math.floor((student - 1) / 4))] as const),
  );
}

/** Las ventas de un mes de la historia: la primera compra de cada alumno nuevo y el resto de recompras. */
function monthSpecs(random: Random, today: string, monthsAgo: number): SaleSpec[] {
  const monthStart = addMonths(firstOfMonth(today), -monthsAgo);
  const lastDay = monthsAgo === 0 ? today : lastOfMonth(monthStart);
  const available = Number(lastDay.slice(8, 10));
  const count =
    monthsAgo === 0 ? currentMonthSales(today) : SALES_PER_PAST_MONTH[MAX_MONTHS_AGO_FOR_RATES - monthsAgo];

  const joined = (student: number) => STUDENTS[student - 1].joinedMonthsAgo;
  const allStudents = STUDENTS.map((_, index) => index + 1);
  const newcomers = allStudents.filter((student) => joined(student) === monthsAgo);
  const returning = allStudents.filter((student) => joined(student) > monthsAgo);
  const repeaters = returning.length > 0 ? returning : newcomers;

  const buyers = [
    ...newcomers,
    ...Array.from({ length: Math.max(0, count - newcomers.length) }, () => pickReturning(random, repeaters)),
  ];
  const days = Array.from({ length: buyers.length }, (_, slot) =>
    Math.min(available, 1 + Math.floor(((slot + random()) * available) / buyers.length)),
  );
  return shuffle(random, buyers).map((student, slot) => {
    const paidOn = `${monthStart.slice(0, 7)}-${String(days[slot]).padStart(2, "0")}`;
    return historySpec(random, student, paidOn, today, monthsAgo);
  });
}

// --- Situaciones a mano: pendientes, canceladas, Temporada Pro --------------

const LATE_HOURS = [17, 18, 19, 20, 21] as const;

/**
 * Lo que no sale solo del historial: trabajo pendiente de esta semana (entregas
 * vencidas, sesiones, sesiones sin marcar, algunas sin cobrar), las ventas
 * canceladas y reembolsada, la Temporada Pro (el servicio sin ventas en 90
 * días) y una venta de "Otro".
 */
function scenarioSpecs(today: string): SaleSpec[] {
  const ago = (days: number) => addDays(today, -days);
  const at = (days: number, hour: number) => argentinaTime(addDays(today, days), hour);
  const paid = (
    student: number,
    item: SaleItem,
    paidDaysAgo: number,
    dueInDays: number | null,
    hour = 18,
    extra: Partial<SaleSpec> = {},
  ): SaleSpec => ({
    student,
    item,
    status: "paid",
    paidOn: ago(paidDaysAgo),
    dueAt: dueInDays === null ? null : at(dueInDays, hour),
    monthsAgo: 0,
    ...extra,
  });
  const unpaid = (student: number, item: SaleItem, dueInDays: number, hour: number): SaleSpec => ({
    student,
    item,
    status: "pending",
    paidOn: null,
    dueAt: at(dueInDays, hour),
    monthsAgo: 0,
  });
  const monthDay = (monthsAgo: number, day: number) =>
    `${addMonths(firstOfMonth(today), -monthsAgo).slice(0, 7)}-${String(day).padStart(2, "0")}`;

  const proSeasonDay = monthDay(4, 12);
  return [
    // Entregas: dos vencidas, dos por venir, una sin fecha.
    paid(3, "vodRecorded", 5, -2),
    paid(7, "gamePlan", 9, -1),
    paid(12, "vodRecorded", 1, 2),
    paid(15, "gamePlan", 2, 5),
    paid(21, "gamePlan", 0, null),
    // Sesiones de los próximos 7 días (una sin cobrar, una para hoy a la noche).
    paid(2, "lesson", 2, 1),
    paid(9, "vodLive", 1, 2, 21),
    paid(5, "tournament", 3, 4, 20),
    unpaid(14, "lesson", 3, 17),
    paid(18, "lessonPack", 0, 6, 19),
    paid(22, "lesson", 0, 0, 21),
    // Sesiones ya dadas que faltan marcar (el pack no entra) y dos sin cobrar.
    paid(1, "lesson", 6, -2, 19),
    paid(4, "vodLive", 8, -4, 20),
    paid(6, "lesson", 10, -6),
    paid(8, "tournament", 14, -9, 21),
    paid(10, "lesson", 18, -12, 17),
    paid(13, "vodLive", 24, -17, 20),
    unpaid(16, "lesson", -5, 19),
    unpaid(20, "vodLive", -15, 18),
    paid(11, "lessonPack", 30, -20, 19),
    // Temporada Pro: la última hace más de 90 días, y una venta de "Otro".
    {
      student: 1,
      item: "proSeason",
      status: "paid",
      paidOn: proSeasonDay,
      dueAt: argentinaTime(addDays(proSeasonDay, 7), 20),
      monthsAgo: 4,
    },
    {
      student: 9,
      item: "other",
      status: "delivered",
      paidOn: monthDay(2, 20),
      dueAt: argentinaTime(monthDay(2, 20), 15),
      deliveredAt: argentinaTime(monthDay(2, 20), 16),
      priceUsd: 60,
      description: "Revisión de configuración (ejemplo)",
      monthsAgo: 2,
    },
    // Canceladas, reembolsada y una que quedó en pagar sin fecha.
    { student: 4, item: "lesson", status: "cancelled", paidOn: null, dueAt: at(-20, LATE_HOURS[0]), monthsAgo: 1 },
    { student: 11, item: "gamePlan", status: "cancelled", paidOn: null, monthsAgo: 2 },
    { student: 19, item: "tournament", status: "cancelled", paidOn: null, dueAt: at(-130, 20), monthsAgo: 4 },
    { student: 13, item: "vodLive", status: "refunded", paidOn: ago(40), monthsAgo: 1 },
    { student: 17, item: "vodRecorded", status: "pending", paidOn: null, monthsAgo: 0 },
  ];
}

// --- Factura ----------------------------------------------------------------

/** Las ventas cobradas de más de 40 días ya tienen su factura; las de las últimas semanas, casi todas no. */
const INVOICE_AGE_DAYS = 40;
const NOT_REQUIRED_CHANCE = 0.06;
const DAYS_TO_INVOICE = 2;
const INVOICE_POINT_OF_SALE = "0003";

function incomeStatus(status: string): boolean {
  return status === "paid" || status === "delivered";
}

function invoiceStatusOf(draft: SaleDraft, today: string, random: Random): InvoiceStatus {
  if (!incomeStatus(draft.status) || !draft.paidOn) return "not_required";
  if (random() < NOT_REQUIRED_CHANCE) return "not_required";
  return draft.paidOn <= addDays(today, -INVOICE_AGE_DAYS) ? "issued" : "pending";
}

function withInvoices(drafts: readonly SaleDraft[], today: string, random: Random): DemoSale[] {
  const statuses = drafts.map((draft) => invoiceStatusOf(draft, today, random));
  const issuedInOrder = drafts
    .map((draft, index) => ({ index, paidOn: draft.paidOn ?? "" }))
    .filter(({ index }) => statuses[index] === "issued")
    .sort((a, b) => (a.paidOn === b.paidOn ? a.index - b.index : a.paidOn < b.paidOn ? -1 : 1));
  const numberOf = new Map(issuedInOrder.map(({ index }, order) => [index, order + 1]));

  return drafts.map((draft, index) => {
    const base = { ...draft, id: saleId(index + 1), invoiceStatus: statuses[index] };
    const sequence = numberOf.get(index);
    if (sequence === undefined || !draft.paidOn) return base;
    return {
      ...base,
      invoiceType: draft.currency === "ARS" ? "C" : "E",
      invoiceNumber: `${INVOICE_POINT_OF_SALE}-${String(sequence).padStart(8, "0")}`,
      invoicedOn: addDays(draft.paidOn, DAYS_TO_INVOICE),
    };
  });
}

// --- Entrada ----------------------------------------------------------------

/**
 * Los datos de ejemplo para un día "AAAA-MM-DD" (hoy en Argentina): 25 alumnos
 * y unas 120 ventas en 14 meses, más los clics en "Reservar" que las acompañan.
 * Todos los servicios tienen ventas, salvo la Temporada Pro, que no vendió en
 * los últimos 90 días.
 */
export function buildDemoData(today: string): DemoData {
  const random = createRandom(SEED);
  const history = Array.from({ length: HISTORY_MONTHS }, (_, index) =>
    monthSpecs(random, today, HISTORY_MONTHS - 1 - index),
  ).flat();
  const specs = [...history, ...scenarioSpecs(today)];
  const drafts = specs.map((spec) => toDraft(spec, random));
  const demoSales = withInvoices(drafts, today, random);
  return {
    customers: buildCustomers(),
    sales: demoSales,
    // Con su propio generador: los clics no cambian ni una venta de ejemplo.
    interest: buildDemoInterest(today, demoSales),
  };
}
