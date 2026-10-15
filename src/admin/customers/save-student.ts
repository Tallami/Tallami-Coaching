// Guardar el formulario de alumno, de punta a punta: validar y escribir. Lo
// usan las acciones de alta y de edición; vive acá y no en el archivo de
// acciones para poder probarlo con una base de prueba.

import type { StudentFormState } from "@/admin/customers/form-state";
import {
  CustomerNotFoundError,
  createCustomer,
  updateCustomer,
} from "@/admin/customers/repository";
import { customerFieldErrors, customerInputSchema } from "@/admin/customers/schema";
import type { Db } from "@/db/client";

export type SaveStudentOutcome =
  | { saved: true; id: string }
  | { saved: false; state: StudentFormState };

const CHECK_FIELDS_MESSAGE = "Revisá los campos marcados.";
const NOT_FOUND_MESSAGE = "No encontramos a ese alumno. Volvé a la lista de alumnos y elegilo de nuevo.";
const SAVE_FAILED_MESSAGE = "No pudimos guardar al alumno. Probá de nuevo en unos minutos.";

function rejected(state: Partial<StudentFormState>): SaveStudentOutcome {
  return { saved: false, state: { fieldErrors: {}, ...state } };
}

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  // Un archivo o un campo ausente no es texto: la validación lo rechaza.
  return typeof value === "string" ? value : undefined;
}

/** Los campos del alumno tal como llegaron, sin validar. */
function readStudentForm(formData: FormData): Record<string, unknown> {
  return {
    name: text(formData, "name"),
    discord: text(formData, "discord"),
    country: text(formData, "country"),
    notes: text(formData, "notes"),
  };
}

/**
 * Guarda el alumno del formulario: uno nuevo, o el `studentId` si se está
 * editando. Si algo falla devuelve el estado que el formulario muestra (los
 * errores por campo o el aviso general); nunca guarda a medias. Lo inesperado
 * (la base no contesta) se registra en el log y se avisa sin detalles.
 */
export async function saveStudent(
  db: Db,
  formData: FormData,
  studentId?: string,
): Promise<SaveStudentOutcome> {
  const parsed = customerInputSchema.safeParse(readStudentForm(formData));
  if (!parsed.success) {
    return rejected({
      fieldErrors: customerFieldErrors(parsed.error),
      formError: CHECK_FIELDS_MESSAGE,
    });
  }

  try {
    const { id } = studentId
      ? await updateCustomer(db, studentId, parsed.data)
      : await createCustomer(db, parsed.data);
    return { saved: true, id };
  } catch (error) {
    if (error instanceof CustomerNotFoundError) return rejected({ formError: NOT_FOUND_MESSAGE });
    console.error("Panel: no se pudo guardar al alumno.", error);
    return rejected({ formError: SAVE_FAILED_MESSAGE });
  }
}
