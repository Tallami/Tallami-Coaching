import Link from "next/link";
import { ITEM_LABELS, PAYMENT_LABELS } from "@/admin/catalog";
import { formatDay } from "@/admin/dates";
import { ADMIN_ROUTES, saleHref } from "@/admin/routes";
import type { SaleRow } from "@/admin/sales/repository";
import { InvoiceStatusBadge, SaleStatusBadge } from "@/admin/sales/status-badge";
import { EmptyState } from "@/admin/ui/empty-state";
import { Badge } from "@/components/ui/badge";
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


interface SalesTableProps {
  rows: readonly SaleRow[];
  /** Hay filtros puestos: una lista vacía significa "nada coincide", no "no hay ventas". */
  hasFilters: boolean;
}

const numberCell = "text-right whitespace-nowrap tabular-nums";

/** La lista de ventas. Si es más ancha que la pantalla, se desplaza dentro de su recuadro. */
export function SalesTable({ rows, hasFilters }: SalesTableProps) {
  if (rows.length === 0) {
    return hasFilters ? (
      <EmptyState
        title="Ninguna venta coincide con los filtros"
        description="Probá con otras fechas o con un texto más corto."
        action={
          <Button asChild variant="ink-outline" size="sm">
            <Link href={ADMIN_ROUTES.sales}>Ver todas las ventas</Link>
          </Button>
        }
      />
    ) : (
      <EmptyState
        title="Todavía no hay ventas"
        description="Cada venta que cargues suma a tus ingresos y a lo que tenés para facturar."
        action={
          <Button asChild>
            <Link href={ADMIN_ROUTES.newSale}>Cargá tu primera venta</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="border-2 border-ink bg-white">
      <Table
        className="min-w-[64rem]"
        containerProps={{ role: "region", "aria-label": "Ventas", tabIndex: 0 }}
      >
        <TableHeader>
          <TableRow className="border-b-0 hover:bg-transparent focus-within:bg-transparent">
            <TableHead>Cobro</TableHead>
            <TableHead>Alumno</TableHead>
            <TableHead>Servicio</TableHead>
            <TableHead>Medio</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="text-right">Monto</TableHead>
            <TableHead className="text-right">En pesos</TableHead>
            <TableHead className="text-right">En dólares</TableHead>
            <TableHead>Factura</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((sale) => (
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
                  {sale.customerName}
                </Link>
                {sale.customerDiscord || sale.customerCountry ? (
                  <div className="mt-0.5 flex items-center gap-2 text-[0.875rem] text-ink-2">
                    {sale.customerDiscord ? <span>{sale.customerDiscord}</span> : null}
                    {sale.customerCountry ? <Badge variant="outline">{sale.customerCountry}</Badge> : null}
                  </div>
                ) : null}
              </TableCell>
              <TableCell>
                <span className="font-semibold">{ITEM_LABELS[sale.item]}</span>
                {sale.description ? (
                  <div className="mt-0.5 max-w-[16rem] text-[0.875rem] text-ink-2">{sale.description}</div>
                ) : null}
              </TableCell>
              <TableCell className="whitespace-nowrap">{PAYMENT_LABELS[sale.paymentMethod]}</TableCell>
              <TableCell>
                <SaleStatusBadge status={sale.status} />
              </TableCell>
              <TableCell className={cn(numberCell, "font-bold")}>
                {formatMoney(sale.amountMinor, sale.currency)}
              </TableCell>
              <TableCell className={numberCell}>{formatMoney(sale.amountArsMinor, "ARS")}</TableCell>
              <TableCell className={numberCell}>{formatMoney(sale.amountUsdMinor, "USD")}</TableCell>
              <TableCell>
                <InvoiceStatusBadge status={sale.invoiceStatus} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
