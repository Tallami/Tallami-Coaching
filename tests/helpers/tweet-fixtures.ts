// Lectura de las copias guardadas de X (`src/content/tweet-snapshots/<id>.json`)
// para los tests unitarios y e2e: así lo que se espera sale de los mismos datos
// que usa la web, y sumar un tweet con `npm run tweets:record` no obliga a
// tocar ningún test. Lee los archivos y no importa `index.ts`: Playwright carga
// los tests con el ESM de Node, que exige un atributo de importación para los
// JSON. Que el índice y la carpeta coinciden lo comprueba
// `tests/unit/tweet-snapshots-index.test.ts`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tweet } from "react-tweet/api";

export const SNAPSHOT_DIR = fileURLToPath(
  new URL("../../src/content/tweet-snapshots", import.meta.url),
);

/** El usuario del coach en X (el que los jugadores etiquetan en sus tweets). */
export const COACH_HANDLE = "tallami1";

export function readFixture(id: string): Tweet {
  return JSON.parse(readFileSync(join(SNAPSHOT_DIR, `${id}.json`), "utf8"));
}

/**
 * Los IDs del tweet más nuevo al más viejo: por fecha de publicación y, si
 * coincide, por ID (numérico, así que "100" es más nuevo que "99"). Es la
 * misma regla con la que `fetchTweetCards` ordena el muro.
 */
export function idsNewestFirst(ids: readonly string[]): string[] {
  const dateOf = (id: string) => Date.parse(readFixture(id).created_at);

  return [...ids].sort((a, b) => {
    const byDate = dateOf(b) - dateOf(a);
    if (byDate !== 0) return byDate;
    const [newer, older] = [BigInt(b), BigInt(a)];
    return newer > older ? 1 : newer < older ? -1 : 0;
  });
}
