// Los textos de los formularios en zod, con una sola definición de "texto
// limpio": sin caracteres NUL (Postgres no los guarda) y sin espacios en los
// bordes. Todas las validaciones del panel parten de acá.

import { z } from "zod";
import { stripNul } from "@/admin/text";

/** Un texto limpio. `error` es el mensaje cuando falta o no es texto. */
export function cleanText(error?: string) {
  return (error === undefined ? z.string() : z.string({ error })).overwrite(stripNul).trim();
}

/** Un texto limpio, obligatorio y con un largo máximo. */
export function requiredText(missing: string, max: number, tooLong: string) {
  return cleanText(missing).min(1, missing).max(max, tooLong);
}

/** Un texto limpio, opcional y con un largo máximo. */
export function optionalText(max: number, tooLong: string) {
  return cleanText().max(max, tooLong).optional();
}
