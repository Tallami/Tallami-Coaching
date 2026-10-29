// Lo que el alumno ve de sus compras en el portal. Sale de la base por un tipo de datos propio
// (`StudentPurchase`, `StudentDelivery`), con campos explícitos: nunca la fila de la venta ni la
// de la entrega. Notas, factura, montos en pesos o dólares calculados, cotizaciones, medio de pago,
// fuente, el id del alumno y el id del archivo se quedan en el panel.
//
// Una sola consulta trae las ventas del alumno con sus entregas (un `left join`); se agrupan acá.

import { asc, desc, eq, sql } from "drizzle-orm";
import type { Currency, SaleItem, SaleStatus } from "@/admin/catalog";
import type { Db } from "../db/client";
import { deliveries, sales } from "../db/schema";
import { isUuid } from "../db/uuid";
import type { DeliveryKind } from "./deliveries";

/** Una entrega tal como la ve el alumno. Cada tipo trae solo el campo que le corresponde. */
export type StudentDelivery = {
  id: string;
  kind: DeliveryKind;
  title: string;
  /** Cuándo se cargó, en ISO 8601 (UTC). */
  createdAt: string;
  /** El id del video, solo en una entrega de YouTube. */
  youtubeVideoId?: string;
  /** El link `https://`, solo en una entrega de tipo link. */
  url?: string;
  /** Dónde se abre el PDF (una ruta del portal que verifica sesión y dueño), solo en una entrega de PDF. */
  fileHref?: string;
};

/** Una compra tal como la ve el alumno, con sus entregas en el orden en que se cargaron. */
export type StudentPurchase = {
  id: string;
  item: SaleItem;
  status: SaleStatus;
  /** El día de cobro ("AAAA-MM-DD"), o `null` si todavía no se cobró. */
  paidOn: string | null;
  /** Lo que vale la compra en la moneda de la venta, en unidades menores (centavos). */
  amountMinor: number;
  currency: Currency;
  deliveries: StudentDelivery[];
};

/** La dirección donde el alumno dueño abre el PDF de la entrega `deliveryId`. */
export function studentFileHref(deliveryId: string): string {
  return `/api/portal/files/${deliveryId}`;
}

/**
 * El orden de las compras: la más nueva primero. La fecha de una compra es su día de cobro o, mientras
 * no se cobró (pendiente, cancelada), el día en que se cargó (en hora de Argentina, como el resto del
 * negocio). A diferencia del panel, que sube arriba todo lo que no tiene día de cobro para que Tallami
 * lo atienda, acá una compra sin cobrar no queda por encima de las nuevas para siempre.
 */
const NEWEST_PURCHASES_FIRST = [
  sql`coalesce(${sales.paidOn}, (${sales.createdAt} at time zone 'America/Argentina/Buenos_Aires')::date) desc`,
  desc(sales.createdAt),
  desc(sales.id),
] as const;

/** Las columnas de una fila de la consulta: la venta y, si tiene, una de sus entregas. */
const PURCHASE_COLUMNS = {
  saleId: sales.id,
  item: sales.item,
  status: sales.status,
  paidOn: sales.paidOn,
  amountMinor: sales.amountMinor,
  currency: sales.currency,
  deliveryId: deliveries.id,
  deliveryKind: deliveries.kind,
  deliveryTitle: deliveries.title,
  deliveryCreatedAt: deliveries.createdAt,
  youtubeVideoId: deliveries.youtubeVideoId,
  deliveryUrl: deliveries.url,
  deliveryFileId: deliveries.fileId,
};

type PurchaseRow = {
  saleId: string;
  item: string;
  status: string;
  paidOn: string | null;
  amountMinor: number;
  currency: string;
  deliveryId: string | null;
  deliveryKind: string | null;
  deliveryTitle: string | null;
  deliveryCreatedAt: Date | null;
  youtubeVideoId: string | null;
  deliveryUrl: string | null;
  deliveryFileId: string | null;
};

/**
 * La entrega de una fila, o `null` si la venta no tiene (el `left join` trae la fila igual, con
 * todo en `null`). Las restricciones de la base (`deliveries_kind_valid`, `deliveries_one_field_per_kind`)
 * garantizan que cada tipo traiga su campo; si algo no cuadra, la entrega no se muestra antes que
 * mostrarla rota.
 */
function toStudentDelivery(row: PurchaseRow): StudentDelivery | null {
  if (row.deliveryId === null || row.deliveryTitle === null || row.deliveryCreatedAt === null) return null;
  const base = { id: row.deliveryId, title: row.deliveryTitle, createdAt: row.deliveryCreatedAt.toISOString() };
  switch (row.deliveryKind) {
    case "youtube":
      return row.youtubeVideoId === null ? null : { ...base, kind: "youtube", youtubeVideoId: row.youtubeVideoId };
    case "link":
      return row.deliveryUrl === null ? null : { ...base, kind: "link", url: row.deliveryUrl };
    case "pdf":
      return row.deliveryFileId === null ? null : { ...base, kind: "pdf", fileHref: studentFileHref(row.deliveryId) };
    default:
      return null;
  }
}

/**
 * Las compras del alumno `customerId`, las más nuevas primero (por día de cobro o, sin cobrar, por día
 * de alta; ver `NEWEST_PURCHASES_FIRST`), cada una con sus entregas en el orden en que se cargaron.
 * De otro alumno, de un id que no existe o que no es un id: lista vacía.
 */
export async function listStudentPurchases(db: Db, customerId: string): Promise<StudentPurchase[]> {
  if (!isUuid(customerId)) return [];
  const rows: PurchaseRow[] = await db
    .select(PURCHASE_COLUMNS)
    .from(sales)
    .leftJoin(deliveries, eq(deliveries.saleId, sales.id))
    .where(eq(sales.customerId, customerId))
    .orderBy(...NEWEST_PURCHASES_FIRST, asc(deliveries.createdAt), asc(deliveries.id));

  // Las filas de una misma venta vienen juntas y en orden; un `Map` conserva el orden de llegada.
  const purchases = new Map<string, StudentPurchase>();
  for (const row of rows) {
    let purchase = purchases.get(row.saleId);
    if (!purchase) {
      purchase = {
        id: row.saleId,
        item: row.item as SaleItem,
        status: row.status as SaleStatus,
        paidOn: row.paidOn,
        amountMinor: row.amountMinor,
        currency: row.currency as Currency,
        deliveries: [],
      };
      purchases.set(row.saleId, purchase);
    }
    const delivery = toStudentDelivery(row);
    if (delivery) purchase.deliveries.push(delivery);
  }
  return [...purchases.values()];
}
