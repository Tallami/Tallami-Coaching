import type { Metadata } from "next";
import { requireAdmin } from "@/admin/auth/require-admin";
import { searchCustomers } from "@/admin/customers/repository";
import { todayInArgentina } from "@/admin/dates";
import { emptySaleFormValues } from "@/admin/sales/form-values";
import { priceListUsd } from "@/admin/sales/price-list";
import { SaleForm } from "@/admin/sales/sale-form";
import { AdminShell } from "@/admin/ui/admin-shell";
import { PageHeader } from "@/admin/ui/page-header";
import { getDb } from "@/db/client";
import { createSaleAction } from "../actions";

export const metadata: Metadata = { title: "Nueva venta" };

export default async function NewSalePage() {
  await requireAdmin();
  const hasCustomers = (await searchCustomers(await getDb(), "", 1)).length > 0;

  return (
    <AdminShell active="sales">
      <PageHeader
        title="Nueva venta"
        description="Los campos sin «(opcional)» son obligatorios."
      />
      <SaleForm
        mode="create"
        action={createSaleAction}
        initialValues={emptySaleFormValues(todayInArgentina(), hasCustomers)}
        priceListUsd={priceListUsd()}
      />
    </AdminShell>
  );
}
