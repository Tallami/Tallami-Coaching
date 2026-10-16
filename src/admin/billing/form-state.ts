// Lo que la acción del formulario de facturación le devuelve al formulario
// cuando no se marca nada. (Cuando se marca, la acción redirige a la pantalla
// con un aviso.) Vive aparte de las acciones porque un archivo `"use server"`
// solo puede exportar funciones.

export interface InvoicingFormState {
  /** Un mensaje por campo con problema, con los nombres de campo del formulario (`ids`, `type`, `number`, `issuedOn`). */
  fieldErrors: Record<string, string>;
  /** Un problema que no es de un campo (alguna venta ya no se puede marcar, la base no contestó). */
  formError?: string;
}

export const INITIAL_INVOICING_FORM_STATE: InvoicingFormState = {
  fieldErrors: {},
};

/** La acción que recibe el formulario: devuelve el estado con los errores, o redirige si marcó. */
export type InvoicingAction = (
  state: InvoicingFormState,
  formData: FormData,
) => Promise<InvoicingFormState>;
