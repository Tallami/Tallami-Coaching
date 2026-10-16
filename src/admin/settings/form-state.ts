// Lo que la acción del formulario de configuración le devuelve al formulario
// cuando no se guarda nada. (Cuando se guarda, la acción redirige a la misma
// pantalla con un aviso.) Vive aparte de las acciones porque un archivo
// `"use server"` solo puede exportar funciones.

import { formatPlainAmount } from "@/lib/money";
import type { MonotributoSettings } from "@/admin/metrics/monotributo";

export interface SettingsFormState {
  /** Un mensaje por campo con problema, con los nombres de campo del formulario. */
  fieldErrors: Record<string, string>;
  /** Un problema que no es de un campo (la base no contestó). */
  formError?: string;
}

export const INITIAL_SETTINGS_FORM_STATE: SettingsFormState = {
  fieldErrors: {},
};

/** Lo que el formulario muestra: todo texto, como lo escribe la persona. */
export interface SettingsFormValues {
  category: string;
  /** El tope en pesos como número plano con coma: "21113697,00". */
  annualCapArs: string;
  validFrom: string;
}

export const EMPTY_SETTINGS_FORM_VALUES: SettingsFormValues = {
  category: "",
  annualCapArs: "",
  validFrom: "",
};

/** Lo guardado como lo muestra el formulario; sin nada guardado, vacío. */
export function settingsToFormValues(current: MonotributoSettings | null): SettingsFormValues {
  if (!current) return EMPTY_SETTINGS_FORM_VALUES;
  return {
    category: current.category,
    annualCapArs: formatPlainAmount(current.annualCapArsMinor),
    validFrom: current.validFrom,
  };
}
