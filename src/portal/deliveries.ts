// Lo que Tallami le entrega a un alumno por una venta (tabla `deliveries`): un video de
// YouTube (se guarda solo el id del video), un PDF (sus bytes van aparte, ver `files.ts`)
// o un link `https://`. Cada una lleva un título de 1 a 120 caracteres.
//
// La hora de alta la puede poner quien llama (`now`, por defecto la actual), como en las
// sesiones y las invitaciones: así los tests fijan el orden de las entregas sin depender
// de la resolución del reloj de la base.
//
// Acá se valida todo lo que llega del navegador antes de tocar la base (la base lo vuelve a
// exigir con restricciones, pero ahí un valor malo es un error, no un mensaje): el título
// sin espacios de los costados y sin caracteres de control, el link entendido con `new URL`
// (solo `https:` con un dominio y sin usuario ni clave), el video por su id, el PDF por sus
// bytes y su tamaño.
//
// El alumno ve una entrega solo si la venta es suya (`deliveryForStudent`); el panel las
// lee por venta (`listDeliveriesForSale`, `getDeliveryOfSale`).

import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { deliveries, sales } from "../db/schema";
import { isUuid } from "../db/uuid";
import { dbFileStore, isPdf } from "./files";
import {
  DELIVERY_KINDS,
  DELIVERY_PDF_MAX_BYTES,
  DELIVERY_TITLE_MAX_LENGTH,
  DELIVERY_URL_MAX_LENGTH,
} from "./policy";
import { youtubeVideoId } from "./youtube";

export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

/** Una entrega, con campos explícitos y sin los bytes del archivo. */
export interface Delivery {
  id: string;
  saleId: string;
  kind: DeliveryKind;
  title: string;
  /** El id del video, solo en una entrega de YouTube. */
  youtubeVideoId: string | null;
  /** El link, solo en una entrega de tipo link. */
  url: string | null;
  /** El archivo, solo en una entrega de PDF. */
  fileId: string | null;
  createdAt: Date;
}

export type AddDeliveryError = "invalid-title" | "invalid-url" | "not-pdf" | "too-large" | "sale-not-found";

/** Cómo termina agregar una entrega: bien, o el primer motivo por el que no se pudo (y no se guardó nada). */
export type AddDeliveryResult = { ok: true } | { ok: false; error: AddDeliveryError };

const DELIVERY_COLUMNS = {
  id: deliveries.id,
  saleId: deliveries.saleId,
  kind: deliveries.kind,
  title: deliveries.title,
  youtubeVideoId: deliveries.youtubeVideoId,
  url: deliveries.url,
  fileId: deliveries.fileId,
  createdAt: deliveries.createdAt,
};

/**
 * La fila como la devuelve la base. El tipo llega como texto: la restricción
 * `deliveries_kind_valid` garantiza que sea uno de la lista.
 */
function toDelivery(row: Omit<Delivery, "kind"> & { kind: string }): Delivery {
  return { ...row, kind: row.kind as DeliveryKind };
}

const fail = (error: AddDeliveryError): AddDeliveryResult => ({ ok: false, error });

/** Letras de control (incluye el salto de línea y el NUL, que la base no acepta en un texto). */
const CONTROL_CHARACTER = /\p{Cc}/u;

/**
 * El título sin los espacios de los costados, o `null` si no sirve: vacío, de más de 120
 * caracteres (se cuentan caracteres y no unidades de UTF-16, como hace la base) o con
 * caracteres de control.
 */
function cleanTitle(raw: string): string | null {
  const title = raw.trim();
  if (title === "" || CONTROL_CHARACTER.test(title)) return null;
  return [...title].length <= DELIVERY_TITLE_MAX_LENGTH ? title : null;
}

/**
 * El link entendido como lo entiende el navegador (así se guarda `https://ejemplo.com/`
 * y no lo que se escribió), o `null` si no es un link `https:` con un dominio, sin usuario
 * ni clave y de hasta 2048 caracteres. Rechaza `http:`, `javascript:`, `data:` y un
 * `https://` pelado.
 */
function cleanLink(raw: string): string | null {
  const text = raw.trim();
  if (text.length > DELIVERY_URL_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname === "" || url.username !== "" || url.password !== "") return null;
  return url.href.length <= DELIVERY_URL_MAX_LENGTH ? url.href : null;
}

type NewDelivery = Pick<typeof deliveries.$inferInsert, "kind" | "title" | "youtubeVideoId" | "url" | "fileId">;

async function saleExists(db: Db, saleId: string): Promise<boolean> {
  if (!isUuid(saleId)) return false;
  const [sale] = await db.select({ id: sales.id }).from(sales).where(eq(sales.id, saleId));
  return sale !== undefined;
}

/**
 * Agrega la entrega `values` a la venta `saleId` si la venta existe. Cuando lleva un archivo,
 * el archivo y la entrega se guardan juntos o no se guarda ninguno.
 */
