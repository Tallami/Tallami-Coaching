// Validación de "marcar como facturadas" (zod). La entrada es la del
// formulario: ids de ventas y texto. Los mensajes están en español, listos
// para mostrar debajo de cada campo.
//
// La fecha de la factura solo se revisa que sea un día real entre 2000 y 2100
// (Chrome vuelve "26" el año 0026). No se compara con la fecha de cobro: una
// factura puede emitirse antes de cobrar (por adelantado) o después, así que
// ninguna de las dos órdenes es un error.

import { z } from "zod";
import { INVOICE_TYPES } from "@/admin/catalog";
import { isPlausibleDay } from "@/admin/dates";
import { stripNul } from "@/admin/text";
import { isUuid } from "@/db/uuid";

/** Ventas que se marcan de una vez: las que muestra la lista de pendientes como mucho. */
export const MAX_INVOICE_BATCH = 1000;
/** El número de una factura de ARCA ("00003-00000045") mide 14; este margen alcanza para cualquier formato. */
export const MAX_INVOICE_NUMBER_LENGTH = 30;

const MESSAGES = {
  ids: "Elegí al menos una venta.",
  idsInvalid: "Alguna de las ventas elegidas no es válida. Recargá la página y elegilas de nuevo.",
  idsTooMany: `Elegiste demasiadas ventas: marcá hasta ${MAX_INVOICE_BATCH} por vez.`,
  type: "Elegí el tipo de factura, C o E.",
  number: "Escribí el número de la factura.",
  numberTooLong: `El número es demasiado largo (máximo ${MAX_INVOICE_NUMBER_LENGTH} caracteres).`,
  dateRequired: "Cargá la fecha de la factura.",
  dateInvalid: "La fecha no es válida.",
} as const;

/** Los ids de las ventas elegidas, en minúscula y sin repetir. */
export const invoiceIdsSchema = z
  .array(
    z.string({ error: MESSAGES.idsInvalid }).refine(isUuid, { error: MESSAGES.idsInvalid }),
    { error: MESSAGES.ids },
  )
  .min(1, MESSAGES.ids)
  .max(MAX_INVOICE_BATCH, MESSAGES.idsTooMany)
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]);

const typeField = z.enum(INVOICE_TYPES, { error: MESSAGES.type });

const numberField = z
  .string({ error: MESSAGES.number })
  .overwrite(stripNul)
  .trim()
  .min(1, MESSAGES.number)
  .max(MAX_INVOICE_NUMBER_LENGTH, MESSAGES.numberTooLong);

const issuedOnField = z
  .string({ error: MESSAGES.dateRequired })
  .overwrite(stripNul)
  .trim()
  .superRefine((value, ctx) => {
    if (value === "") {
      ctx.addIssue({ code: "custom", message: MESSAGES.dateRequired });
    } else if (!isPlausibleDay(value)) {
      ctx.addIssue({ code: "custom", message: MESSAGES.dateInvalid });
    }
  });

/** Marcar como facturadas: las ventas y los datos de la factura. */
export const markInvoicedSchema = z.object({
  ids: invoiceIdsSchema,
  type: typeField,
  number: numberField,
  issuedOn: issuedOnField,
});

/** Marcar como "no requiere factura": solo las ventas. */
export const markNotRequiredSchema = z.object({ ids: invoiceIdsSchema });
