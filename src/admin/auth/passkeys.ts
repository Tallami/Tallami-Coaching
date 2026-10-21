// Las llaves de acceso (passkeys) registradas, guardadas en `admin_passkeys`.
// Acá solo se lee y se escribe la tabla; qué se le pide al navegador y cómo se
// verifica lo que contesta está en `ceremonies.ts`.
//
// Dos reglas viven acá porque hay que comprobarlas en la base y no en la app:
//
// - la primera llave se registra una sola vez (`insertPasskey` con `onlyIfNone`):
//   dos registros simultáneos de "primera llave" no pueden sumar dos;
// - la última llave no se puede borrar (`deletePasskeyUnlessLast`): quedaría el
//   panel en "solo contraseña".
//
// Las dos cuentan las llaves y después escriben, y entre una cosa y la otra puede
// colarse otro pedido. Por eso corren en una transacción que primero toma un
// bloqueo de aviso (`pg_advisory_xact_lock`): el segundo pedido espera a que el
// primero termine y recién ahí cuenta, ya con la llave del primero a la vista. El
// bloqueo se suelta solo al cerrar la transacción. PGlite (un solo hilo) ya
// serializa las transacciones; el bloqueo es el que protege en Supabase.

import { and, asc, count, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { adminPasskeys } from "../../db/schema";
import type { NewPasskeyData } from "./ceremonies";

/**
 * El número del bloqueo de aviso de las llaves. Es un número cualquiera: solo
 * tiene que ser siempre el mismo, y distinto de los de otros bloqueos de aviso de
 * esta base (el de los códigos para otro dispositivo es otro). Cabe en un bigint.
 */
const PASSKEY_LOCK_ID = 7_410_210_001;

/** Una llave registrada, tal como la ve el resto del panel. */
export type Passkey = {
  id: string;
  /** El id de la credencial, en base64url. */
  credentialId: string;
  /** La clave pública (COSE), en base64url. */
  publicKey: string;
  counter: number;
  transports: string[];
  name: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

const PASSKEY_COLUMNS = {
  id: adminPasskeys.id,
  credentialId: adminPasskeys.credentialId,
  publicKey: adminPasskeys.publicKey,
  counter: adminPasskeys.counter,
  transports: adminPasskeys.transports,
  name: adminPasskeys.name,
  createdAt: adminPasskeys.createdAt,
  lastUsedAt: adminPasskeys.lastUsedAt,
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Las llaves, la más vieja primero. */
export async function listPasskeys(db: Db): Promise<Passkey[]> {
  return db.select(PASSKEY_COLUMNS).from(adminPasskeys).orderBy(asc(adminPasskeys.createdAt), asc(adminPasskeys.id));
}

export async function countPasskeys(db: Db): Promise<number> {
  const [row] = await db.select({ total: count() }).from(adminPasskeys);
  return row?.total ?? 0;
}

/** La llave con ese id de credencial, o `null`. */
export async function findPasskeyByCredentialId(db: Db, credentialId: string): Promise<Passkey | null> {
  const [passkey] = await db
    .select(PASSKEY_COLUMNS)
    .from(adminPasskeys)
    .where(eq(adminPasskeys.credentialId, credentialId));
  return passkey ?? null;
}

/**
 * Guarda una llave nueva y la devuelve. Con `onlyIfNone` solo la guarda si no
 * hay ninguna (la "primera llave"): si ya hay alguna devuelve `null` y no escribe
 * nada. El nombre lo valida la base (de 1 a 40 caracteres) y una credencial que
 * ya existe también: en los dos casos tira.
 */
export async function insertPasskey(
  db: Db,
  input: NewPasskeyData & { name: string },
  { onlyIfNone }: { onlyIfNone: boolean },
): Promise<Passkey | null> {
  const values = {
    credentialId: input.credentialId,
    publicKey: input.publicKey,
    counter: input.counter,
    transports: input.transports,
    name: input.name,
  };
  if (!onlyIfNone) {
    const [passkey] = await db.insert(adminPasskeys).values(values).returning(PASSKEY_COLUMNS);
    return passkey;
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(PASSKEY_LOCK_ID))})`);
    const [existing] = await tx.select({ total: count() }).from(adminPasskeys);
    if ((existing?.total ?? 0) > 0) return null;
    const [passkey] = await tx.insert(adminPasskeys).values(values).returning(PASSKEY_COLUMNS);
    return passkey;
  });
}

/** Le cambia el nombre. Devuelve `false` si la llave no existe. El largo del nombre lo valida la base. */
export async function renamePasskey(db: Db, id: string, name: string): Promise<boolean> {
  if (!UUID_PATTERN.test(id)) return false;
  const renamed = await db
    .update(adminPasskeys)
    .set({ name })
    .where(eq(adminPasskeys.id, id))
    .returning({ id: adminPasskeys.id });
  return renamed.length > 0;
}

/**
 * Borra la llave, salvo que sea la última: `"last"` y no se toca nada. `"missing"`
 * si no existe. Las sesiones que se abrieron con ella quedan sin llave
 * (`on delete set null`); cerrarlas es cosa de quien llama.
 */
export async function deletePasskeyUnlessLast(db: Db, id: string): Promise<"deleted" | "last" | "missing"> {
  if (!UUID_PATTERN.test(id)) return "missing";
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(String(PASSKEY_LOCK_ID))})`);
    const [target] = await tx.select({ id: adminPasskeys.id }).from(adminPasskeys).where(eq(adminPasskeys.id, id));
    if (!target) return "missing";
    const [existing] = await tx.select({ total: count() }).from(adminPasskeys);
    if ((existing?.total ?? 0) <= 1) return "last";
    await tx.delete(adminPasskeys).where(eq(adminPasskeys.id, id));
    return "deleted";
  });
}

/**
 * Anota un uso de la llave: el contador que informó el dispositivo y la hora. El
 * contador solo sube: si otro ingreso ya anotó uno mayor, este no lo baja.
 */
export async function recordPasskeyUse(
  db: Db,
  id: string,
  newCounter: number,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(adminPasskeys)
    .set({ counter: newCounter, lastUsedAt: now })
    .where(and(eq(adminPasskeys.id, id), lte(adminPasskeys.counter, newCounter)));
}
