// Los límites de los datos de un alumno. Viven aparte de la validación (zod)
// para que los formularios del navegador los usen en `maxLength` sin traer zod
// con ellos, y para que la interfaz y el servidor digan siempre lo mismo. Valen
// igual cuando el alumno se carga desde una venta.

export const MAX_NAME_LENGTH = 120;
export const MAX_DISCORD_LENGTH = 64;
export const MAX_NOTES_LENGTH = 2000;
/** Largo de un código de país (ISO 3166-1 alfa-2). */
export const COUNTRY_CODE_LENGTH = 2;
