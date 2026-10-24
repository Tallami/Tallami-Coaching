// Registra las llaves de prueba de los e2e (las de los slots 0 a 31 de
// `testPasskey`, ver `webauthn.ts`) en la base local de un servidor de prueba, la
// carpeta de `PGLITE_DIR`. Lo corre el `webServer.command` de `playwright.config.ts`
// y `playwright.demo.config.ts` antes de `npm run start` (PGlite no admite dos
// procesos a la vez en la misma carpeta). Así los tests entran con contraseña y
// llave como Tallami, sin pasar cada uno por "registrar la primera llave".
//
// Solo para la base de un servidor de prueba. Las claves privadas de estas llaves salen de
// un texto público (`webauthn.ts`): cualquier base que las tenga se abre con solo conocer
// ese texto, así que el comando se niega con `DATABASE_URL` (una base remota), sin
// `PGLITE_DIR` (sería la base local de desarrollo, `.data/pglite`) y con una carpeta que no
// esté dentro de la carpeta temporal del sistema, que es donde viven todas las bases de los e2e
// (`admin-server.ts`); la comparación es entre rutas reales, así que un enlace dentro de esa
// carpeta que lleva a otro lado tampoco pasa. Repetirlo no duplica nada: una llave que ya está no se vuelve a guardar.

import { lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findPasskeyByCredentialId, insertPasskey } from "../../src/admin/auth/passkeys";
import { getDb, type Db } from "../../src/db/client";
import { closeDb } from "../../src/db/close";
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

/**
 * La ruta real de `target`: sigue los enlaces del tramo que ya existe y deja igual el resto, que
 * todavía no existe y por eso no puede ser un enlace (la base lo crea al abrirse). Tira si el tramo
 * que existe no se puede resolver (por ejemplo, un enlace que lleva a una carpeta que no está).
 */
function realPathOf(target: string): string {
  const absolute = path.resolve(target);
  let existing = absolute;
  const missing: string[] = [];
  // `lstat` y no `existsSync`: un enlace roto existe aunque lo que apunta no.
  while (lstatSync(existing, { throwIfNoEntry: false }) === undefined) {
    const parent = path.dirname(existing);
    if (parent === existing) return absolute;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(realpathSync(existing), ...missing);
}

/** `child` está estrictamente dentro de `parent` (no es el mismo y no sale de él con `..`), comparando rutas reales. */
function isStrictlyInside(parent: string, child: string): boolean {
  let relative: string;
  try {
    relative = path.relative(realPathOf(parent), realPathOf(child));
  } catch {
    return false;
  }
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Tira si el entorno no es el de un servidor de prueba. */
export function assertTestDatabase(env: { DATABASE_URL?: string; PGLITE_DIR?: string }): void {
  if (env.DATABASE_URL?.trim()) {
    throw new Error("Las llaves de prueba no se cargan con DATABASE_URL definida: son solo para la base de un servidor de prueba.");
  }
  const folder = env.PGLITE_DIR?.trim();
  if (!folder) {
    throw new Error("Falta PGLITE_DIR: las llaves de prueba van en la base de un servidor de prueba, nunca en la de desarrollo.");
  }
  if (!isStrictlyInside(os.tmpdir(), folder)) {
    throw new Error(
      `PGLITE_DIR (${folder}) no está dentro de la carpeta temporal del sistema (${os.tmpdir()}), donde viven las bases de los e2e: las llaves de prueba se abren con un texto público y no se cargan en ninguna otra base.`,
    );
  }
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
