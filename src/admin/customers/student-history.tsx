import Link from "next/link";
import { INCOME_STATUSES, ITEM_LABELS, type SaleStatus } from "@/admin/catalog";
import { formatDay } from "@/admin/dates";
import { ADMIN_ROUTES, saleHref } from "@/admin/routes";
import type { SaleRow } from "@/admin/sales/repository";
import { SaleStatusBadge } from "@/admin/sales/status-badge";
import { EmptyState } from "@/admin/ui/empty-state";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const INCOME: readonly SaleStatus[] = INCOME_STATUSES;

interface StudentHistoryProps {
  /** Todas las ventas del alumno, con su estado. */
  sales: readonly SaleRow[];
}

const numberCell = "text-right whitespace-nowrap tabular-nums";

/**
 * Todas las ventas del alumno, también las canceladas, reembolsadas y
 * pendientes. Las que no suman al total gastado se ven en gris. Cada una abre
 * su edición en Ventas.
 */
export function StudentHistory({ sales }: StudentHistoryProps) {
  if (sales.length === 0) {
    return (
      <EmptyState
        title="Todavía no tiene ventas"
        description="Cada venta que cargues a este alumno aparece acá, con su estado."
        action={
          <Button asChild>
            <Link href={ADMIN_ROUTES.newSale}>Cargar una venta</Link>
          </Button>
        }
      />
    );
  }

  const headingId = "student-history-heading";
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-[1.5rem] leading-tight font-extrabold [font-stretch:75%]">
        Historial de ventas
      </h2>
      <p className="mt-1 mb-3 max-w-prose text-[0.9375rem] text-ink-2">
        Solo cuentan las ventas cobradas o entregadas; el resto queda acá como registro.
      </p>
      <div className="border-2 border-ink bg-white">
        <Table
          className="min-w-[40rem]"
          containerProps={{ role: "region", "aria-label": "Ventas del alumno", tabIndex: 0 }}
        >
          <TableHeader>
            <TableRow className="border-b-0 hover:bg-transparent focus-within:bg-transparent">
              <TableHead scope="col">Cobro</TableHead>
              <TableHead scope="col">Servicio</TableHead>
              <TableHead scope="col">Estado</TableHead>
              <TableHead scope="col" className="text-right">
                Monto
              </TableHead>
              <TableHead scope="col" className="text-right">
                En dólares
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.map((sale) => {
              const counts = INCOME.includes(sale.status);
              return (
                <TableRow key={sale.id}>
                  <TableCell className="whitespace-nowrap">
                    {sale.paidOn ? (
                      formatDay(sale.paidOn)
                    ) : (
                      <span className="text-ink-2">Sin fecha</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={saleHref(sale.id)}
                      prefetch={false}
                      className="rounded-[2px] font-bold underline decoration-ink-2/50 underline-offset-4 hover:decoration-ink"
                    >
                      {ITEM_LABELS[sale.item]}
                    </Link>
                    {sale.description ? (
                      <div className="mt-0.5 max-w-[16rem] text-[0.875rem] text-ink-2">
                        {sale.description}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <SaleStatusBadge status={sale.status} />
                  </TableCell>
                  <TableCell className={cn(numberCell, counts ? "font-bold" : "text-ink-2")}>
                    {formatMoney(sale.amountMinor, sale.currency)}
                  </TableCell>
                  <TableCell className={cn(numberCell, !counts && "text-ink-2")}>
                    {formatMoney(sale.amountUsdMinor, "USD")}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
