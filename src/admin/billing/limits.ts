// Los límites de lo que se escribe al marcar una factura. Viven aparte de la
// validación (zod) para que el formulario del navegador los use en `maxLength`
// sin traer zod, y para que la interfaz y el servidor digan siempre lo mismo.

/** El número de una factura de ARCA ("00003-00000045") mide 14; este margen alcanza para cualquier formato. */
export const MAX_INVOICE_NUMBER_LENGTH = 30;
