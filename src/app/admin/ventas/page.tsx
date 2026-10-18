import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/admin/auth/require-admin";
import { exportErrorNotice } from "@/admin/export/notices";
import { PAGE_SIZE } from "@/admin/limits";
import { ADMIN_ROUTES } from "@/admin/routes";
import {
  hasActiveFilters,
  parseSalesQuery,
  salesQueryString,
} from "@/admin/sales/filters";
import { listSales } from "@/admin/sales/repository";
import { savedSaleMessage } from "@/admin/sales/saved-message";
import { SalesFilters } from "@/admin/sales/sales-filters";
import { SalesTable } from "@/admin/sales/sales-table";
import { Notice } from "@/admin/ui/notice";
import { PageHeader } from "@/admin/ui/page-header";
import { Pagination } from "@/admin/ui/pagination";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { PanelShell } from "@/app/admin/panel-shell";

export const metadata: Metadata = { title: "Ventas" };

export default async function SalesPage(props: PageProps<"/admin/ventas">) {
  await requireAdmin();
  const params = await props.searchParams;
  const { filter, page } = parseSalesQuery(params);

  const { rows, total } = await listSales(await getDb(), filter, page, PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Una página que ya no existe (se borraron filtros, cambió la lista): a la última.
  if (page > pageCount) redirect(`${ADMIN_ROUTES.sales}${salesQueryString(filter, pageCount)}`);

  const savedMessage = savedSaleMessage(params.guardada);
  // Una descarga que no se pudo armar vuelve acá con el motivo en la dirección.
  const exportError = exportErrorNotice(params.exportacion);

  return (
    <PanelShell active="sales">
      <PageHeader
        title="Ventas"
        description="Todo lo que cobraste, con su valor en pesos y en dólares."
        actions={
          <>
            {/*
              Un archivo, no una página: un enlace común (con `Link` Next intentaría navegar a él),
              sin `download`: la respuesta ya es un adjunto, y si no se puede armar vuelve a esta
              lista con un aviso (con `download` el navegador bajaría ese aviso como si fuera el archivo).
            */}
            {total > 0 ? (
              <Button asChild variant="ink-outline">
                <a href={`${ADMIN_ROUTES.salesExport}${salesQueryString(filter)}`}>Exportar CSV</a>
              </Button>
            ) : null}
            <Button asChild>
              <Link href={ADMIN_ROUTES.newSale}>Nueva venta</Link>
            </Button>
          </>
        }
      />
      {savedMessage ? (
        <Notice tone="ok" className="mb-5">
          {savedMessage}
        </Notice>
      ) : null}
      {exportError ? (
        <Notice tone="error" className="mb-5">
          {exportError}
        </Notice>
      ) : null}
      {/* Sin ventas ni filtros no hay nada que filtrar: queda solo la invitación a cargar la primera. */}
      {total > 0 || hasActiveFilters(filter) ? <SalesFilters filter={filter} /> : null}
      <SalesTable rows={rows} hasFilters={hasActiveFilters(filter)} />
      {total > 0 ? (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          noun="ventas"
          singularNoun="venta"
          hrefFor={(target) => `${ADMIN_ROUTES.sales}${salesQueryString(filter, target)}`}
        />
      ) : null}
    </PanelShell>
  );
}
