// Texto que llega de un formulario o de una dirección. Postgres no guarda ni
// compara el carácter NUL (daría un error 500 al guardar o buscar): se descarta
// antes de usar el texto. Sin dependencias: lo usan la validación (zod), las
// acciones y las direcciones.

const NUL = "\u0000";

/** El texto sin caracteres NUL. */
export function stripNul(text: string): string {
  return text.replaceAll(NUL, "");
}

/**
 * Un campo de texto de un formulario. Un archivo o un campo ausente no es
 * texto: devuelve `undefined` y la validación lo rechaza.
 */
export function formText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}
