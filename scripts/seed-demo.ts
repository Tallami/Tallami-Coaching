// Carga alumnos y ventas de ejemplo en la base local del panel, para ver el
// resumen con números. Solo local: se niega a correr si hay `DATABASE_URL`
// (la base de Supabase no es el lugar de los datos de ejemplo).
//
//   npm run db:seed:demo
//
// Usa la misma base que el panel sin `DATABASE_URL`: la carpeta de
// `PGLITE_DIR` o `.data/pglite`. Es seguro repetirlo: borra las filas de
// ejemplo de la vez anterior (se reconocen por su id: alumnos, ventas y clics en
// los botones de reserva) y las vuelve a cargar con las fechas de hoy; no toca lo que cargaste a mano. Si todavía no cargaste el
// monotributo, deja uno de ejemplo; si ya lo cargaste, lo respeta.

import { gte, inArray } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { DEMO_MONOTRIBUTO_SETTINGS, buildDemoData } from "../src/admin/demo-data";
import { DEMO_INTEREST_ID_BASE } from "../src/admin/demo-interest";
import { todayInArgentina } from "../src/admin/dates";
import { MONOTRIBUTO_SETTING_KEY } from "../src/admin/settings/read";
import { getDb, type Db } from "../src/db/client";
import { getDatabaseUrl } from "../src/db/config";
import { customers, interestEvents, sales, settings } from "../src/db/schema";

/** Se intentó cargar los datos de ejemplo en una base que no es la local. */
export class DemoSeedRefusedError extends Error {
  constructor() {
    super(
      "No se cargan datos de ejemplo con DATABASE_URL definida: son solo para la base local. Quitá DATABASE_URL de este entorno y volvé a intentar.",
    );
    this.name = "DemoSeedRefusedError";
  }
}

/** Tira `DemoSeedRefusedError` si el entorno apunta a una base remota. */
export function assertLocalDatabase(env: { DATABASE_URL?: string }): void {
  if (env.DATABASE_URL?.trim()) throw new DemoSeedRefusedError();
}

export interface SeedResult {
  customers: number;
  sales: number;
  interest: number;
}

/**
 * Deja en la base los datos de ejemplo de `today`: primero borra los de una
 * carga anterior (las ventas antes que los alumnos, que las referencian) y
 * después inserta todo en una transacción.
 */
export async function seedDemo(db: Db, today: string): Promise<SeedResult> {
  const data = buildDemoData(today);
  const customerIds = data.customers.map((customer) => customer.id);
  const saleIds = data.sales.map((sale) => sale.id);

  await db.transaction(async (tx) => {
    await tx.delete(sales).where(inArray(sales.id, saleIds));
    await tx.delete(customers).where(inArray(customers.id, customerIds));
    await tx.insert(customers).values(data.customers);
    await tx.insert(sales).values(data.sales);
    // Los clics de ejemplo viven en un rango de ids reservado: no se pisan con los reales.
    await tx.delete(interestEvents).where(gte(interestEvents.id, DEMO_INTEREST_ID_BASE));
    await tx.insert(interestEvents).values(data.interest);
    await tx
      .insert(settings)
      .values({ key: MONOTRIBUTO_SETTING_KEY, value: DEMO_MONOTRIBUTO_SETTINGS })
      .onConflictDoNothing();
  });
  return { customers: data.customers.length, sales: data.sales.length, interest: data.interest.length };
}

/** Cierra la base si el driver lo permite, para que los datos queden escritos antes de salir. */
async function closeDb(db: Db): Promise<void> {
  const client = (db as unknown as { $client?: { close?: () => Promise<void> } }).$client;
  await client?.close?.();
}

async function main(): Promise<void> {
  assertLocalDatabase({ DATABASE_URL: getDatabaseUrl() });
  const db = await getDb();
  try {
    const result = await seedDemo(db, todayInArgentina());
    process.stdout.write(
      `Listo: ${result.customers} alumnos, ${result.sales} ventas y ${result.interest} clics de ejemplo en la base local.\n`,
    );
  } finally {
    await closeDb(db);
  }
}

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
