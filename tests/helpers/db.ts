// Base de datos para los tests: PGlite en memoria con todas las migraciones
// aplicadas. Cada llamada devuelve una base nueva y vacía.
//
// Arrancar PGlite (el Postgres en WebAssembly) es lo que cuesta, medio segundo
// o más con la máquina cargada, y casi todos los tests piden una base propia. Por
// eso cada archivo de tests arranca y migra una sola vez una base "molde" y cada
// `createTestDb()` es una copia suya (`clone()`, bastante más barata que un
// arranque en frío). Las copias son independientes entre sí y del molde.

import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "@/db/client";
import { openPglite } from "@/db/pglite";
import * as schema from "@/db/schema";

/** El molde de este archivo de tests: PGlite con las migraciones aplicadas, sin datos. */
let migratedTemplate: Promise<PGlite> | undefined;

function template(): Promise<PGlite> {
  if (!migratedTemplate) {
    const opening = openPglite().then((db) => (db as unknown as { $client: PGlite }).$client);
    migratedTemplate = opening;
    // Si falla no se guarda el fallo: el próximo test vuelve a intentar en vez de repetir el mismo error.
    opening.catch(() => {
      if (migratedTemplate === opening) migratedTemplate = undefined;
    });
  }
  return migratedTemplate;
}

export async function createTestDb(): Promise<Db> {
  const copy = (await (await template()).clone()) as PGlite;
  return drizzle({ client: copy, schema });
}

/**
 * Una llave de acceso mínima en la base, y su id. Toda sesión se abre con una llave
 * (`createSession` la pide), así que los tests que necesitan una sesión sin importarles
 * la llave usan esta.
 */
export async function insertTestPasskey(db: Db, credentialId: string = randomUUID()): Promise<string> {
  const [row] = await db
    .insert(schema.adminPasskeys)
    .values({ credentialId, publicKey: "clave-publica", name: "Llave de prueba" })
    .returning({ id: schema.adminPasskeys.id });
  return row.id;
}
