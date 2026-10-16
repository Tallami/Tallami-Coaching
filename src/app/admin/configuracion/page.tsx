import type { Metadata } from "next";
import { requireAdmin } from "@/admin/auth/require-admin";
import { getMonotributoSettings, getMonotributoUpdatedAt } from "@/admin/settings/read";
import { SettingsView } from "@/admin/settings/settings-view";
import { AdminShell } from "@/admin/ui/admin-shell";
import { PageHeader } from "@/admin/ui/page-header";
import { firstValue } from "@/admin/ui/search-params";
import { getDb } from "@/db/client";
import { saveSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Configuración" };

/** La categoría del monotributo, su tope anual y desde cuándo rige. */
export default async function SettingsPage(props: PageProps<"/admin/configuracion">) {
  await requireAdmin();
  const justSaved = firstValue((await props.searchParams).guardada) === "1";

  const db = await getDb();
  const [current, updatedAt] = await Promise.all([getMonotributoSettings(db), getMonotributoUpdatedAt(db)]);

  return (
    <AdminShell active="settings">
      <PageHeader
        title="Configuración"
        description="Los datos con los que el panel mide tu monotributo."
      />
      <SettingsView current={current} updatedAt={updatedAt} justSaved={justSaved} action={saveSettingsAction} />
    </AdminShell>
  );
}
