// PGlite (Postgres dentro de Node) con las migraciones de `drizzle/` aplicadas.
// Lo usan `getDb()` en local (guardado en disco) y los tests (en memoria).
// Solo se importa dinámicamente, para que Vercel nunca cargue PGlite.

import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Db } from "./client";
import * as schema from "./schema";

/** Carpeta de las migraciones generadas por `npm run db:generate`. */
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * Abre PGlite y aplica las migraciones pendientes. Sin `dataDir` la base vive
 * en memoria y desaparece al terminar el proceso.
 */
export async function openPglite(dataDir?: string): Promise<Db> {
  const client = new PGlite(dataDir ? path.resolve(dataDir) : undefined);
  await client.waitReady;
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
