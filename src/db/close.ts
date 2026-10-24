// Cerrar la base al terminar un comando (los scripts de `scripts/` y de los tests),
// para que todo quede escrito antes de salir. Cada driver lo hace a su manera:
// PGlite con `close()` y postgres.js con `end()`.

import type { Db } from "./client";

type Closable = { close?: () => Promise<void>; end?: () => Promise<void> };

/** Cierra la conexión de `db`, sea cual sea el driver. Si el driver no se puede cerrar, no hace nada. */
export async function closeDb(db: Db): Promise<void> {
  const client = (db as unknown as { $client?: Closable }).$client;
  await client?.close?.();
  await client?.end?.();
}
