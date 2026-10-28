// Columna `bytea` (bytes crudos) para Drizzle, que no trae una propia. Los dos
// drivers que usa el proyecto la devuelven distinto: postgres.js (Supabase) un
// `Buffer` y PGlite (local y tests) un `Uint8Array`. Acá se normaliza todo a
// `Buffer`; al guardar, los dos aceptan un `Uint8Array` o un `Buffer` tal cual.
//
// Los bytes se copian al leer: PGlite puede devolver una vista sobre memoria que
// se reutiliza, y un archivo de hasta 4 MB se copia sin costo que importe.

import { customType } from "drizzle-orm/pg-core";

export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value)),
});
