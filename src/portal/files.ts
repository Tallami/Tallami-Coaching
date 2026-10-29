// Los PDF que Tallami entrega, y cómo se guardan y se sirven. Hoy los bytes viven en
// la base (tabla `delivery_files`, aparte de las entregas para que listar nunca los
// lea). Todo el resto del código habla con la interfaz `DeliveryFileStore`: si algún
// día los PDF pasan a un almacenamiento de archivos, se escribe otra implementación y
// no se toca nada más.
//
// Un PDF se reconoce por sus bytes (`%PDF-` al principio), nunca por el nombre del
// archivo ni por el tipo que dice el navegador: los dos los elige quien lo sube.

import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { deliveryFiles } from "../db/schema";
import { isUuid } from "../db/uuid";

/** El único tipo de archivo que se guarda. */
export type DeliveryContentType = "application/pdf";

/** Un archivo guardado, tal como lo lee quien lo sirve. */
export interface StoredFile {
  bytes: Uint8Array;
  contentType: string;
  size: number;
}

export interface DeliveryFileStore {
  /** Guarda el archivo y devuelve su id. */
  put(db: Db, bytes: Uint8Array, contentType: DeliveryContentType): Promise<string>;
  /** El archivo `id`, o `null` si no existe (también si `id` no es un id). */
  get(db: Db, id: string): Promise<StoredFile | null>;
  /** Borra el archivo `id`. Si no existe, no hace nada. */
  remove(db: Db, id: string): Promise<void>;
}

/** Los archivos en la tabla `delivery_files` de la base. */
export const dbFileStore: DeliveryFileStore = {
  async put(db, bytes, contentType) {
    const [row] = await db
      .insert(deliveryFiles)
      .values({ contentType, size: bytes.byteLength, bytes })
      .returning({ id: deliveryFiles.id });
    return row.id;
  },

  async get(db, id) {
    if (!isUuid(id)) return null;
    const [row] = await db
      .select({ bytes: deliveryFiles.bytes, contentType: deliveryFiles.contentType, size: deliveryFiles.size })
      .from(deliveryFiles)
      .where(eq(deliveryFiles.id, id));
    return row ?? null;
  },

  async remove(db, id) {
    if (!isUuid(id)) return;
    await db.delete(deliveryFiles).where(eq(deliveryFiles.id, id));
  },
};

/** Cómo empieza todo PDF. */
const PDF_MARK = Buffer.from("%PDF-");

/** ¿Empiezan los bytes con `%PDF-`? */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.byteLength >= PDF_MARK.length && PDF_MARK.every((byte, index) => bytes[index] === byte);
}

/**
 * La respuesta que sirve un PDF: en el navegador, sin guardarlo en caché (es de un alumno)
 * y con `nosniff` para que nunca se lea como otra cosa. Las dos rutas que lo sirven (la del
 * portal y la del panel) usan esta, así sus encabezados no se separan.
 */
export function pdfResponse(file: StoredFile): Response {
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="entrega.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * El 404 de las rutas de archivos: sin cuerpo, así no dice si la entrega existe, si es de
 * otro alumno o si no es un archivo. Es el mismo para todos esos casos.
 */
export function fileNotFoundResponse(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
}
