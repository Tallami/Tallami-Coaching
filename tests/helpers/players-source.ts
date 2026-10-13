// Los jugadores de `src/content/players.ts` para los tests e2e. Playwright no
// puede importar ese archivo (importa las fotos como módulos `.jpg`), así que
// se leen del texto. `tests/unit/content.test.ts` comprueba que esta lectura
// coincide con `PLAYERS`: si cambia el formato del archivo, falla ese test y
// no los e2e con un mensaje confuso.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PLAYERS_FILE = fileURLToPath(
  new URL("../../src/content/players.ts", import.meta.url),
);

/** `{ name: "K1ng", handle: "k1ng", photo: k1ng }`; la foto es opcional. */
const PLAYER_ENTRY =
  /\{\s*name:\s*"([^"]+)",\s*handle:\s*"([^"]+)"(,\s*photo:\s*\w+)?\s*,?\s*\}/g;

export interface PlayerEntry {
  name: string;
  handle: string;
  hasPhoto: boolean;
}

/** Los jugadores en el orden en que se muestran. */
export function readPlayerEntries(): PlayerEntry[] {
  const source = readFileSync(PLAYERS_FILE, "utf8");

  return [...source.matchAll(PLAYER_ENTRY)].map(([, name, handle, photo]) => ({
    name,
    handle,
    hasPhoto: photo !== undefined,
  }));
}
