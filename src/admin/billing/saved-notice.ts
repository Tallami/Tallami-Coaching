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
