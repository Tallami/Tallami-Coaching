// Texto que llega de un formulario o de una dirección. Postgres no guarda ni
// compara el carácter NUL (daría un error 500 al guardar o buscar): se descarta
// antes de usar el texto.

const NUL = "\u0000";

/** El texto sin caracteres NUL. */
export function stripNul(text: string): string {
  return text.replaceAll(NUL, "");
}
