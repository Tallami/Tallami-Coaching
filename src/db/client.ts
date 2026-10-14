// Conexión a la base del panel. Un solo `getDb()` para todo el código, con el
// driver según el entorno:
//
// - con `DATABASE_URL` (Supabase, pooler de transacciones): postgres.js con
//   `prepare: false`, porque ese pooler no soporta sentencias preparadas;
// - sin `DATABASE_URL` y fuera de Vercel: PGlite en disco, para usar y
//   desarrollar el panel sin cuentas;
// - en Vercel sin `DATABASE_URL`: `DbNotConfiguredError`, nunca PGlite (el
//   disco de Vercel no persiste y los datos se perderían sin avisar).
//
// Los tests no pasan por acá: usan `createTestDb()` (PGlite en memoria).

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getDatabaseUrl, isDbConfigured } from "./config";
import * as schema from "./schema";

/** Base de datos con el schema del panel, sea cual sea el driver. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Carpeta de PGlite cuando no se define `PGLITE_DIR`. */
const DEFAULT_PGLITE_DIR = ".data/pglite";

/** La app corre en Vercel y falta `DATABASE_URL`. */
export class DbNotConfiguredError extends Error {
  constructor() {
    super("Falta configurar DATABASE_URL: en Vercel no se usa la base local.");
    this.name = "DbNotConfiguredError";
  }
}

// El singleton vive en `globalThis` para que el modo desarrollo (que recarga
// los módulos) no abra otra conexión, o no intente abrir de nuevo la misma
// carpeta de PGlite, en cada edición.
const globalForDb = globalThis as typeof globalThis & {
  __tallamiDb?: Promise<Db>;
};

async function openDb(): Promise<Db> {
  const url = getDatabaseUrl();
  if (url) {
    return drizzle(postgres(url, { prepare: false }), { schema });
  }
  if (!isDbConfigured()) {
    throw new DbNotConfiguredError();
  }
  const { openPglite } = await import("./pglite");
  return openPglite(process.env.PGLITE_DIR || DEFAULT_PGLITE_DIR);
}

/** La base del panel; se abre una vez por proceso. */
export function getDb(): Promise<Db> {
  if (!globalForDb.__tallamiDb) {
    const opening = openDb();
    globalForDb.__tallamiDb = opening;
    // Si falla (por ejemplo, sin configurar) no se guarda el fallo: el
    // próximo pedido vuelve a intentar en vez de repetir el mismo error.
    opening.catch(() => {
      if (globalForDb.__tallamiDb === opening) globalForDb.__tallamiDb = undefined;
    });
  }
  return globalForDb.__tallamiDb;
}
