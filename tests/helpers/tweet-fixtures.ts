// Lectura de las respuestas grabadas de X (`tests/fixtures/tweets`) para los
// tests unitarios y e2e: así lo que se espera sale de los mismos archivos que
// lee la web, y sumar un tweet con `npm run tweets:record` no obliga a tocar
// ningún test. Sin dependencias de la web: solo `node:fs`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Tweet } from "react-tweet/api";

export const FIXTURE_DIR = fileURLToPath(
  new URL("../fixtures/tweets", import.meta.url),
);

/** El usuario del coach en X (el que los jugadores etiquetan en sus tweets). */
export const COACH_HANDLE = "tallami1";

export function readFixture(id: string): Tweet {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${id}.json`), "utf8"));
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
