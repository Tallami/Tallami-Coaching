// A dónde se vuelve después de entrar, sin los avisos de un solo uso. Después de guardar, algunas pantallas
// quedan en una dirección con un parámetro que solo dice «recién guardaste» (`/admin/configuracion?guardada=1`).
// Si la sesión termina ahí y se vuelve a esa dirección, el aviso de «guardada» se vería sobre datos que no se
// guardaron (un formulario que recuperó lo escrito). Esos parámetros no viajan en el `next`.
//
// Lo usan quien arma el `next` en el servidor (el `Referer` en `referer.ts`, la dirección pedida en el `proxy`) y el
// navegador, para anotar en qué página escribió un borrador: las dos puntas tienen que dar el mismo resultado.

import { safeNextPath } from "./redirect";

/**
 * Los parámetros de aviso que las acciones del panel dejan en la dirección al terminar: `guardada` (Ventas,
 * Facturación, Configuración), `guardado` (ficha del alumno), `cantidad` (cuántas ventas marcó Facturación) y
 * `exportacion` (por qué no hubo archivo, en Ventas y Facturación).
 */
export const ONE_SHOT_PARAMS = ["guardada", "guardado", "cantidad", "exportacion"] as const;

/**
 * `?factura=` es el aviso de la ficha de una venta (`/admin/ventas/<id>`, al volverla a pendiente), pero en la
 * lista de ventas es un filtro de verdad (`?factura=issued`): solo es de un solo uso en la ficha.
 */
const SALE_PAGE_ONE_SHOT_PARAMS = ["factura"] as const;
const SALE_PAGE = /^\/admin\/ventas\/[^/]+\/?$/;

/** Origen inventado: sirve para que `URL` separe la ruta de la búsqueda. */
const PLACEHOLDER_ORIGIN = "http://panel.invalid";

/**
 * La ruta con su búsqueda sin los parámetros de aviso. Lo que no tiene ninguno vuelve idéntico, y lo que no es una
 * ruta del sitio también (le toca a `safeNextPath` descartarlo).
 */
export function dropOneShotParams(pathWithSearch: string): string {
  if (!pathWithSearch.startsWith("/") || pathWithSearch.startsWith("//") || pathWithSearch.includes("\\")) {
    return pathWithSearch;
  }
  let url: URL;
  try {
    url = new URL(pathWithSearch, PLACEHOLDER_ORIGIN);
  } catch {
    // Una dirección que `URL` no entiende no es una ruta: queda como está y `safeNextPath` la descarta.
    return pathWithSearch;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return pathWithSearch;

  const flags = SALE_PAGE.test(url.pathname) ? [...ONE_SHOT_PARAMS, ...SALE_PAGE_ONE_SHOT_PARAMS] : ONE_SHOT_PARAMS;
  if (!flags.some((flag) => url.searchParams.has(flag))) return pathWithSearch;
  for (const flag of flags) url.searchParams.delete(flag);
  return `${url.pathname}${url.search}`;
}

/** `safeNextPath` de la dirección sin sus parámetros de aviso: a dónde volver, y la página de un borrador. */
export function returnPath(raw: unknown): string {
  return safeNextPath(typeof raw === "string" ? dropOneShotParams(raw) : raw);
}
