// Las claves de los borradores: una por formulario, y las de un registro llevan su id (editar
// la venta A no trae el borrador de la venta B).

export const DRAFT_KEYS = {
  newSale: "venta:nueva",
  sale: (id: string) => `venta:${id}`,
  newStudent: "alumno:nuevo",
  student: (id: string) => `alumno:${id}`,
  markInvoiced: "facturas:marcar",
  settings: "configuracion",
} as const;
