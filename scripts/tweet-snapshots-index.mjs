// Genera `src/content/tweet-snapshots/index.ts`: el índice que importa, de forma
// estática, las copias guardadas de la respuesta de X de cada tweet
// (`<id>.json` en esa misma carpeta). Importar los JSON (y no leerlos del disco
// al correr) hace que viajen dentro del bundle: en Vercel, la regeneración de
// la página corre en una función que no incluye archivos leídos por ruta.
//
// Lo corre `npm run tweets:record` después de guardar un tweet. Para rehacerlo
// a mano, por ejemplo después de borrar la copia de un tweet:
//
//   npm run tweets:index

import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_SNAPSHOTS_DIR = fileURLToPath(
  new URL("../src/content/tweet-snapshots/", import.meta.url),
);

const SNAPSHOT_FILE = /^(\d+)\.json$/;
const INDEX_FILE = "index.ts";

/** Los IDs de X son numéricos y crecen con el tiempo: más dígitos, más nuevo. */
function compareIds(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * El contenido de `index.ts` para esos IDs. Siempre queda igual para el mismo
 * conjunto de IDs: orden estable (por ID, de menor a mayor) y sin repetidos.
 *
 * @param {Iterable<string>} ids
 * @returns {string}
 */
export function renderSnapshotsIndex(ids) {
  const sorted = [...new Set(ids)].sort(compareIds);
  const imports = sorted.map((id) => `import snapshot${id} from "./${id}.json";`);
  const entries = sorted.map((id) => `  "${id}": snapshot${id} as unknown as Tweet,`);

  return [
    "// Generado por `npm run tweets:record` (scripts/tweet-snapshots-index.mjs).",
    "// No lo edites a mano: se rehace con `npm run tweets:index`.",
    "//",
    "// Copia guardada de la respuesta de X de cada tweet de `src/content/tweets.ts`.",
    "// Si X falla al armar la página, la sección Reviews usa estas copias (ver",
    "// `src/lib/tweets.ts`). Los JSON se importan en lugar de leerse del disco, así",
    "// viajan dentro del bundle. `Tweet` es el tipo de react-tweet que describe esa",
    "// respuesta.",
    "",
    'import type { Tweet } from "react-tweet/api";',
    ...imports,
    "",
    "export const TWEET_SNAPSHOTS: Readonly<Record<string, Tweet>> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

/**
 * Los IDs de las copias que hay en la carpeta (`<id>.json`), de menor a mayor.
 * Ignora todo lo demás, incluido el propio `index.ts`.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function listSnapshotIds(dir) {
  const names = await readdir(dir);
  return names
    .map((name) => SNAPSHOT_FILE.exec(name)?.[1])
    .filter((id) => id !== undefined)
    .sort(compareIds);
}

/**
 * Rehace `<dir>/index.ts` con las copias que hay en la carpeta.
 *
 * @param {string} [dir]
 * @returns {Promise<{ file: string; ids: string[] }>}
 */
export async function writeSnapshotsIndex(dir = DEFAULT_SNAPSHOTS_DIR) {
  const ids = await listSnapshotIds(dir);
  const file = path.join(dir, INDEX_FILE);
  await writeFile(file, renderSnapshotsIndex(ids));
  return { file, ids };
}

// Corrido directamente (`npm run tweets:index`) rehace el índice de la carpeta de la web.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { file, ids } = await writeSnapshotsIndex();
  console.log(
    `Guardado ${path.relative(process.cwd(), file)} con ${ids.length} copias.`,
  );
}
