// Lectura de la configuración del panel. Por ahora solo el monotributo: la
// categoría, el tope anual en pesos y desde cuándo rige. La pantalla de
// Configuración (Tarea 9) amplía este módulo con la escritura.
//
// La configuración vive en la tabla `settings` como `jsonb` clave-valor: lo que
// hay ahí no lo garantiza la base, así que se valida la forma al leerla y, ante
// cualquier cosa rara, se trata como "sin configuración" (el resumen muestra el
// enlace a Configuración) en vez de romper la página.

import { eq } from "drizzle-orm";
import { z } from "zod";
import { isValidIsoDate } from "@/admin/dates";
import type { MonotributoSettings } from "@/admin/metrics/monotributo";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";

/** Clave de la fila de `settings` con la categoría y el tope del monotributo. */
export const MONOTRIBUTO_SETTING_KEY = "monotributo";

export const monotributoSettingsSchema = z.object({
  category: z.string().trim().min(1),
  /** Tope anual en centavos de peso: un entero seguro mayor a cero. */
  annualCapArsMinor: z.int().positive(),
  /** Desde cuándo rige el tope, "AAAA-MM-DD". */
  validFrom: z.string().refine(isValidIsoDate, "Se espera una fecha AAAA-MM-DD."),
});

/** El monotributo cargado, o `null` si no hay fila o su contenido no es válido. */
export async function getMonotributoSettings(db: Db): Promise<MonotributoSettings | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, MONOTRIBUTO_SETTING_KEY))
    .limit(1);
  if (!row) return null;
  const parsed = monotributoSettingsSchema.safeParse(row.value);
  return parsed.success ? parsed.data : null;
}
