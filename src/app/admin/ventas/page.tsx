import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/admin/auth/require-admin";
import {
  hasActiveFilters,
  parseSalesQuery,
  salesQueryString,
} from "@/admin/sales/filters";
import { listSales } from "@/admin/sales/repository";
import { SalesFilters } from "@/admin/sales/sales-filters";
import { SalesTable } from "@/admin/sales/sales-table";
import { AdminShell } from "@/admin/ui/admin-shell";
import { Notice } from "@/admin/ui/notice";
import { PageHeader } from "@/admin/ui/page-header";
import { Pagination } from "@/admin/ui/pagination";
import { firstValue } from "@/admin/ui/search-params";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";

export const metadata: Metadata = { title: "Ventas" };

const PAGE_SIZE = 25;
const SALES_PATH = "/admin/ventas";

/** Avisos que deja `?guardada=` después de guardar una venta. */
const SAVED_MESSAGES: Record<string, string> = {
  creada: "Venta guardada.",
  editada: "Cambios guardados.",
};

export default async function SalesPage(props: PageProps<"/admin/ventas">) {
  await requireAdmin();
  const params = await props.searchParams;
  const { filter, page } = parseSalesQuery(params);

  const { rows, total } = await listSales(await getDb(), filter, page, PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Una página que ya no existe (se borraron filtros, cambió la lista): a la última.
  if (page > pageCount) redirect(`${SALES_PATH}${salesQueryString(filter, pageCount)}`);

  const savedMessage = SAVED_MESSAGES[firstValue(params.guardada) ?? ""];

  return (
    <AdminShell active="sales">
      <PageHeader
        title="Ventas"
        description="Todo lo que cobraste, con su valor en pesos y en dólares."
        actions={
          <>
            {/* Un archivo, no una página: un enlace común (con `Link` Next intentaría navegar a él). */}
            {total > 0 ? (
              <Button asChild variant="ink-outline">
                <a href={`${SALES_PATH}/exportar${salesQueryString(filter)}`} download>
                  Exportar CSV
                </a>
              </Button>
            ) : null}
            <Button asChild>
              <Link href={`${SALES_PATH}/nueva`}>Nueva venta</Link>
            </Button>
          </>
        }
      />
      {savedMessage ? (
        <Notice tone="ok" className="mb-5">
          {savedMessage}
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
          hrefFor={(target) => `${SALES_PATH}${salesQueryString(filter, target)}`}
        />
      ) : null}
    </AdminShell>
  );
}
