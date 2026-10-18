import type { Metadata } from "next";
import { requireAdmin } from "@/admin/auth/require-admin";
import { getMonotributoRecord } from "@/admin/settings/read";
import { SettingsView } from "@/admin/settings/settings-view";
import { PageHeader } from "@/admin/ui/page-header";
import { firstValue } from "@/admin/ui/search-params";
import { getDb } from "@/db/client";
import { PanelShell } from "@/app/admin/panel-shell";
import { saveSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Configuración" };

/** La categoría del monotributo, su tope anual y desde cuándo rige. */
export default async function SettingsPage(props: PageProps<"/admin/configuracion">) {
  await requireAdmin();
  const justSaved = firstValue((await props.searchParams).guardada) === "1";

  // Una sola lectura trae lo cargado y cuándo se guardó.
  const record = await getMonotributoRecord(await getDb());

  return (
    <PanelShell active="settings">
      <PageHeader
        title="Configuración"
        description="Los datos con los que el panel mide tu monotributo."
      />
      <SettingsView
        current={record?.settings ?? null}
        updatedAt={record?.updatedAt ?? null}
        justSaved={justSaved}
        action={saveSettingsAction}
      />
    </PanelShell>
  );
}
