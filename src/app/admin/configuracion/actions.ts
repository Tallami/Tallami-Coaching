"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/admin/auth/require-admin";
import type { SettingsFormState } from "@/admin/settings/form-state";
import { ADMIN_ROUTES } from "@/admin/routes";
import { saveSettingsForm } from "@/admin/settings/save-settings";
import { getDb } from "@/db/client";

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
