// Escritura de la configuración del panel. Por ahora solo el monotributo; la
// lectura vive en `read.ts` y sigue siendo la única que interpreta lo guardado.
//
// La configuración se guarda en la tabla `settings` como `jsonb` clave-valor,
// una fila por clave. Guardar de nuevo reemplaza la fila y mueve su fecha de
// actualización.

import { fieldErrorsOf } from "@/admin/form-errors";
import { MONOTRIBUTO_SETTING_KEY } from "@/admin/settings/read";
import { monotributoInputSchema } from "@/admin/settings/schema";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";

export { MONOTRIBUTO_CATEGORIES, type MonotributoCategory } from "@/admin/settings/schema";

/** Lo que carga Tallami en el formulario del monotributo: todo texto, como lo escribe. */
export interface MonotributoInput {
  /** Una letra de la A a la K (se acepta en minúscula). */
  category: string;
  /** El tope anual en pesos, escrito como "21.113.697,00" o "21113697". */
  annualCapArs: string;
  /** Desde cuándo rige el tope, "AAAA-MM-DD". */
  validFrom: string;
}

/** Algún dato del monotributo no es válido; `fieldErrors` trae un mensaje por campo, listo para mostrar. */
export class InvalidMonotributoSettingsError extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super("Los datos del monotributo no son válidos.");
    this.name = "InvalidMonotributoSettingsError";
  }
}

/**
 * Guarda la categoría, el tope anual (en centavos de peso) y desde cuándo
 * rige. Valida todo antes de escribir: ante un dato inválido tira
 * `InvalidMonotributoSettingsError` y no cambia nada. El panel no verifica el
 * tope con ARCA: es lo que Tallami carga.
 */
export async function saveMonotributoSettings(db: Db, input: MonotributoInput): Promise<void> {
  const parsed = monotributoInputSchema.safeParse(input);
  if (!parsed.success) throw new InvalidMonotributoSettingsError(fieldErrorsOf(parsed.error));

  await db
    .insert(settings)
    .values({ key: MONOTRIBUTO_SETTING_KEY, value: parsed.data })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: parsed.data, updatedAt: new Date() },
    });
}
