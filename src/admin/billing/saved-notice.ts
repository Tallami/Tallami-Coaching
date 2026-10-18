// El aviso que deja la pantalla de Facturación después de marcar ventas: la
// acción redirige a `/admin/facturacion?guardada=facturadas&cantidad=2` y la
// página lo escribe. Todo lo que llega de la dirección es texto del usuario: lo
// que no se reconoce no muestra nada.

import { firstValue, type SearchParams } from "@/admin/ui/search-params";

/** Hasta 4 dígitos: alcanza para el máximo de un lote (1000). */
const COUNT = /^\d{1,4}$/;

function countFrom(value: string | undefined): number | null {
  if (!value || !COUNT.test(value)) return null;
  const count = Number(value);
  return count > 0 ? count : null;
}

/** La dirección a la que vuelve la acción después de marcar `updated` ventas. */
export function invoicingResultPath(intent: "invoiced" | "not_required", updated: number): string {
  const kind = intent === "invoiced" ? "facturadas" : "sin-factura";
  return `/admin/facturacion?guardada=${kind}&cantidad=${updated}`;
}

/** El aviso para los parámetros de la dirección, o `null` si no hay nada que avisar. */
export function invoicingNotice(params: SearchParams): string | null {
  const kind = firstValue(params.guardada);
  const count = countFrom(firstValue(params.cantidad));
  if (kind === "facturadas") {
    if (count === null) return "Ventas marcadas como facturadas.";
    return count === 1 ? "1 venta marcada como facturada." : `${count} ventas marcadas como facturadas.`;
  }
  if (kind === "sin-factura") {
    if (count === null) return "Ventas marcadas como «No requiere factura».";
    return count === 1
      ? "1 venta marcada como «No requiere factura»."
      : `${count} ventas marcadas como «No requiere factura».`;
  }
  return null;
}

/** Qué pasó al volver una venta a pendiente: lo que lleva la dirección de la ficha de la venta. */
export type InvoiceUndoOutcome = "done" | "refused" | "not-collected";

export interface InvoiceUndoNotice {
  tone: "ok" | "error";
  text: string;
}

/**
 * Los avisos de la ficha de la venta, por el valor de `?factura=`. Es un `Map`:
 * lo que llega de la dirección es texto del usuario y `__proto__` o
 * `constructor` no tienen que encontrar nada.
 */
const UNDO_NOTICES: ReadonlyMap<string, InvoiceUndoNotice> = new Map([
  [
    "pendiente",
    {
      tone: "ok",
      text: "La venta volvió a pendiente y ya no tiene los datos de la factura. Marcala de nuevo en Facturación cuando corresponda.",
    },
  ],
  [
    "no-se-pudo",
    {
      tone: "error",
      text: "La venta no tenía factura para quitar: ya estaba pendiente o no existe.",
    },
  ],
  [
    "no-cobrada",
    {
      tone: "error",
      text: "La factura se queda como está: para volverla a pendiente la venta tiene que estar cobrada o entregada. Si ya la emitiste en ARCA, anularla es con una nota de crédito, que se hace en ARCA.",
    },
  ],
]);

const UNDO_PARAM_BY_OUTCOME: Record<InvoiceUndoOutcome, string> = {
  done: "pendiente",
  refused: "no-se-pudo",
  "not-collected": "no-cobrada",
};

/** La dirección de la venta `id` a la que vuelve la acción de volver a pendiente. */
export function invoiceUndoPath(id: string, outcome: InvoiceUndoOutcome): string {
  return `/admin/ventas/${id}?factura=${UNDO_PARAM_BY_OUTCOME[outcome]}`;
}

/** El aviso de la ficha de la venta para los parámetros de la dirección, o `null` si no hay nada que avisar. */
export function invoiceUndoNotice(params: SearchParams): InvoiceUndoNotice | null {
  return UNDO_NOTICES.get(firstValue(params.factura) ?? "") ?? null;
}
