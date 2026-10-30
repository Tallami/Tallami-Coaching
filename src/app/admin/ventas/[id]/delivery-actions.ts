"use server";

import { requireAdmin } from "@/admin/auth/require-admin";
import { getDb } from "@/db/client";
import {
  addLinkDelivery,
  addPdfDelivery,
  addYoutubeDelivery,
  deleteDelivery,
  getDeliveryOfSale,
  type AddDeliveryError,
} from "@/portal/deliveries";
import { DELIVERY_KINDS, DELIVERY_PDF_MAX_BYTES } from "@/portal/policy";

// Las acciones de la tarjeta "Entregas" de la ficha de la venta
// (`src/admin/sales/deliveries-card.tsx`). Como todas las del panel, verifican la sesión
// antes de todo. Ninguna redirige: la tarjeta es un componente de cliente que muestra el
// resultado y vuelve a pedir la ficha. Lo que llega del navegador no es de fiar: el tipo,
// el título, el link y los bytes del archivo se validan acá (`src/portal/deliveries.ts`),
// diga lo que diga el formulario.

/** El resultado de agregar: bien, o el primer motivo por el que no se guardó nada. */
export type AddDeliveryActionResult = { ok: true } | { ok: false; error: AddDeliveryError | "invalid-kind" };

/** El resultado de borrar. `not-found` es una entrega que ya no está (se borró en otra pestaña). */
export type DeleteDeliveryActionResult = { ok: true } | { ok: false; error: "not-found" };

type DeliveryKind = (typeof DELIVERY_KINDS)[number];

function isDeliveryKind(value: string): value is DeliveryKind {
  return (DELIVERY_KINDS as readonly string[]).includes(value);
}

/** El texto del campo `name` del formulario; un campo que falta, o que trae un archivo, es un texto vacío. */
function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** El archivo del formulario, o `null` si no hay (o si en su lugar vino un texto). */
function fileField(formData: FormData): Blob | null {
  const value = formData.get("file");
  return value instanceof Blob ? value : null;
}

/**
 * Agrega una entrega a la venta `saleId` con lo que manda el formulario: `kind` (`youtube`,
 * `pdf` o `link`), `title` y el link (`url`) o el archivo (`file`) según el tipo; el campo
 * del otro tipo se ignora. Un PDF se reconoce por sus bytes y pesa 4 MB como máximo, sin
 * importar el nombre ni el tipo que diga el navegador.
 */
export async function addDeliveryAction(saleId: string, formData: FormData): Promise<AddDeliveryActionResult> {
  await requireAdmin();
  const kind = textField(formData, "kind");
  if (!isDeliveryKind(kind)) return { ok: false, error: "invalid-kind" };

  const title = textField(formData, "title");
  const db = await getDb();
  switch (kind) {
    case "youtube":
      return addYoutubeDelivery(db, saleId, title, textField(formData, "url"));
    case "link":
      return addLinkDelivery(db, saleId, title, textField(formData, "url"));
    case "pdf": {
      // Next ya leyó el cuerpo del pedido (hasta 5 MB, `experimental.serverActions.bodySizeLimit` en
      // `next.config.ts`) y armó el formulario: el archivo ya está en memoria. Lo que se evita acá es
      // copiarlo a bytes (`arrayBuffer()`) y seguir con él para rechazarlo después.
      // `addPdfDelivery` vuelve a exigir el tamaño y los bytes (`%PDF-`) de lo que se leyó.
      const file = fileField(formData);
      if (file && file.size > DELIVERY_PDF_MAX_BYTES) return { ok: false, error: "too-large" };
      const bytes = file ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(0);
      return addPdfDelivery(db, saleId, title, bytes);
    }
  }
}

/**
 * Borra la entrega `deliveryId` de la venta `saleId` y, si era un PDF, su archivo. Solo la
 * borra si es de esa venta: la ficha que se está viendo no puede tocar las entregas de otra.
 */
export async function deleteDeliveryAction(saleId: string, deliveryId: string): Promise<DeleteDeliveryActionResult> {
  await requireAdmin();
  const db = await getDb();
  if (!(await getDeliveryOfSale(db, saleId, deliveryId))) return { ok: false, error: "not-found" };
  return (await deleteDelivery(db, deliveryId)) ? { ok: true } : { ok: false, error: "not-found" };
}
