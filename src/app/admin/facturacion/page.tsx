import type { Metadata } from "next";
import { requireAdmin } from "@/admin/auth/require-admin";
import { buildBilling } from "@/admin/billing/billing-data";
import { exportErrorNotice } from "@/admin/export/notices";
import { BillingView } from "@/admin/billing/billing-view";
import { countUninvoicedSales, listUninvoicedSales } from "@/admin/billing/invoicing";
import { invoicingNotice } from "@/admin/billing/saved-notice";
import { loadMetricSales } from "@/admin/metrics/load";
import { getMonotributoSettings } from "@/admin/settings/read";
import { Notice } from "@/admin/ui/notice";
import { PageHeader } from "@/admin/ui/page-header";
import { getDb } from "@/db/client";
import { PanelShell } from "@/app/admin/panel-shell";
import { invoicingAction } from "./actions";

export const metadata: Metadata = { title: "Facturación" };

/** Qué falta facturar, cuánto se cobró contra cuánto se facturó mes a mes, el monotributo y la exportación para el contador. */
export default async function BillingPage(props: PageProps<"/admin/facturacion">) {
  await requireAdmin();
  // El aviso de después de marcar viene de la dirección: lo que no se reconoce no muestra nada.
  const params = await props.searchParams;
  const notice = invoicingNotice(params);
  // Una descarga que no se pudo armar vuelve acá con el motivo en la dirección.
  const exportError = exportErrorNotice(params.exportacion);

  const db = await getDb();
  const now = new Date();
  const [uninvoiced, totals, sales, settings] = await Promise.all([
    listUninvoicedSales(db, now),
    countUninvoicedSales(db, now),
    loadMetricSales(db, now),
    getMonotributoSettings(db),
  ]);
  const data = buildBilling({ uninvoiced: { ...uninvoiced, totals }, sales, settings, now });

  return (
    <PanelShell active="billing">
      <PageHeader
        title="Facturación"
        description="Qué cobraste y todavía no facturaste, cuánto llevás en el año y lo que le pasás al contador."
      />
      {notice ? (
        <Notice tone="ok" className="mb-5">
          {notice}
        </Notice>
      ) : null}
      {exportError ? (
        <Notice tone="error" className="mb-5">
          {exportError}
        </Notice>
      ) : null}
      <BillingView data={data} invoiceAction={invoicingAction} />
    </PanelShell>
  );
}
