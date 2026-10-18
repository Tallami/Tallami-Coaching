// Cuando una descarga CSV no se puede armar, la ruta no contesta un texto suelto:
// manda de vuelta a la pantalla de donde salió (Ventas o Facturación), que lo
// avisa en español dentro del panel. Acá están el parámetro de la dirección
// (`?exportacion=…`) y los avisos que le corresponden.
//
// Todo lo que llega de la dirección es texto del usuario: los avisos se buscan
// en un `Map` y lo que no se reconoce no muestra nada.

import { firstValue } from "@/admin/ui/search-params";

/** Nombre del parámetro de la dirección que dice por qué no hubo archivo. */
export const EXPORT_PARAM = "exportacion";

/** Por qué no hubo archivo: demasiadas ventas para uno solo, o un fallo inesperado. */
export type ExportFailure = "demasiadas" | "error";

const NOTICES: ReadonlyMap<string, string> = new Map<ExportFailure, string>([
  ["demasiadas", "Hay demasiadas ventas para un solo archivo. Acotá las fechas y probá de nuevo."],
  ["error", "No pudimos preparar el archivo. Probá de nuevo en unos minutos."],
]);

/** El aviso para el valor de `?exportacion=`, o `null` si no hay nada que avisar. */
export function exportErrorNotice(value: string | string[] | undefined): string | null {
  return NOTICES.get(firstValue(value) ?? "") ?? null;
}

/**
 * La dirección a la que vuelve una descarga que falló: la pantalla de origen, con
 * sus filtros (`query`, que ya empieza con `?` o está vacía) y el motivo.
 */
export function exportFailurePath(basePath: string, query: string, failure: ExportFailure): string {
  const params = new URLSearchParams(query);
  params.set(EXPORT_PARAM, failure);
  return `${basePath}?${params.toString()}`;
}
