"use client";

import { useEffect } from "react";

/**
 * Saca de la barra de direcciones el token de la invitación (`?invitacion=<token>`), que el
 * servidor ya leyó y dejó solo en los links de los botones de ingreso. Así no queda a la vista en la
 * barra, en una captura de pantalla ni en lo que se copia al compartir la pantalla.
 *
 * `replaceState` reescribe la entrada actual del historial de la sesión (no agrega otra), pero el
 * navegador puede conservar la dirección original en su historial de páginas visitadas. No es un
 * secreto que tenga que sobrevivir ahí: la invitación se usa una sola vez y en la base solo queda su hash.
 *
 * Se pasa `null` como estado: Next pisa `history.replaceState` y, con un estado propio de la
 * página, sincroniza su router con la dirección nueva. Solo se quita `invitacion`; lo demás de la
 * dirección se conserva.
 */
export function StripInviteFromUrl() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("invitacion")) return;
    url.searchParams.delete("invitacion");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return null;
}
