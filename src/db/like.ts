// Búsquedas de texto con `ilike`. El texto que escribe el usuario es texto, no
// un patrón: `%`, `_` y `\` valen como los caracteres que son.

/** Patrón "contiene este texto" para `ilike`, con los comodines del usuario escapados. */
export function containsPattern(text: string): string {
  return `%${text.trim().replace(/[\\%_]/g, "\\$&")}%`;
}
