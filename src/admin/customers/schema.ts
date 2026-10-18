// Validación de los datos de un alumno (zod). La entrada es la del formulario:
// todo texto. Los límites de largo son los mismos que el formulario pone en
// `maxLength` y el nombre y el Discord tienen los mismos que al cargar un
// alumno nuevo desde una venta. Los mensajes están en español, listos para
// mostrar debajo de cada campo.

import { z } from "zod";
import {
  MAX_DISCORD_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
} from "@/admin/customers/limits";
import type { CustomerInput } from "@/admin/customers/repository";
import { cleanText, optionalText, requiredText } from "@/admin/zod-text";

const COUNTRY_CODE = /^[A-Z]{2}$/;

const MESSAGES = {
  name: "Escribí el nombre del alumno.",
  nameTooLong: `El nombre es demasiado largo (máximo ${MAX_NAME_LENGTH} caracteres).`,
  discordTooLong: `El Discord es demasiado largo (máximo ${MAX_DISCORD_LENGTH} caracteres).`,
  country: "El país va con 2 letras, como AR, BR o MX.",
  notesTooLong: `Las notas son demasiado largas (máximo ${MAX_NOTES_LENGTH} caracteres).`,
} as const;

/** Los datos de un alumno: el nombre es obligatorio, lo demás puede quedar vacío. */
export const customerInputSchema = z
  .object({
    name: requiredText(MESSAGES.name, MAX_NAME_LENGTH, MESSAGES.nameTooLong),
    discord: optionalText(MAX_DISCORD_LENGTH, MESSAGES.discordTooLong),
    country: cleanText()
      .toUpperCase()
      .refine((value) => value === "" || COUNTRY_CODE.test(value), { error: MESSAGES.country })
      .optional(),
    notes: optionalText(MAX_NOTES_LENGTH, MESSAGES.notesTooLong),
  })
  .transform(
    (value): CustomerInput => ({
      name: value.name,
      discord: value.discord || null,
      country: value.country || null,
      notes: value.notes || null,
    }),
  );

/** El primer mensaje de cada campo, con los nombres de campo del formulario. */
export function customerFieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] ??= issue.message;
  }
  return errors;
}
