// Lo que la acción del formulario de venta le devuelve al formulario cuando la
// venta no se guarda. (Cuando se guarda, la acción redirige a la lista.)
// Vive aparte de las acciones porque un archivo `"use server"` solo puede
// exportar funciones.

/** El aviso cuando no hay dólar oficial para el día de cobro. */
export const RATE_UNAVAILABLE_MESSAGE =
  "No pudimos traer el dólar oficial; cargalo a mano.";

export interface SaleFormState {
  /** Un mensaje por campo con problema, con los nombres de campo del formulario. */
  fieldErrors: Record<string, string>;
  /** Un problema que no es de un campo (la base no contestó, la venta ya no existe). */
  formError?: string;
  /** No hay cotización oficial: el formulario muestra los campos del tipo de cambio manual. */
  needsManualRate: boolean;
}

export const INITIAL_SALE_FORM_STATE: SaleFormState = {
  fieldErrors: {},
  needsManualRate: false,
};
