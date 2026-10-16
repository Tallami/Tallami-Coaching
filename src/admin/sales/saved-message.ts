// El aviso que muestra la lista de ventas después de guardar una: la acción
// vuelve a `/admin/ventas?guardada=creada` (o `editada`) y la página lo escribe.
// Lo que llega de la dirección es texto del usuario: lo que no se reconoce no
// muestra nada.

import { firstValue } from "@/admin/ui/search-params";

/**
 * Los avisos por el valor de `?guardada=`. Es un `Map` y no un objeto: en un
 * objeto, `?guardada=__proto__` o `?guardada=constructor` devuelven algo del
 * prototipo (un objeto o una función) que React no puede mostrar, y la página
 * daba error 500.
 */
const SAVED_MESSAGES: ReadonlyMap<string, string> = new Map([
  ["creada", "Venta guardada."],
  ["editada", "Cambios guardados."],
]);

/** El aviso para el valor de `?guardada=`, o `undefined` si no hay nada que avisar. */
export function savedSaleMessage(param: string | string[] | undefined): string | undefined {
  return SAVED_MESSAGES.get(firstValue(param) ?? "");
}
