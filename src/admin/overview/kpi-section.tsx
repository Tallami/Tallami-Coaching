import { DeltaBadge } from "@/admin/charts/delta-badge";
import { PERIOD_LABELS } from "@/admin/metrics/period";
import { formatPercent, formatRangeLabel } from "@/admin/overview/labels";
import { MoneyFigure } from "@/admin/overview/money-figure";
import type { OverviewData } from "@/admin/overview/overview-data";
import { formatMoney } from "@/lib/money";

/** Con menos días que estos, comparar contra el período anterior dice poco. */
const FEW_DAYS = 7;

interface StatProps {
  testId: string;
  label: string;
  value: string;
  caption: string;
}

/** Un indicador chico: nombre, número y una línea que explica qué cuenta. */
function Stat({ testId, label, value, caption }: StatProps) {
  return (
    <div data-testid={testId} className="border-2 border-ink bg-white px-4 py-3.5">
      <dt className="text-[0.9375rem] font-semibold text-ink-2">{label}</dt>
      <dd className="mt-1.5 text-[2rem] leading-none font-extrabold whitespace-nowrap [font-stretch:75%]">
        {value}
      </dd>
      <dd className="mt-1.5 text-[0.875rem] leading-snug text-ink-2">{caption}</dd>
    </div>
  );
}

/**
 * Las tarjetas del período. Arriba, lo que se cobró en dólares (el número que
 * manda, con su variación y contra qué tramo se compara) y en pesos (sin
 * variación: los pesos se mueven con el dólar). Abajo, cuatro indicadores.
 */
export function KpiSection({ data }: { data: OverviewData }) {
  const { kpis, range, previousRange, today, period, rangeDays, previousIncomeUsdMinor } = data;
  const hasSales = kpis.salesCount > 0;
  const days = rangeDays === 1 ? "1 día" : `${rangeDays} días`;

  return (
    <section aria-labelledby="indicadores-title" className="mb-6">
      <h2 id="indicadores-title" className="sr-only">
        Indicadores del período
      </h2>
      <div className="stage grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] border-l-[6px] border-l-gold narrow:grid-cols-1">
        <div data-testid="kpi-income-usd" className="px-6 py-5 narrow:px-5">
          <p className="text-[1rem] font-semibold text-on-stage-2">Cobrado en dólares</p>
          <p className="mt-1 text-[clamp(2.75rem,6vw,4.25rem)] leading-[1.05] font-extrabold [font-stretch:75%]">
            <MoneyFigure text={formatMoney(kpis.incomeUsdMinor, "USD")} />
          </p>
          <p className="mt-1 text-[0.9375rem] text-on-stage-2">
            {PERIOD_LABELS[period]}, {formatRangeLabel(range, today)}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <DeltaBadge pct={kpis.incomeUsdDeltaPct} />
            <p className="text-[0.9375rem] text-on-stage-2">
              vs. {formatRangeLabel(previousRange, today)} ({formatMoney(previousIncomeUsdMinor, "USD")})
            </p>
          </div>
          {rangeDays < FEW_DAYS ? (
            <p className="mt-2 text-[0.9375rem] font-semibold text-gold">
              Pocos días para comparar: el período lleva solo {days}.
            </p>
          ) : null}
        </div>
        <div
          data-testid="kpi-income-ars"
          className="border-t border-stage-line px-6 py-5 narrow:px-5 min-[901px]:border-t-0 min-[901px]:border-l"
        >
          <p className="text-[1rem] font-semibold text-on-stage-2">Cobrado en pesos</p>
          <p className="mt-1 text-[clamp(1.875rem,3.4vw,2.5rem)] leading-[1.1] font-extrabold [font-stretch:75%]">
            <MoneyFigure text={formatMoney(kpis.incomeArsMinor, "ARS")} />
          </p>
          <p className="mt-2 max-w-[28ch] text-[0.9375rem] text-on-stage-2">
            Cada venta al tipo de cambio de su día de cobro.
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-4 gap-4 narrow:grid-cols-2 narrow:gap-3">
        <Stat
          testId="kpi-sales"
          label="Ventas cobradas"
          value={String(kpis.salesCount)}
          caption="cobradas o entregadas"
        />
        <Stat
          testId="kpi-average-ticket"
          label="Ticket promedio"
          value={hasSales ? formatMoney(kpis.avgTicketUsdMinor, "USD") : "—"}
          caption="en dólares, por venta"
        />
        <Stat
          testId="kpi-new-students"
          label="Alumnos nuevos"
          value={String(kpis.newCustomers)}
          caption="primera compra en el período"
        />
        <Stat
          testId="kpi-repeat-rate"
          label="Recompra"
          value={hasSales ? formatPercent(kpis.repeatRatePct) : "—"}
          caption="ya habían comprado antes"
        />
      </dl>
    </section>
  );
}
