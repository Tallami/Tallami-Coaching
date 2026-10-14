// Base de datos para los tests: PGlite en memoria con todas las migraciones
// aplicadas. Cada llamada devuelve una base nueva y vacía.

import type { Db } from "@/db/client";
import { openPglite } from "@/db/pglite";

export function createTestDb(): Promise<Db> {
  return openPglite();
}