async function insertDelivery(
  db: Db,
  saleId: string,
  values: NewDelivery,
  now: Date,
  pdf?: Uint8Array,
): Promise<AddDeliveryResult> {
  return db.transaction(async (tx): Promise<AddDeliveryResult> => {
    if (!(await saleExists(tx, saleId))) return fail("sale-not-found");
    const fileId = pdf ? await dbFileStore.put(tx, pdf, "application/pdf") : null;
    await tx.insert(deliveries).values({ ...values, saleId, fileId, createdAt: now });
    return { ok: true };
  });
}

/** Agrega un video de YouTube a la venta; del link se guarda solo el id del video. */
export async function addYoutubeDelivery(
  db: Db,
  saleId: string,
  title: string,
  url: string,
  now: Date = new Date(),
): Promise<AddDeliveryResult> {
  const cleanedTitle = cleanTitle(title);
  if (cleanedTitle === null) return fail("invalid-title");
  const videoId = youtubeVideoId(url);
  if (videoId === null) return fail("invalid-url");
  return insertDelivery(db, saleId, { kind: "youtube", title: cleanedTitle, youtubeVideoId: videoId, url: null }, now);
}

/** Agrega un link `https://` a la venta (para lo que pase de 4 MB o no sea un video de YouTube). */
export async function addLinkDelivery(
  db: Db,
  saleId: string,
  title: string,
  url: string,
  now: Date = new Date(),
): Promise<AddDeliveryResult> {
  const cleanedTitle = cleanTitle(title);
  if (cleanedTitle === null) return fail("invalid-title");
  const link = cleanLink(url);
  if (link === null) return fail("invalid-url");
  return insertDelivery(db, saleId, { kind: "link", title: cleanedTitle, youtubeVideoId: null, url: link }, now);
}

/** Agrega un PDF de hasta 4 MB que empiece con `%PDF-`; sus bytes se guardan en `delivery_files`. */
export async function addPdfDelivery(
  db: Db,
  saleId: string,
  title: string,
  bytes: Uint8Array,
  now: Date = new Date(),
): Promise<AddDeliveryResult> {
  const cleanedTitle = cleanTitle(title);
  if (cleanedTitle === null) return fail("invalid-title");
  if (bytes.byteLength > DELIVERY_PDF_MAX_BYTES) return fail("too-large");
  if (!isPdf(bytes)) return fail("not-pdf");
  return insertDelivery(db, saleId, { kind: "pdf", title: cleanedTitle, youtubeVideoId: null, url: null }, now, bytes);
}

/**
 * Borra la entrega y, si era un PDF, su archivo, todo en una transacción. La clave foránea
 * `deliveries.file_id` va de la entrega al archivo (borrar el archivo borra la entrega, no
 * al revés), así que el archivo se borra a propósito: si no, quedaría suelto en la base.
 * Devuelve si había algo que borrar.
 */
export async function deleteDelivery(db: Db, deliveryId: string): Promise<boolean> {
  if (!isUuid(deliveryId)) return false;
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(deliveries)
      .where(eq(deliveries.id, deliveryId))
      .returning({ fileId: deliveries.fileId });
    if (!removed) return false;
    if (removed.fileId) await dbFileStore.remove(tx, removed.fileId);
    return true;
  });
}

/** Las entregas de la venta, en el orden en que se agregaron. Sin los bytes de los archivos. */
export async function listDeliveriesForSale(db: Db, saleId: string): Promise<Delivery[]> {
  if (!isUuid(saleId)) return [];
  const rows = await db
    .select(DELIVERY_COLUMNS)
    .from(deliveries)
    .where(eq(deliveries.saleId, saleId))
    .orderBy(asc(deliveries.createdAt), asc(deliveries.id));
  return rows.map(toDelivery);
}

/** La entrega `deliveryId` de la venta `saleId`, o `null` si no existe o es de otra venta. */
export async function getDeliveryOfSale(db: Db, saleId: string, deliveryId: string): Promise<Delivery | null> {
  if (!isUuid(saleId) || !isUuid(deliveryId)) return null;
  const [row] = await db
    .select(DELIVERY_COLUMNS)
    .from(deliveries)
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.saleId, saleId)));
  return row ? toDelivery(row) : null;
}

/**
 * La entrega `deliveryId` solo si su venta es del alumno `customerId`; de cualquier otro
 * alumno, de un id que no existe o que no es un id, `null`: no hay forma de distinguirlos.
 */
export async function deliveryForStudent(db: Db, deliveryId: string, customerId: string): Promise<Delivery | null> {
  if (!isUuid(deliveryId) || !isUuid(customerId)) return null;
  const [row] = await db
    .select(DELIVERY_COLUMNS)
    .from(deliveries)
    .innerJoin(sales, eq(deliveries.saleId, sales.id))
    .where(and(eq(deliveries.id, deliveryId), eq(sales.customerId, customerId)));
  return row ? toDelivery(row) : null;
}
