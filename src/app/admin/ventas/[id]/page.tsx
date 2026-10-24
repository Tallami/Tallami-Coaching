import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/admin/auth/require-admin";
import { InvoicePanel } from "@/admin/billing/invoice-panel";
import { invoiceUndoNotice } from "@/admin/billing/saved-notice";
import { todayInArgentina } from "@/admin/dates";
import { ADMIN_ROUTES } from "@/admin/routes";
import { saleToFormValues } from "@/admin/sales/form-values";
import { priceListUsd } from "@/admin/sales/price-list";
import { getSale } from "@/admin/sales/repository";
import { SaleForm } from "@/admin/sales/sale-form";
import { SavedValues } from "@/admin/sales/saved-values";
import { DRAFT_KEYS } from "@/admin/ui/draft-keys";
import { EmptyState } from "@/admin/ui/empty-state";
import { Notice } from "@/admin/ui/notice";
import { PageHeader } from "@/admin/ui/page-header";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { PanelShell } from "@/app/admin/panel-shell";
import { markInvoicePendingAction, updateSaleAction } from "../actions";

export const metadata: Metadata = { title: "Editar venta" };

export default async function EditSalePage(props: PageProps<"/admin/ventas/[id]">) {
  await requireAdmin();
  const { id } = await props.params;
  // El aviso de después de volver la factura a pendiente viene de la dirección: lo que no se reconoce no muestra nada.
  const notice = invoiceUndoNotice(await props.searchParams);
  const sale = await getSale(await getDb(), id);

  if (!sale) {
    return (
      <PanelShell active="sales">
        <PageHeader title="Venta" />
        <EmptyState
          title="No encontramos esa venta"
          description="Puede que el enlace esté mal escrito. Volvé a la lista para elegirla de nuevo."
          action={
            <Button asChild variant="ink-outline">
              <Link href={ADMIN_ROUTES.sales}>Volver a ventas</Link>
            </Button>
          }
        />
      </PanelShell>
    );
  }

  return (
    <PanelShell active="sales">
      <PageHeader
        title="Editar venta"
        description="Las ventas no se borran: si no se concretó, pasala a cancelada o reembolsada y deja de sumar."
      />
      {notice ? (
        <Notice tone={notice.tone} className="mb-5">
          {notice.text}
        </Notice>
      ) : null}
      <SavedValues sale={sale} />
      <InvoicePanel
        sale={sale}
        undoAction={markInvoicePendingAction.bind(null, sale.id)}
        today={todayInArgentina()}
      />
      <SaleForm
        mode="edit"
        draftKey={DRAFT_KEYS.sale(sale.id)}
        action={updateSaleAction.bind(null, sale.id)}
        initialValues={saleToFormValues(sale)}
        priceListUsd={priceListUsd()}
        invoiced={sale.invoiceStatus === "issued"}
      />
    </PanelShell>
  );
}
