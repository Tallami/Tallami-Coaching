// Los ids de las tablas son `uuid`: Postgres rechaza (error 500) cualquier otro
// texto que se le pase como id. Los ids que llegan de una dirección o de un
// formulario se revisan con esto antes de buscarlos.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ¿Es un uuid escrito con guiones? */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
