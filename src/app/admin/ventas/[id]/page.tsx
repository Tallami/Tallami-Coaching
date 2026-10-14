import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/admin/auth/require-admin";
import { saleToFormValues } from "@/admin/sales/form-values";
import { priceListUsd } from "@/admin/sales/price-list";
import { getSale } from "@/admin/sales/repository";
import { SaleForm } from "@/admin/sales/sale-form";
import { SavedValues } from "@/admin/sales/saved-values";
import { AdminShell } from "@/admin/ui/admin-shell";
import { EmptyState } from "@/admin/ui/empty-state";
import { PageHeader } from "@/admin/ui/page-header";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { updateSaleAction } from "../actions";

export const metadata: Metadata = { title: "Editar venta" };

export default async function EditSalePage(props: PageProps<"/admin/ventas/[id]">) {
  await requireAdmin();
  const { id } = await props.params;
  const sale = await getSale(await getDb(), id);

  if (!sale) {
    return (
      <AdminShell active="sales">
        <PageHeader title="Venta" />
        <EmptyState
          title="No encontramos esa venta"
          description="Puede que el enlace esté mal escrito. Volvé a la lista para elegirla de nuevo."
          action={
            <Button asChild variant="ink-outline">
              <Link href="/admin/ventas">Volver a ventas</Link>
            </Button>
          }
        />
      </AdminShell>
    );
  }

  return (
    <AdminShell active="sales">
      <PageHeader
        title="Editar venta"
        description="Las ventas no se borran: si no se concretó, pasala a cancelada o reembolsada y deja de sumar."
      />
      <SavedValues sale={sale} />
      <SaleForm
        mode="edit"
        action={updateSaleAction.bind(null, sale.id)}
        initialValues={saleToFormValues(sale)}
        priceListUsd={priceListUsd()}
      />
    </AdminShell>
  );
}
