// Lo que no hay que olvidarse: entregas por vencer o vencidas, sesiones de hoy
// y de los próximos 7 días, sesiones pasadas que faltan marcar como hechas y
// ventas cobradas sin facturar.
//
// - Entregas: ventas cobradas (`paid`) de VOD grabado o plan de juego a las que
//   todavía les falta la entrega (`deliveredAt` vacío).
// - Sesiones: las de servicios en vivo, cobradas o sin cobrar (`pending`), desde
//   las 00:00 de hoy en Argentina hasta dentro de 7 días. Una sesión sin cobrar
//   igual se agenda: sale marcada para que se cobre antes de darla.
// - Para marcar: sesiones cuyo día ya pasó (antes de las 00:00 de hoy) y siguen
//   sin marcarse como entregadas, cobradas o no. Las que nunca se cobraron salen
//   con `unpaid: true`: hay que cobrarlas o cancelarlas. El pack de clases y la
//   Temporada Pro son de varias sesiones: una fecha no alcanza para decir que
//   ya se dieron, así que no se piden marcar (sí figuran como próximas sesiones).
// - Las canceladas y reembolsadas nunca generan trabajo.

import { argentinaLocalToDate } from "@/admin/dates";
import type { SaleItem } from "@/admin/catalog";
import { sumMinor } from "./math";
import { isIncome, type MetricSale } from "./metric-sale";
import { todayInArgentina } from "./period";

/** Servicios que se entregan: un trabajo hecho a distancia con fecha de entrega. */
const DELIVERY_ITEMS: ReadonlySet<SaleItem> = new Set(["vodRecorded", "gamePlan"]);
/** Servicios que se dan en vivo, en un día y una hora. */
const SESSION_ITEMS: ReadonlySet<SaleItem> = new Set([
  "vodLive",
  "lesson",
  "lessonPack",
  "tournament",
  "proSeason",
]);

/** Servicios de varias sesiones: no se marcan como hechos con una sola fecha. */
const MULTI_SESSION_ITEMS: ReadonlySet<SaleItem> = new Set(["lessonPack", "proSeason"]);

/** Cuántos días hacia adelante cuentan como "próximos" para las sesiones. */
const SESSION_WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

/** Qué se vendió y a quién: lo que necesita la lista para mostrar cada fila. */
export interface PendingSaleRef {
  id: string;
  item: SaleItem;
  customerId: string;
  customerName: string;
}

export interface PendingDelivery extends PendingSaleRef {
  /** Entrega comprometida tal como llegó en la venta, o `null` si no tiene (o no se puede leer). */
  dueAt: string | null;
  /** La fecha comprometida ya pasó (la que vence ahora mismo todavía no). */
  overdue: boolean;
}

export interface UpcomingSession extends PendingSaleRef {
  dueAt: string;
  /** La venta todavía no se cobró (estado pendiente). */
  unpaid: boolean;
}

export interface SessionToMark extends PendingSaleRef {
  dueAt: string;
  /** La venta nunca se cobró (estado pendiente): hay que cobrarla o cancelarla. */
  unpaid: boolean;
}

export interface UninvoicedTotals {
  count: number;
  /** Suma en centavos de peso. */
  arsMinor: number;
  /** Suma en centavos de dólar. */
  usdMinor: number;
}

export interface PendingWork {
  /**
   * VOD grabado y plan de juego cobrados y sin entregar, por fecha (los vencidos
   * quedan primero) y, al final, los que no tienen fecha.
   */
  deliveries: PendingDelivery[];
  /** Sesiones sin entregar desde las 00:00 de hoy hasta dentro de 7 días, cobradas o no, por fecha. */
  sessions: UpcomingSession[];
  /**
   * Sesiones (sin el pack de clases ni la Temporada Pro) de un día anterior a
   * hoy que siguen sin marcarse como hechas, cobradas o sin cobrar, la más
   * vieja primero.
   */
  toMark: SessionToMark[];
  /** Ventas de ingreso ya fechadas con la factura pendiente (no cuentan las "no requiere"). */
  uninvoiced: UninvoicedTotals;
}

