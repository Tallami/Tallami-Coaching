// Carga alumnos y ventas de ejemplo en la base local del panel, para ver el
// resumen con números, y los saca cuando ya no hacen falta. Solo local: se niega
// a correr si hay `DATABASE_URL` (la base de Supabase no es el lugar de los
// datos de ejemplo).
//
//   npm run db:seed:demo            # carga los datos de ejemplo
//   npm run db:seed:demo -- --clear # los borra, y nada más
//
// Usa la misma base que el panel sin `DATABASE_URL`: la carpeta de
// `PGLITE_DIR` o `.data/pglite`. Cargar es seguro de repetir: borra las filas de
// ejemplo de la vez anterior y las vuelve a cargar con las fechas de hoy. Las
// filas de ejemplo se reconocen por su id (alumnos y ventas tienen un principio
// de id que ninguna fila cargada a mano puede tener, y los clics en los botones
// de reserva viven en un rango de ids reservado); no toca lo que cargaste a mano.
// Si todavía no cargaste el monotributo, deja uno de ejemplo; si ya lo cargaste,
// lo respeta, y `--clear` no lo toca.
//
// `--clear` va en una transacción y nunca borra datos reales: si una venta tuya
// quedó atada a un alumno de ejemplo, ese alumno se queda (y el comando lo avisa).

import { and, eq, exists, gte, like, notExists, sql } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import {
  DEMO_CUSTOMER_ID_PREFIX,
  DEMO_MONOTRIBUTO_SETTINGS,
  DEMO_SALE_ID_PREFIX,
  buildDemoData,
} from "../src/admin/demo-data";
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

/** Se pasó una opción que el comando no conoce. */
export class SeedArgumentError extends Error {
  constructor(argument: string) {
    super(
      `El comando no conoce «${argument}». Sin opciones carga los datos de ejemplo; con --clear los borra de la base local.`,
    );
    this.name = "SeedArgumentError";
  }
}

export interface SeedArgs {
  /** Borrar los datos de ejemplo en lugar de cargarlos. */
  clear: boolean;
}

/** Lee las opciones del comando (lo que sigue al script en `process.argv`). Solo existe `--clear`. */
export function parseSeedArgs(args: readonly string[]): SeedArgs {
  const unknown = args.find((argument) => argument !== "--clear");
  if (unknown !== undefined) throw new SeedArgumentError(unknown);
  return { clear: args.includes("--clear") };
}

export interface SeedResult {
  customers: number;
  sales: number;
  interest: number;
}

export interface ClearResult extends SeedResult {
  /** Alumnos de ejemplo que se quedaron porque una venta real está atada a ellos. */
  keptCustomers: { id: string; name: string }[];
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const isDemoSale = like(sql`${sales.id}::text`, `${DEMO_SALE_ID_PREFIX}%`);
const isDemoCustomer = like(sql`${customers.id}::text`, `${DEMO_CUSTOMER_ID_PREFIX}%`);

/**
 * Saca de la base todo lo que es de ejemplo, dentro de la transacción que se
 * pasa: las ventas (antes que los alumnos, que las referencian), los clics del
 * rango reservado y los alumnos. Un alumno de ejemplo con una venta que no es de
 * ejemplo (cargada a mano) no se borra: queda en `keptCustomers`.
 */
async function removeDemoRows(tx: Tx): Promise<ClearResult> {
  const removedSales = await tx.delete(sales).where(isDemoSale).returning({ id: sales.id });
  const removedInterest = await tx
    .delete(interestEvents)
    .where(gte(interestEvents.id, DEMO_INTEREST_ID_BASE))
    .returning({ id: interestEvents.id });

  // Las ventas de ejemplo ya no están: las que quedan atadas a un alumno de ejemplo son tuyas.
  const hasSale = tx.select({ one: sql`1` }).from(sales).where(eq(sales.customerId, customers.id));
  const keptCustomers = await tx
    .select({ id: customers.id, name: customers.name })
    .from(customers)
    .where(and(isDemoCustomer, exists(hasSale)))
    .orderBy(customers.id);
  const removedCustomers = await tx
    .delete(customers)
    .where(and(isDemoCustomer, notExists(hasSale)))
    .returning({ id: customers.id });

  return {
    customers: removedCustomers.length,
    sales: removedSales.length,
    interest: removedInterest.length,
    keptCustomers,
  };
}

/**
 * Deja en la base los datos de ejemplo de `today`: primero saca los de una carga
 * anterior (de cualquier día) y después inserta todo, en una transacción. Un
 * alumno de ejemplo atado a una venta tuya se conserva y no se vuelve a crear.
 */
export async function seedDemo(db: Db, today: string): Promise<SeedResult> {
  const data = buildDemoData(today);

  await db.transaction(async (tx) => {
    await removeDemoRows(tx);
    await tx.insert(customers).values(data.customers).onConflictDoNothing();
    await tx.insert(sales).values(data.sales);
    await tx.insert(interestEvents).values(data.interest);
    await tx
      .insert(settings)
      .values({ key: MONOTRIBUTO_SETTING_KEY, value: DEMO_MONOTRIBUTO_SETTINGS })
      .onConflictDoNothing();
  });
  return { customers: data.customers.length, sales: data.sales.length, interest: data.interest.length };
}

/**
 * Borra los alumnos, las ventas y los clics de ejemplo de la base local, y nada
 * más (la configuración del monotributo queda como está), en una transacción: o
 * sale todo o no sale nada.
 */
export async function clearDemo(db: Db): Promise<ClearResult> {
  return db.transaction((tx) => removeDemoRows(tx));
}

function counted(amount: number, singular: string, plural: string): string {
  return `${amount} ${amount === 1 ? singular : plural}`;
}

/** Lo que `--clear` le cuenta a la persona, en español. */
export function describeClearResult(result: ClearResult): string {
  const { customers: removedCustomers, sales: removedSales, interest, keptCustomers } = result;
  if (removedCustomers === 0 && removedSales === 0 && interest === 0 && keptCustomers.length === 0) {
    return "No había datos de ejemplo en la base local: no se borró nada.";
  }
  const removed = `Listo: se borraron ${counted(removedSales, "venta", "ventas")}, ${counted(removedCustomers, "alumno", "alumnos")} y ${counted(interest, "clic", "clics")} de ejemplo de la base local.`;
  if (keptCustomers.length === 0) return removed;

  const names = keptCustomers.map(({ name }) => `«${name}»`).join(", ");
  const single = keptCustomers.length === 1;
  return `${removed} ${single ? "Quedó" : "Quedaron"} ${counted(keptCustomers.length, "alumno de ejemplo", "alumnos de ejemplo")} porque ${single ? "tiene" : "tienen"} ventas tuyas: ${names}. Pasá esas ventas a otro alumno (o cancelalas) y volvé a correr el comando para sacarlos.`;
}

/** Cierra la base si el driver lo permite, para que los datos queden escritos antes de salir. */
async function closeDb(db: Db): Promise<void> {
  const client = (db as unknown as { $client?: { close?: () => Promise<void> } }).$client;
  await client?.close?.();
}

async function main(): Promise<void> {
  assertLocalDatabase({ DATABASE_URL: getDatabaseUrl() });
  const { clear } = parseSeedArgs(process.argv.slice(2));
  const db = await getDb();
  try {
    if (clear) {
      process.stdout.write(`${describeClearResult(await clearDemo(db))}\n`);
      return;
    }
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
