// De qué página del panel vino un pedido. Cuando la sesión terminó en medio de una acción, el
// único dato de «dónde estaba la persona» es el `Referer` del pedido: para un Server Action es la
// página del formulario.

/**
 * La ruta (con su búsqueda) de la página que hizo el pedido, solo si es de este mismo sitio; si
 * viene de afuera, no viene, o no se puede comparar, `undefined`. No decide si la ruta es del
 * panel: eso lo hace `safeNextPath` cuando se arma la dirección del login.
 *
 * Se compara el host con el que se pidió (`x-forwarded-host` detrás de un proxy, `host` si no).
 */
export function sameOriginReferer(headers: Headers): string | undefined {
  const raw = headers.get("referer");
  const host = (headers.get("x-forwarded-host") ?? headers.get("host"))?.split(",")[0]?.trim();
  if (!raw || !host) return undefined;

  let referer: URL;
  try {
    referer = new URL(raw);
  } catch {
    // Un `Referer` que no es una dirección completa no sirve para saber de dónde vino.
    return undefined;
  }
  if (referer.host !== host) return undefined;
  return `${referer.pathname}${referer.search}`;
}