/** Termina en una zona: "Z" o un desfase como "-03:00" (sin zona, `Date.parse` usaría la del servidor). */
const ENDS_WITH_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Lee `dueAt` como un instante: ISO 8601 con zona ("2026-10-15T18:00:00.000Z",
 * lo que guarda la base) o la hora de pared de Argentina ("2026-10-15T15:00",
 * lo que escribe el formulario). Devuelve `null` si no es una fecha con hora.
 */
function instantMs(value: string | null): number | null {
  if (value === null) return null;
  const wallClock = argentinaLocalToDate(value);
  if (wallClock) return wallClock.getTime();
  if (!ENDS_WITH_ZONE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** El instante en que empieza ese día de Argentina (00:00, UTC-3). */
function startOfArgentinaDayMs(day: string): number {
  const start = argentinaLocalToDate(`${day}T00:00`);
  if (!start) throw new RangeError(`Día inválido: "${day}".`);
  return start.getTime();
}

/** Una venta sin entregar con su fecha ya leída. */
interface OpenSale {
  sale: MetricSale;
  dueMs: number | null;
}

function ref(sale: MetricSale): PendingSaleRef {
  return {
    id: sale.id,
    item: sale.item,
    customerId: sale.customerId,
    customerName: sale.customerName,
  };
}

/** Por fecha (las sin fecha al final) y, a igual fecha, por id. */
function byDueThenId(a: OpenSale, b: OpenSale): number {
  if (a.dueMs !== b.dueMs) {
    if (a.dueMs === null) return 1;
    if (b.dueMs === null) return -1;
    return a.dueMs - b.dueMs;
  }
  return a.sale.id < b.sale.id ? -1 : a.sale.id > b.sale.id ? 1 : 0;
}

export function pendingWork(sales: readonly MetricSale[], now: Date): PendingWork {
  const today = todayInArgentina(now);
  const nowMs = now.getTime();
  const startOfTodayMs = startOfArgentinaDayMs(today);
  const windowEndMs = nowMs + SESSION_WINDOW_DAYS * MS_PER_DAY;

  const open: OpenSale[] = sales
    .filter((sale) => sale.deliveredAt === null)
    .map((sale) => ({ sale, dueMs: instantMs(sale.dueAt) }));

  const deliveries = open
    .filter(({ sale }) => sale.status === "paid" && DELIVERY_ITEMS.has(sale.item))
    .sort(byDueThenId)
    .map(({ sale, dueMs }) => ({
      ...ref(sale),
      dueAt: dueMs === null ? null : sale.dueAt,
      overdue: dueMs !== null && dueMs < nowMs,
    }));

  const sessions = open
    .filter(
      ({ sale, dueMs }) =>
        (sale.status === "paid" || sale.status === "pending") &&
        SESSION_ITEMS.has(sale.item) &&
        dueMs !== null &&
        dueMs >= startOfTodayMs &&
        dueMs <= windowEndMs,
    )
    .sort(byDueThenId)
    .map(({ sale }) => ({
      ...ref(sale),
      dueAt: sale.dueAt as string,
      unpaid: sale.status === "pending",
    }));

  const toMark = open
    .filter(
      ({ sale, dueMs }) =>
        (sale.status === "paid" || sale.status === "pending") &&
        SESSION_ITEMS.has(sale.item) &&
        !MULTI_SESSION_ITEMS.has(sale.item) &&
        dueMs !== null &&
        dueMs < startOfTodayMs,
    )
    .sort(byDueThenId)
    .map(({ sale }) => ({
      ...ref(sale),
      dueAt: sale.dueAt as string,
      unpaid: sale.status === "pending",
    }));

  // Una venta con fecha de cobro futura todavía no cuenta como cobrada.
  const uninvoiced = sales.filter(
    (sale) => isIncome(sale) && sale.paidOn <= today && sale.invoiceStatus === "pending",
  );
  return {
    deliveries,
    sessions,
    toMark,
    uninvoiced: {
      count: uninvoiced.length,
      arsMinor: sumMinor(uninvoiced.map((sale) => sale.amountArsMinor)),
      usdMinor: sumMinor(uninvoiced.map((sale) => sale.amountUsdMinor)),
    },
  };
}
