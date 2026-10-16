// Guardar el formulario de configuración, de punta a punta: leer los campos,
// validar y escribir. Lo usa la acción del servidor; vive acá y no en el archivo
// de acciones para poder probarlo con una base de prueba.

import type { SettingsFormState } from "@/admin/settings/form-state";
import {
  InvalidMonotributoSettingsError,
  saveMonotributoSettings,
  type MonotributoInput,
} from "@/admin/settings/repository";
import type { Db } from "@/db/client";

export type SaveSettingsOutcome = { saved: true } | { saved: false; state: SettingsFormState };

const CHECK_FIELDS_MESSAGE = "Revisá los campos marcados.";
const SAVE_FAILED_MESSAGE = "No pudimos guardar la configuración. Probá de nuevo en unos minutos.";

/** Un campo de texto del formulario; un archivo o un campo ausente no es texto (la validación lo rechaza). */
function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * Guarda la categoría, el tope y la fecha del formulario. Si algo falla
 * devuelve el estado que el formulario muestra (los errores por campo o el
 * aviso general); nunca guarda a medias. Lo inesperado (la base no contesta) se
 * registra en el log y se avisa sin detalles.
 */
export async function saveSettingsForm(db: Db, formData: FormData): Promise<SaveSettingsOutcome> {
  // Lo que llega del formulario no es de confiar: `saveMonotributoSettings` lo valida con zod.
  const input = {
    category: text(formData, "category"),
    annualCapArs: text(formData, "annualCapArs"),
    validFrom: text(formData, "validFrom"),
  } as unknown as MonotributoInput;

  try {
    await saveMonotributoSettings(db, input);
    return { saved: true };
  } catch (error) {
    if (error instanceof InvalidMonotributoSettingsError) {
      return { saved: false, state: { fieldErrors: error.fieldErrors, formError: CHECK_FIELDS_MESSAGE } };
    }
    console.error("Panel: no se pudo guardar la configuración del monotributo.", error);
    return { saved: false, state: { fieldErrors: {}, formError: SAVE_FAILED_MESSAGE } };
  }
}
