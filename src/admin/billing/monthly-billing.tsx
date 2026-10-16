import type { BillingAmounts, BillingTotals, MonthBilling } from "@/admin/billing/summary";
import { monthLabels } from "@/admin/overview/labels";
import { SectionCard } from "@/admin/overview/section-card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

interface MonthlyBillingProps {
  /** Los últimos meses, el actual primero. */
  months: readonly MonthBilling[];
  total: BillingTotals;
  className?: string;
}

const numberCell = "text-right whitespace-nowrap tabular-nums";

/** Un monto en pesos, o una raya si ese mes no tuvo nada (se lee más rápido que una columna de ceros). */
function Pesos({ amounts, className }: { amounts: BillingAmounts; className?: string }) {
  if (amounts.count === 0) {
    return (
      <span className="text-ink-2">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Sin ventas</span>
      </span>
    );
  }
  return <span className={className}>{formatMoney(amounts.arsMinor, "ARS")}</span>;
}

function Row({ month, isCurrent }: { month: MonthBilling; isCurrent: boolean }) {
  const { collected, invoiced, notRequired, pending } = month;
  return (
    <TableRow data-testid="billing-month" data-month={month.month}>
      <TableHead scope="row" className="h-auto py-3 align-top font-semibold whitespace-nowrap">
        {monthLabels(month.month).long}
        {isCurrent ? <span className="ml-2 text-[0.8125rem] font-normal text-ink-2">hasta hoy</span> : null}
      </TableHead>
      <TableCell className={numberCell}>{collected.count === 0 ? "—" : collected.count}</TableCell>
      <TableCell className={numberCell}>
        <Pesos amounts={collected} className="font-bold" />
        {collected.count > 0 ? (
          <div className="text-[0.8125rem] text-ink-2">{formatMoney(collected.usdMinor, "USD")}</div>
        ) : null}
      </TableCell>
      <TableCell className={numberCell}>
        <Pesos amounts={invoiced} />
      </TableCell>
      <TableCell className={numberCell}>
        <Pesos amounts={notRequired} />
      </TableCell>
      <TableCell className={cn(numberCell, pending.count > 0 && "font-bold text-warn-ink")}>
        <Pesos amounts={pending} />
      </TableCell>
    </TableRow>
  );
}

/**
 * Lo cobrado en cada uno de los últimos 12 meses y cuánto de eso está
 * facturado, no requiere factura o falta facturar. Cada venta cuenta en el mes
 * de su fecha de cobro; lo cobrado de cada mes es siempre la suma de las otras
 * tres columnas.
 */
export function MonthlyBilling({ months, total, className }: MonthlyBillingProps) {
  return (
    <SectionCard
      id="cobrado-y-facturado"
      testId="monthly-billing"
      className={className}
      title="Cobrado y facturado, mes a mes"
      description="Lo cobrado en cada uno de los últimos 12 meses de calendario y cuánto de eso ya tiene factura. Todo en pesos; abajo de lo cobrado, su valor en dólares."
    >
      <div className="border-2 border-ink bg-white">
        <Table
          className="min-w-[46rem]"
          containerProps={{ role: "region", "aria-label": "Cobrado y facturado por mes", tabIndex: 0 }}
        >
          <TableHeader>
            <TableRow className="border-b-0 hover:bg-transparent focus-within:bg-transparent">
              <TableHead>Mes</TableHead>
              <TableHead className="text-right">Ventas</TableHead>
              <TableHead className="text-right">Cobrado</TableHead>
              <TableHead className="text-right">Facturado</TableHead>
              <TableHead className="text-right">No requiere</TableHead>
              <TableHead className="text-right">Sin facturar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((month, index) => (
              <Row key={month.month} month={month} isCurrent={index === 0} />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-neutral-tint" data-testid="billing-total">
              <TableHead scope="row" className="h-auto py-3 align-top font-extrabold whitespace-nowrap">
                {`Total de ${months.length} meses`}
              </TableHead>
              <TableCell className={numberCell}>{total.collected.count}</TableCell>
              <TableCell className={numberCell}>
                {formatMoney(total.collected.arsMinor, "ARS")}
                <div className="text-[0.8125rem] font-normal text-ink-2">
                  {formatMoney(total.collected.usdMinor, "USD")}
                </div>
              </TableCell>
              <TableCell className={numberCell}>{formatMoney(total.invoiced.arsMinor, "ARS")}</TableCell>
              <TableCell className={numberCell}>{formatMoney(total.notRequired.arsMinor, "ARS")}</TableCell>
              <TableCell className={cn(numberCell, total.pending.count > 0 && "text-warn-ink")}>
                {formatMoney(total.pending.arsMinor, "ARS")}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
      <p className="mt-3 max-w-prose text-[0.875rem] leading-snug text-ink-2">
        Cada venta cuenta en el mes de su fecha de cobro, no en el de su factura. «No requiere» son las ventas que
        marcaste sin factura. El medidor del monotributo suma los 12 meses móviles hasta hoy, no meses de calendario:
        su total puede ser distinto del de esta tabla.
      </p>
    </SectionCard>
  );
}
