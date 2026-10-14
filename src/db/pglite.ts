// PGlite (Postgres dentro de Node) con las migraciones de `drizzle/` aplicadas.
// Lo usan `getDb()` en local (guardado en disco) y los tests (en memoria).
// Solo se importa dinámicamente, para que Vercel nunca cargue PGlite.

import { mkdir } from "node:fs/promises";
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
  const resolvedDir = dataDir ? path.resolve(dataDir) : undefined;
  if (resolvedDir) {
    // PGlite crea la carpeta de datos pero no sus carpetas madre: en un clon
    // nuevo `.data/` (gitignored) no existe y `.data/pglite` fallaría con ENOENT.
    await mkdir(path.dirname(resolvedDir), { recursive: true });
  }
  const client = new PGlite(resolvedDir);
  await client.waitReady;
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
