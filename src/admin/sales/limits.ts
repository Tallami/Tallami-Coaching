// Los límites de los textos de una venta. Viven aparte de la validación (zod)
// para que el formulario del navegador los use en `maxLength` sin traer zod, y
// para que la interfaz y el servidor digan siempre lo mismo. El nombre, el
// Discord y el país del alumno nuevo son los de `src/admin/customers/limits.ts`.

export const MAX_DESCRIPTION_LENGTH = 200;
export const MAX_SALE_NOTES_LENGTH = 2000;
