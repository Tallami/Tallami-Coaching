// Validación de la configuración del monotributo (zod). La entrada es la del
// formulario: todo texto. El tope se escribe en pesos ("21.113.697,00") y se
// guarda en centavos. Los mensajes están en español, listos para mostrar debajo
// de cada campo.
//
// Los datos los carga Tallami: el panel no los compara con ARCA. Por eso la
// categoría es solo una letra de la A a la K y el tope, un monto cualquiera
// dentro de un límite razonable.

import { z } from "zod";
import { isPlausibleDay } from "@/admin/dates";
import { MONOTRIBUTO_CATEGORIES, type MonotributoCategory } from "@/admin/settings/categories";
import { cleanText } from "@/admin/zod-text";
import { InvalidAmountError, parseAmountToMinor } from "@/lib/money";

/** Tope anual máximo: un billón de pesos (en centavos). Más que eso es un error de tipeo. */
export const MAX_ANNUAL_CAP_ARS_MINOR = 100_000_000_000_000;

const MESSAGES = {
  category: "Elegí la categoría, de la A a la K.",
  capRequired: "Cargá el tope anual en pesos.",
  capTooBig: "El tope es demasiado grande: revisá los ceros.",
  validFromRequired: "Cargá desde qué fecha rige el tope.",
  validFromInvalid: "La fecha no es válida.",
} as const;

const categoryField = cleanText(MESSAGES.category)
  .toUpperCase()
  .refine((value) => (MONOTRIBUTO_CATEGORIES as readonly string[]).includes(value), {
    error: MESSAGES.category,
  });

/** El tope escrito: un monto en pesos válido y dentro del límite. */
const capField = cleanText(MESSAGES.capRequired).superRefine((text, ctx) => {
  if (text === "") {
    ctx.addIssue({ code: "custom", message: MESSAGES.capRequired });
    return;
  }
  try {
    if (parseAmountToMinor(text) > MAX_ANNUAL_CAP_ARS_MINOR) {
      ctx.addIssue({ code: "custom", message: MESSAGES.capTooBig });
    }
  } catch (error) {
    if (!(error instanceof InvalidAmountError)) throw error;
    ctx.addIssue({ code: "custom", message: error.message });
  }
});

const validFromField = cleanText(MESSAGES.validFromRequired).superRefine((value, ctx) => {
  if (value === "") {
    ctx.addIssue({ code: "custom", message: MESSAGES.validFromRequired });
  } else if (!isPlausibleDay(value)) {
    ctx.addIssue({ code: "custom", message: MESSAGES.validFromInvalid });
  }
});

const fieldsSchema = z.object({
  category: categoryField,
  annualCapArs: capField,
  validFrom: validFromField,
});

/** Lo que se guarda en la fila `monotributo` de `settings`. */
export interface MonotributoToSave {
  category: MonotributoCategory;
  annualCapArsMinor: number;
  validFrom: string;
}

/** La configuración del monotributo tal como llega: texto del formulario; sale lista para guardar. */
export const monotributoInputSchema = fieldsSchema.transform(
  (value): MonotributoToSave => ({
    category: value.category as MonotributoCategory,
    annualCapArsMinor: parseAmountToMinor(value.annualCapArs),
    validFrom: value.validFrom,
  }),
);
