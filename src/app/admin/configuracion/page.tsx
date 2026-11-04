import type { Metadata } from "next";
import { requireAdmin } from "@/admin/auth/require-admin";
import { PesosPerDollarCard, type PesosPerDollarOutcome } from "@/admin/settings/pesos-per-dollar-card";
import { getMonotributoRecord } from "@/admin/settings/read";
import { SettingsView } from "@/admin/settings/settings-view";
import { PageHeader } from "@/admin/ui/page-header";
import { firstValue } from "@/admin/ui/search-params";
import { getDb } from "@/db/client";
import { PanelShell } from "@/app/admin/panel-shell";
import { getPesosPerDollar } from "@/payments/pricing";
import { savePesosPerDollarAction, saveSettingsAction } from "./actions";

const PESOS_OUTCOMES = new Map<string, PesosPerDollarOutcome>([
  ["guardado", "saved"],
  ["invalido", "invalid"],
]);

export const metadata: Metadata = { title: "Configuración" };

/** La categoría del monotributo, su tope anual y desde cuándo rige. */
export default async function SettingsPage(props: PageProps<"/admin/configuracion">) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const justSaved = firstValue(searchParams.guardada) === "1";
  const pesosOutcome = PESOS_OUTCOMES.get(firstValue(searchParams.pesos) ?? "");

  const db = await getDb();
  // Una sola lectura trae lo cargado y cuándo se guardó.
  const record = await getMonotributoRecord(db);
  const pesosPerDollar = await getPesosPerDollar(db);

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
        pesosPerDollar={
          <PesosPerDollarCard current={pesosPerDollar} outcome={pesosOutcome} action={savePesosPerDollarAction} />
        }
      />
    </PanelShell>
  );
}
