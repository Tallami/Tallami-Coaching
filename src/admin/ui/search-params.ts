// Los parámetros de la dirección (`?q=ana&pagina=2`) tal como los entrega Next
// a una página: texto, una lista si el parámetro se repite, o nada.

export type SearchParams = Record<string, string | string[] | undefined>;

/** `?clave=a&clave=b` llega como lista: vale el primero. */
export function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
