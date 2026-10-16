// Los parámetros de la dirección (`?q=ana&pagina=2`) tal como los entrega Next
// a una página: texto, una lista si el parámetro se repite, o nada.

export type SearchParams = Record<string, string | string[] | undefined>;

/** `?clave=a&clave=b` llega como lista: vale el primero. */
export function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * La parte `?…` de una dirección como la entregaría Next a una página: texto,
 * o una lista si la clave se repite. Se arma sin prototipo, así una clave como
 * `__proto__` o `constructor` es una clave más y no toca nada. Es para los
 * endpoints (que reciben un `URLSearchParams`) y quieren leer los filtros con el
 * mismo código que las páginas.
 */
export function searchParamsRecord(params: URLSearchParams): SearchParams {
  const record: SearchParams = Object.create(null);
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    record[key] = values.length === 1 ? values[0] : values;
  }
  return record;
}
