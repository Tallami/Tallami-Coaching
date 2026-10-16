// Del error de validación de zod a lo que muestra un formulario: un mensaje
// por campo, con el primer problema de cada uno.

import type { z } from "zod";

/** Nombre que lleva un problema que no es de ningún campo. */
const FORM_FIELD = "form";

/** El primer mensaje de cada campo, con los nombres de campo del formulario. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? FORM_FIELD);
    errors[field] ??= issue.message;
  }
  return errors;
}
