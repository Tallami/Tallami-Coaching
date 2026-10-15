// Lo que no hay que olvidarse: entregas por vencer o vencidas, sesiones de los
// próximos 7 días y ventas cobradas sin facturar.
//
// Trabajo pendiente = venta cobrada (`paid`) a la que todavía le falta lo que
// se prometió: sin fecha de entrega (`deliveredAt`) y sin pasar a "entregada".
// Las pendientes de cobro, canceladas y reembolsadas no generan trabajo: la
// sesión o la entrega de una venta que no se cobró (o se devolvió) no se hace
// hasta que se cobre, y se ven en la lista de ventas con su estado.

import { argentinaLocalToDate } from "@/admin/dates";
import type { SaleItem } from "@/admin/catalog";
import { sumMinor } from "./math";
import { isIncome, type MetricSale } from "./metric-sale";

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

/** Cuántos días hacia adelante cuentan como "próximos" para las sesiones. */
const SESSION_WINDOW_DAYS = 7;
const MS_PER_DAY = 86_400_000;

export interface PendingDelivery {
  id: string;
  /** Entrega comprometida tal como llegó en la venta, o `null` si no tiene (o no se puede leer). */
  dueAt: string | null;
  /** La fecha comprometida ya pasó (la que vence ahora mismo todavía no). */
  overdue: boolean;
}

export interface UpcomingSession {
  id: string;
  dueAt: string;
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
  /** Sesiones cobradas desde ahora hasta dentro de 7 días, por fecha. */
  sessions: UpcomingSession[];
  /** Ventas de ingreso con la factura pendiente (no cuentan las "no requiere"). */
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

interface OpenSale {
  sale: MetricSale;
  dueMs: number | null;
}

/** Ventas cobradas a las que les falta entregar. */
function openSales(sales: readonly MetricSale[]): OpenSale[] {
  return sales
    .filter((sale) => isIncome(sale) && sale.status === "paid" && sale.deliveredAt === null)
    .map((sale) => ({ sale, dueMs: instantMs(sale.dueAt) }));
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
  const nowMs = now.getTime();
  const windowEndMs = nowMs + SESSION_WINDOW_DAYS * MS_PER_DAY;
  const open = openSales(sales);

  const deliveries = open
    .filter(({ sale }) => DELIVERY_ITEMS.has(sale.item))
    .sort(byDueThenId)
    .map(({ sale, dueMs }) => ({
      id: sale.id,
      dueAt: dueMs === null ? null : sale.dueAt,
      overdue: dueMs !== null && dueMs < nowMs,
    }));

  const sessions = open
    .filter(
      ({ sale, dueMs }) =>
        SESSION_ITEMS.has(sale.item) && dueMs !== null && dueMs >= nowMs && dueMs <= windowEndMs,
    )
    .sort(byDueThenId)
    .map(({ sale }) => ({ id: sale.id, dueAt: sale.dueAt as string }));

  const uninvoiced = sales.filter((sale) => isIncome(sale) && sale.invoiceStatus === "pending");
  return {
    deliveries,
    sessions,
    uninvoiced: {
      count: uninvoiced.length,
      arsMinor: sumMinor(uninvoiced.map((sale) => sale.amountArsMinor)),
      usdMinor: sumMinor(uninvoiced.map((sale) => sale.amountUsdMinor)),
    },
  };
}
