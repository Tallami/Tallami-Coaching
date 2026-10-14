// Búsquedas de texto con `ilike`. El texto que escribe el usuario es texto, no
// un patrón: `%`, `_` y `\` valen como los caracteres que son.

const NUL = "\u0000";

/**
 * Patrón "contiene este texto" para `ilike`, con los comodines del usuario
 * escapados, o `null` si no queda texto que buscar. Postgres rechaza el
 * carácter NUL en un texto (daría un error 500 con una dirección escrita a
 * mano): se descarta, igual que los espacios de los bordes.
 */
export function containsPattern(text: string): string | null {
  const clean = text.replaceAll(NUL, "").trim();
  return clean === "" ? null : `%${clean.replace(/[\\%_]/g, "\\$&")}%`;
}
