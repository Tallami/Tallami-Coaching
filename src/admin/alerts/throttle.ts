// Un tope de frecuencia para un aviso, compartido por todas las instancias y todas las
// conexiones: "a lo sumo uno cada tanto" decidido con UNA escritura condicional en la base
// (nada de leer y después escribir, que deja pasar a varios pedidos a la vez).
//
// Vive en una fila de la tabla `settings` (clave-valor, con RLS) y no en una tabla nueva:
// es una sola marca de hora por aviso, sin migración. `updated_at` de la fila es la hora
// del último aviso; el valor no se usa.

import { lte } from "drizzle-orm";
import type { Db } from "../../db/client";
import { settings } from "../../db/schema";

/**
 * Pide el lugar `key`: devuelve `true` si el aviso puede salir ahora (nunca salió, o el
 * último salió hace `windowMs` o más), y en ese caso lo deja anotado a la hora `now`. De
 * varios pedidos simultáneos, uno solo recibe `true`: el `INSERT … ON CONFLICT DO UPDATE
 * … WHERE` toma el bloqueo de la fila y el que llega segundo ve la hora ya escrita, no
 * cumple el `WHERE` y no devuelve fila.
 */
export async function claimAlertSlot(
  db: Db,
  key: string,
  windowMs: number,
  now: Date = new Date(),
): Promise<boolean> {
  const claimed = await db
    .insert(settings)
    .values({ key, value: {}, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { updatedAt: now },
      setWhere: lte(settings.updatedAt, new Date(now.getTime() - windowMs)),
    })
    .returning({ key: settings.key });
  return claimed.length > 0;
}
