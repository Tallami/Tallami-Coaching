import { HBarChart, type HBarRow } from "@/admin/charts/hbar-chart";
import { ITEM_LABELS, PAYMENT_LABELS } from "@/admin/catalog";
import { Badge } from "@/components/ui/badge";
import { formatPercent, formatRangeLabel, countryLabel } from "@/admin/overview/labels";
import { PERIOD_LABELS } from "@/admin/metrics/period";
import { DEFAULT_DAYS_WITHOUT_SALES } from "@/admin/metrics/series";
import type { OverviewData } from "@/admin/overview/overview-data";
import { SectionCard } from "@/admin/overview/section-card";
import { formatMoney } from "@/lib/money";

const SHARE_NOTE = "Porcentajes redondeados a un decimal; el reparto hace que sumen 100 %.";

interface Group {
  count: number;
  usdMinor: number;
  sharePct: number;
}

/** "20 ventas · 20,7 %": cuántas ventas fueron y qué parte del total del período. */
function detailOf({ count, sharePct }: Group): string {
  return `${count} ${count === 1 ? "venta" : "ventas"} · ${formatPercent(sharePct)}`;
}

function toRow(key: string, label: string, group: Group): HBarRow {
  return {
    key,
    label,
    value: group.usdMinor,
    valueText: formatMoney(group.usdMinor, "USD"),
    detail: detailOf(group),
    title: `${formatPercent(group.sharePct)} del total del período (redondeado a un decimal)`,
  };
}

function scopeOf(data: OverviewData): string {
  return `Período: ${PERIOD_LABELS[data.period].toLowerCase()} (${formatRangeLabel(data.range, data.today)}). Dólares cobrados.`;
}

/** Las barras de un desglose con la nota de los porcentajes, o el aviso de que el período no tuvo ventas. */
function Breakdown({ rows, ariaLabel }: { rows: readonly HBarRow[]; ariaLabel: string }) {
  if (rows.length === 0) return <p className="text-ink-2">Sin ventas cobradas en este período.</p>;
  return (
    <>
      <HBarChart rows={rows} ariaLabel={ariaLabel} />
      <p className="mt-4 text-[0.8125rem] leading-snug text-ink-2">{SHARE_NOTE}</p>
    </>
  );
}

/** Ingresos por servicio, y los servicios que no vendieron nada en los últimos 90 días. */
export function ItemsCard({ data }: { data: OverviewData }) {
  const rows = data.byItem.map((entry) => toRow(entry.item, ITEM_LABELS[entry.item], entry));
  return (
    <SectionCard id="servicios" testId="items-income" title="Ingresos por servicio" description={scopeOf(data)}>
      <Breakdown rows={rows} ariaLabel="Ingresos por servicio" />
      <div data-testid="items-without-sales" className="mt-5 border-t border-rule pt-4">
        <h3 className="text-[1.0625rem] font-extrabold [font-stretch:75%]">
          Sin ventas en los últimos {DEFAULT_DAYS_WITHOUT_SALES} días
        </h3>
        {data.withoutSales.length > 0 ? (
          <ul className="mt-2 flex list-none flex-wrap gap-2 p-0">
            {data.withoutSales.map((item) => (
              <li key={item}>
                <Badge variant="warn">{ITEM_LABELS[item]}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-ink-2">Todos los servicios vendieron en ese tiempo.</p>
        )}
      </div>
    </SectionCard>
  );
}

/** Ingresos por medio de pago. */
export function PaymentsCard({ data }: { data: OverviewData }) {
  const rows = data.byPayment.map((entry) => toRow(entry.paymentMethod, PAYMENT_LABELS[entry.paymentMethod], entry));
  return (
    <SectionCard id="medios-de-pago" testId="payments-income" title="Medios de pago" description={scopeOf(data)}>
      <Breakdown rows={rows} ariaLabel="Ingresos por medio de pago" />
    </SectionCard>
  );
}

/** Ingresos por país del alumno, con el nombre del país en español. */
export function CountriesCard({ data }: { data: OverviewData }) {
  const rows = data.byCountry.map((entry) => toRow(entry.country, countryLabel(entry.country), entry));
  return (
    <SectionCard id="paises" testId="countries-income" title="Países de los alumnos" description={scopeOf(data)}>
      <Breakdown rows={rows} ariaLabel="Ingresos por país del alumno" />
    </SectionCard>
  );
}
