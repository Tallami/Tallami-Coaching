// Graba la respuesta de X de uno o más tweets en `tests/fixtures/tweets/<id>.json`.
// Los tests y el build de Playwright leen esos archivos en vez de pedirle los
// tweets a X (ver `src/lib/tweets.ts`). Se corre una vez por tweet nuevo, después
// de sumar su ID a `src/content/tweets.ts`:
//
//   npm run tweets:record -- <id> [<id> …]
//
// `<id>` es el número al final del link del tweet (`x.com/<usuario>/status/<id>`).
// Con `TWEETS_FIXTURE_DIR` se graba en esa carpeta en vez de la de los tests.
// Pide los tweets con la misma función que usa la web (`getTweet`).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getTweet } from "react-tweet/api";

const NUMERIC_ID = /^\d+$/;
const TIMEOUT_MS = 20_000;
const FIXTURE_DIR_ENV = "TWEETS_FIXTURE_DIR";
const DEFAULT_DIR = fileURLToPath(
  new URL("../tests/fixtures/tweets/", import.meta.url),
);

/** Error esperado: se muestra el mensaje solo, sin la traza. */
class RecordError extends Error {}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function fixtureDir() {
  const custom = process.env[FIXTURE_DIR_ENV];
  return custom ? path.resolve(custom) : DEFAULT_DIR;
}

/** Los IDs sin repetir; si alguno no es un número, no se pide ninguno. */
function parseIds(args) {
  if (args.length === 0) {
    throw new RecordError(
      "uso: npm run tweets:record -- <id> [<id> …] (el número al final del link del tweet).",
    );
  }
  const invalid = args.filter((arg) => !NUMERIC_ID.test(arg));
  if (invalid.length > 0) {
    throw new RecordError(
      `ID de tweet inválido: ${invalid.join(", ")}. Tiene que ser el número al final del link (x.com/<usuario>/status/<id>).`,
    );
  }
  return [...new Set(args)];
}

async function record(id, dir) {
  let tweet;
  try {
    tweet = await getTweet(id, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new RecordError(`no se pudo bajar el tweet ${id}: ${errorMessage(error)}`);
  }
  // `getTweet` devuelve `undefined` si el tweet no existe, se borró o es privado.
  if (!tweet) {
    throw new RecordError(
      `X no devolvió el tweet ${id}: no existe, se borró o es de una cuenta privada. No se guardó nada.`,
    );
  }

  const file = path.join(dir, `${id}.json`);
  await writeFile(file, `${JSON.stringify(tweet, null, 2)}\n`);
  console.log(`Guardado ${path.relative(process.cwd(), file)}.`);
}

async function main(args) {
  const ids = parseIds(args);
  const dir = fixtureDir();
  await mkdir(dir, { recursive: true });

  // Uno por uno: si un tweet falla, los demás se graban igual y el error se informa al final.
  let failures = 0;
  for (const id of ids) {
    try {
      await record(id, dir);
    } catch (error) {
      failures += 1;
      console.error(`record-tweet: ${errorMessage(error)}`);
    }
  }
  if (failures > 0) process.exitCode = 1;
}

// `exitCode` en lugar de `process.exit()`: en Windows, salir con un socket de
// `fetch` todavía abierto hace fallar a Node con un assert de libuv.
try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(
    `record-tweet: ${error instanceof RecordError ? error.message : (error?.stack ?? error)}`,
  );
  process.exitCode = 1;
}
