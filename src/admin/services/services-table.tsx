import { ITEM_LABELS } from "@/admin/catalog";
import { MiniBars, type MiniBar } from "@/admin/charts/mini-bars";
import { formatDay } from "@/admin/dates";
import { formatPercent, monthLabels } from "@/admin/overview/labels";
import { formatDaysAgo } from "@/admin/services/labels";
import type { ServiceRow, ServicesReport } from "@/admin/services/report";
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

const PARTIAL_NOTE = "mes en curso";

const numberCell = "text-right whitespace-nowrap tabular-nums";
/** El nombre del servicio queda fijo a la izquierda mientras la tabla se desplaza (hover opaco: nada se transparenta). */
const stickyCell =
  "sticky left-0 z-[1] bg-white group-hover/row:bg-[color-mix(in_srgb,var(--color-gold)_15%,white)] group-focus-within/row:bg-[color-mix(in_srgb,var(--color-gold)_15%,white)]";

/** En el celular el nombre se parte en líneas: un nombre entero fijo a la izquierda se comería la pantalla. */
const nameCell = "max-[520px]:w-[7.5rem] max-[520px]:whitespace-normal";

/** Un guion que no dice "raya" en voz alta: el lector de pantalla recibe el motivo. */
function Dash({ reason }: { reason: string }) {
  return (
    <span role="img" aria-label={reason} title={reason} className="text-ink-2">
      —
    </span>
  );
}

function toMiniBars(row: ServiceRow): MiniBar[] {
  return row.trend.map((month, index) => ({
    key: month.month,
    name: monthLabels(month.month).long,
    value: month.usdMinor,
    valueText: formatMoney(month.usdMinor, "USD"),
    isPartial: index === row.trend.length - 1,
  }));
}

function ServiceTableRow({ row, today }: { row: ServiceRow; today: string }) {
  // Un servicio sin ventas ni clics en el período queda en gris: lo que cuenta es lo que se movió.
  const isQuiet = row.sales === 0 && !row.clicks;
  const quiet = isQuiet ? "text-ink-2" : undefined;

  return (
    <TableRow data-testid="service-row" data-item={row.item} className="group/row">
      <TableHead scope="row" data-col="item" className={cn("h-auto px-3 py-3 align-top text-[0.9375rem]", nameCell, stickyCell)}>
        {ITEM_LABELS[row.item]}
      </TableHead>
      <TableCell data-col="sales" className={cn(numberCell, "font-bold", quiet)}>
        {row.sales}
      </TableCell>
      <TableCell data-col="income" className={cn(numberCell, quiet)}>
        {formatMoney(row.incomeUsdMinor, "USD")}
      </TableCell>
      <TableCell data-col="avg" className={cn(numberCell, quiet)}>
        {row.avgTicketUsdMinor === null ? (
          <Dash reason="sin ventas en el período" />
        ) : (
          formatMoney(row.avgTicketUsdMinor, "USD")
        )}
      </TableCell>
      <TableCell data-col="share" className={cn(numberCell, quiet)}>
        {formatPercent(row.sharePct)}
      </TableCell>
      <TableCell data-col="trend" className="pr-6">
        <MiniBars bars={toMiniBars(row)} label="Ingresos por mes" partialNote={PARTIAL_NOTE} />
      </TableCell>
      <TableCell data-col="last" className="whitespace-nowrap">
        {row.lastSaleOn === null ? (
          <Dash reason="sin ventas" />
        ) : (
          <>
            {formatDay(row.lastSaleOn)}
            <span className="block text-[0.8125rem] text-ink-2">{formatDaysAgo(row.lastSaleOn, today)}</span>
          </>
        )}
      </TableCell>
      <TableCell data-col="clicks" className={cn(numberCell, "font-bold", quiet)}>
        {row.clicks === null ? <Dash reason="este servicio no tiene botón propio en el sitio" /> : row.clicks}
      </TableCell>
      <TableCell data-col="conversion" className={cn(numberCell, "font-bold")}>
        {row.conversionPct === null ? (
          <Dash reason={row.clicks === null ? "sin botón en el sitio" : "sin clics en el período"} />
        ) : (
          <>
            {formatPercent(row.conversionPct)}{" "}
            {row.includedPackSales > 0 ? (
              <span className="ml-auto block max-w-[10rem] text-[0.8125rem] leading-snug font-normal whitespace-normal text-balance text-ink-2">
                incluye {row.includedPackSales} {row.includedPackSales === 1 ? "venta" : "ventas"} del pack
              </span>
            ) : null}
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

/** La tabla de servicios. Si es más ancha que la pantalla, se desplaza dentro de su recuadro con el nombre fijo. */
export function ServicesTable({ report }: { report: ServicesReport }) {
  return (
    <div className="border-2 border-ink bg-white">
      <Table
        className="min-w-[62rem]"
        containerProps={{ role: "region", "aria-label": "Servicios: ventas, ingresos y clics", tabIndex: 0 }}
      >
        <TableHeader>
          <TableRow className="border-b-0 hover:bg-transparent focus-within:bg-transparent">
            <TableHead className={cn(nameCell, "sticky left-0 z-[1] bg-stage")}>Servicio</TableHead>
            <TableHead className="text-right">Ventas</TableHead>
            <TableHead className="text-right">Ingresos</TableHead>
            <TableHead className="text-right">Ticket promedio</TableHead>
            <TableHead className="text-right">% del total</TableHead>
            <TableHead>
              Últimos 6 meses{" "}
              <span className="block text-[0.75rem] font-normal text-on-stage-2">(escala propia)</span>
            </TableHead>
            <TableHead>Última venta</TableHead>
            <TableHead className="text-right">Clics en Reservar</TableHead>
            <TableHead className="text-right">Conversión</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {report.rows.map((row) => (
            <ServiceTableRow key={row.item} row={row} today={report.today} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
