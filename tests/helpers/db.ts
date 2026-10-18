// Base de datos para los tests: PGlite en memoria con todas las migraciones
// aplicadas. Cada llamada devuelve una base nueva y vacía.
//
// Arrancar PGlite (el Postgres en WebAssembly) es lo que cuesta, medio segundo
// o más con la máquina cargada, y casi todos los tests piden una base propia. Por
// eso cada archivo de tests arranca y migra una sola vez una base "molde" y cada
// `createTestDb()` es una copia suya (`clone()`, bastante más barata que un
// arranque en frío). Las copias son independientes entre sí y del molde.

import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "@/db/client";
import { openPglite } from "@/db/pglite";
import * as schema from "@/db/schema";

/** El molde de este archivo de tests: PGlite con las migraciones aplicadas, sin datos. */
let migratedTemplate: Promise<PGlite> | undefined;

function template(): Promise<PGlite> {
  migratedTemplate ??= openPglite().then((db) => (db as unknown as { $client: PGlite }).$client);
  return migratedTemplate;
}

export async function createTestDb(): Promise<Db> {
  const copy = (await (await template()).clone()) as PGlite;
  return drizzle({ client: copy, schema });
}
