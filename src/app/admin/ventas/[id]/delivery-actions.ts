"use server";

import { requireAdmin } from "@/admin/auth/require-admin";
import { getDb } from "@/db/client";
import {
  addLinkDelivery,
  addPdfDelivery,
  addYoutubeDelivery,
  deleteDelivery,
  type AddDeliveryError,
} from "@/portal/deliveries";
import { DELIVERY_KINDS } from "@/portal/policy";

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

/** Los bytes del archivo del formulario; sin archivo (o con un texto en su lugar) son cero bytes. */
async function fileBytes(formData: FormData): Promise<Uint8Array> {
  const file = formData.get("file");
  return file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(0);
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
    case "pdf":
      return addPdfDelivery(db, saleId, title, await fileBytes(formData));
  }
}

/** Borra la entrega `deliveryId` y, si era un PDF, su archivo. */
export async function deleteDeliveryAction(deliveryId: string): Promise<DeleteDeliveryActionResult> {
  await requireAdmin();
  const db = await getDb();
  return (await deleteDelivery(db, deliveryId)) ? { ok: true } : { ok: false, error: "not-found" };
}
