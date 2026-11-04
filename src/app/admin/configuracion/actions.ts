"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/admin/auth/require-admin";
import type { SettingsFormState } from "@/admin/settings/form-state";
import { ADMIN_ROUTES } from "@/admin/routes";
import { saveSettingsForm } from "@/admin/settings/save-settings";
import { getDb } from "@/db/client";
import { PESOS_PER_DOLLAR_TAG, savePesosPerDollar } from "@/payments/pricing";

/** Después de guardar se vuelve a la misma pantalla; ella muestra el aviso según `guardada`. */
const SAVED_PATH = `${ADMIN_ROUTES.settings}?guardada=1`;

/** Guarda el monotributo. Las acciones del panel verifican la sesión antes de todo. */
export async function saveSettingsAction(
  _previous: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  await requireAdmin();
  const outcome = await saveSettingsForm(await getDb(), formData);
  if (!outcome.saved) return outcome.state;
  redirect(SAVED_PATH);
}

/** Guarda los pesos por dólar y deja que la web pública los muestre enseguida. */
export async function savePesosPerDollarAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const input = formData.get("pesosPerDollar");
  const result = await savePesosPerDollar(await getDb(), typeof input === "string" ? input : "");
  if (!result.saved) redirect(`${ADMIN_ROUTES.settings}?pesos=invalido`);
  updateTag(PESOS_PER_DOLLAR_TAG);
  redirect(`${ADMIN_ROUTES.settings}?pesos=guardado`);
}
