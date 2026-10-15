// Lo que la acción del formulario de alumno le devuelve al formulario cuando el
// alumno no se guarda. (Cuando se guarda, la acción redirige a su ficha.)
// Vive aparte de las acciones porque un archivo `"use server"` solo puede
// exportar funciones.

export interface StudentFormState {
  /** Un mensaje por campo con problema, con los nombres de campo del formulario. */
  fieldErrors: Record<string, string>;
  /** Un problema que no es de un campo (la base no contestó, el alumno ya no existe). */
  formError?: string;
}

export const INITIAL_STUDENT_FORM_STATE: StudentFormState = {
  fieldErrors: {},
};

/** Lo que el formulario de alumno muestra: todo texto, como lo escribe la persona. */
export interface StudentFormValues {
  name: string;
  discord: string;
  country: string;
  notes: string;
}

export const EMPTY_STUDENT_FORM_VALUES: StudentFormValues = {
  name: "",
  discord: "",
  country: "",
  notes: "",
};
