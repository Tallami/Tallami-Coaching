import { BarChart, type BarDatum } from "@/admin/charts/bar-chart";
import { monthLabels } from "@/admin/overview/labels";
import type { OverviewData } from "@/admin/overview/overview-data";
import { SectionCard } from "@/admin/overview/section-card";
import { formatMoney } from "@/lib/money";

const PARTIAL_NOTE = "mes en curso, parcial";

/** Una marca del eje vertical en dólares enteros: 2500 → "2.500". */
function formatTick(minor: number): string {
  return formatMoney(minor, "USD", { decimals: 0 }).replace(/^USD /, "");
}

function toBars(months: OverviewData["months"]): BarDatum[] {
  return months.map((month, index) => {
    const labels = monthLabels(month.month);
    const isFirstOrJanuary = index === 0 || month.month.endsWith("-01");
    return {
      key: month.month,
      axisLabel: labels.short,
      yearLabel: isFirstOrJanuary ? month.month.slice(0, 4) : undefined,
      name: labels.long,
      value: month.usdMinor,
      valueText: formatMoney(month.usdMinor, "USD"),
      shortText: formatMoney(month.usdMinor, "USD", { decimals: 0 }),
      isPartial: index === months.length - 1,
    };
  });
}

function Legend() {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1 p-0 text-[0.875rem] text-ink-2">
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="size-3 rounded-[2px] bg-zone" />
        Mes completo
      </li>
      <li className="flex items-center gap-2">
        <span aria-hidden="true" className="size-3 rounded-[2px] bg-zone-soft" />
        Mes en curso, hasta hoy
      </li>
    </ul>
  );
}

/** Ingresos por mes de los últimos 12 meses, en dólares. No depende del período elegido. */
export function MonthlyIncome({ data }: { data: OverviewData }) {
  const { months } = data;
  const current = months[months.length - 1];
  const highest = months.reduce((best, month) => (month.usdMinor > best.usdMinor ? month : best), months[0]);
  const hasIncome = highest.usdMinor > 0;
  const currentLabels = monthLabels(current.month);
  const bestLabels = monthLabels(highest.month);

  return (
    <SectionCard
      id="ingresos-por-mes"
      testId="monthly-income"
      title="Ingresos por mes"
      description="Dólares cobrados en los últimos 12 meses. No cambia con el período que elijas arriba."
    >
      {hasIncome ? (
        <>
          <dl className="mb-3 flex flex-wrap gap-x-8 gap-y-2">
            <div>
              <dt className="text-[0.875rem] text-ink-2">{currentLabels.long}, hasta hoy</dt>
              <dd className="text-[1.25rem] font-extrabold tabular-nums">{formatMoney(current.usdMinor, "USD")}</dd>
            </div>
            <div>
              <dt className="text-[0.875rem] text-ink-2">Mejor mes</dt>
              <dd className="text-[1.25rem] font-extrabold">
                {bestLabels.long}
                <span className="font-semibold text-ink-2"> · </span>
                <span className="tabular-nums">{formatMoney(highest.usdMinor, "USD")}</span>
              </dd>
            </div>
          </dl>
          <Legend />
          <BarChart
            id="monthly-income"
            className="mt-3"
            title="Ingresos cobrados por mes, en dólares"
            description={`De ${monthLabels(months[0].month).long} a ${currentLabels.long}. El mejor mes fue ${bestLabels.long}, con ${formatMoney(highest.usdMinor, "USD")}.`}
            data={toBars(months)}
            formatTick={formatTick}
            unitLabel="USD"
            partialNote={PARTIAL_NOTE}
            table={{
              summary: "Ver los números como tabla",
              caption: "Ingresos cobrados por mes, en dólares, de los últimos 12 meses",
              headers: ["Mes", "Cobrado en dólares"],
            }}
          />
        </>
      ) : (
        <p className="text-ink-2">Todavía no hay ingresos cobrados en los últimos 12 meses.</p>
      )}
    </SectionCard>
  );
}
