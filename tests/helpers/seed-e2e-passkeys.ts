// Registra las llaves de prueba de los e2e (las de los slots 0 a 31 de
// `testPasskey`, ver `webauthn.ts`) en la base local de un servidor de prueba, la
// carpeta de `PGLITE_DIR`. Lo corre el `webServer.command` de `playwright.config.ts`
// y `playwright.demo.config.ts` antes de `npm run start` (PGlite no admite dos
// procesos a la vez en la misma carpeta). Así los tests entran con contraseña y
// llave como Tallami, sin pasar cada uno por "registrar la primera llave".
//
// Solo para la base de un servidor de prueba: se niega con `DATABASE_URL` (una base
// remota) y sin `PGLITE_DIR` (sería la base local de desarrollo, `.data/pglite`).
// Repetirlo no duplica nada: una llave que ya está no se vuelve a guardar.

import { pathToFileURL } from "node:url";
import { findPasskeyByCredentialId, insertPasskey } from "../../src/admin/auth/passkeys";
import { getDb, type Db } from "../../src/db/client";
import { getDatabaseUrl } from "../../src/db/config";
import { SEEDED_SLOTS, testPasskey } from "./webauthn";

/** Guarda las llaves de prueba que falten y dice cuántas guardó. */
export async function seedE2ePasskeys(db: Db): Promise<number> {
  let added = 0;
  for (let slot = 0; slot < SEEDED_SLOTS; slot += 1) {
    const passkey = testPasskey(slot);
    if (await findPasskeyByCredentialId(db, passkey.credentialId)) continue;
    await insertPasskey(
      db,
      {
        credentialId: passkey.credentialId,
        publicKey: passkey.publicKeyCose,
        counter: 0,
        transports: ["internal"],
        name: `Llave de prueba ${slot}`,
      },
      { onlyIfNone: false },
    );
    added += 1;
  }
  return added;
}

/** Tira si el entorno no es el de un servidor de prueba. */
export function assertTestDatabase(env: { DATABASE_URL?: string; PGLITE_DIR?: string }): void {
  if (env.DATABASE_URL?.trim()) {
    throw new Error("Las llaves de prueba no se cargan con DATABASE_URL definida: son solo para la base de un servidor de prueba.");
  }
  if (!env.PGLITE_DIR?.trim()) {
    throw new Error("Falta PGLITE_DIR: las llaves de prueba van en la base de un servidor de prueba, nunca en la de desarrollo.");
  }
}

/** Cierra la base si el driver lo permite, para que los datos queden escritos antes de salir. */
async function closeDb(db: Db): Promise<void> {
  const client = (db as unknown as { $client?: { close?: () => Promise<void> } }).$client;
  await client?.close?.();
}

async function main(): Promise<void> {
  assertTestDatabase({ DATABASE_URL: getDatabaseUrl(), PGLITE_DIR: process.env.PGLITE_DIR });
  const db = await getDb();
  try {
    const added = await seedE2ePasskeys(db);
    process.stdout.write(`Llaves de prueba de los e2e: ${added} nuevas (${SEEDED_SLOTS} en total).\n`);
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
