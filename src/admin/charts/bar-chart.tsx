import { ChartTable } from "@/admin/charts/chart-table";
import { barLength, niceScale } from "@/admin/charts/scale";
import { cn } from "@/lib/utils";

/** Una barra: un mes (o lo que ocupe una posición del eje). */
export interface BarDatum {
  key: string;
  /** Lo que se escribe bajo la barra: "oct". */
  axisLabel: string;
  /** Una segunda línea bajo la barra (el año), si hace falta. */
  yearLabel?: string;
  /** Cómo lo nombran los lectores de pantalla: "octubre de 2026". */
  name: string;
  /** Alto de la barra, en la unidad menor (centavos). */
  value: number;
  /** El valor ya escrito: "USD 1.264,09". */
  valueText: string;
  /** El valor abreviado para escribirlo sobre la barra ("USD 1.264"); si falta, va `valueText`. */
  shortText?: string;
  /** Un período todavía abierto: se dibuja más claro. */
  isPartial?: boolean;
}

interface BarChartProps {
  /** Distingue los `id` del título y la descripción si hay más de un gráfico en la página. */
  id: string;
  /** Qué muestra, para los lectores de pantalla (`<title>` del SVG). */
  title: string;
  /** Lo que se ve de un vistazo (`<desc>` del SVG). */
  description: string;
  data: readonly BarDatum[];
  /** Cómo se escribe una marca del eje vertical: "2.500". */
  formatTick: (minor: number) => string;
  /** Unidad del eje, arriba de las marcas: "USD". */
  unitLabel: string;
  /** Lo que se agrega al nombre de una barra todavía abierta: "mes en curso, parcial". */
  partialNote: string;
  table: {
    summary: string;
    caption: string;
    headers: readonly [string, string];
  };
  className?: string;
}

// Medidas en píxeles. El ancho no se fija: las barras se reparten en porcentajes del ancho que haya.
const PLOT_HEIGHT = 200;
const TOP_PADDING = 24;
const AXIS_BAND = 38;
const Y_AXIS_WIDTH = 46;
const BASELINE = TOP_PADDING + PLOT_HEIGHT;
const SVG_HEIGHT = BASELINE + AXIS_BAND;
/** La barra ocupa esta parte de su lugar (el resto es aire a los costados). */
const BAR_SHARE = 0.46;
const BAR_INSET = (1 - BAR_SHARE) / 2;
const ROUNDED_END = 4;
/** Un mes sin ingresos deja una marca de este alto para que el lugar no parezca vacío. */
const EMPTY_STUB = 2;

const LABEL_HALO = "[paint-order:stroke] stroke-white stroke-[3px] [stroke-linejoin:round]";

function percent(value: number): string {
  return `${value}%`;
}

/**
 * Barras verticales de una sola serie (ingresos por mes), dibujadas en SVG
 * desde el servidor. Una barra por lugar, 24 px como mucho, con la punta
 * redondeada y la base recta; líneas guía finas; el mayor valor lleva su
 * número y los demás lo muestran al pasar el mouse. Cada barra tiene su nombre
 * accesible y hay una tabla con los mismos números.
 */
export function BarChart({
  id,
  title,
  description,
  data,
  formatTick,
  unitLabel,
  partialNote,
  table,
  className,
}: BarChartProps) {
  const highest = Math.max(0, ...data.map((datum) => datum.value));
  const { max, ticks } = niceScale(highest);
  const count = data.length;
  const slot = 100 / count;
  const topIndex = highest > 0 ? data.findIndex((datum) => datum.value === highest) : -1;
  const yOf = (value: number) => BASELINE - barLength(value, max, PLOT_HEIGHT);
  const titleId = `${id}-title`;
  const descriptionId = `${id}-desc`;

  return (
    <figure className={cn("m-0", className)}>
      <div className="grid grid-cols-[2.875rem_minmax(0,1fr)]">
        <svg width={Y_AXIS_WIDTH} height={SVG_HEIGHT} aria-hidden="true" focusable="false" className="block">
          <text x={Y_AXIS_WIDTH - 8} y={10} textAnchor="end" className="fill-ink-2 text-[11px] font-semibold">
            {unitLabel}
          </text>
          {ticks.map((tick) => (
            <text
              key={tick}
              x={Y_AXIS_WIDTH - 8}
              y={yOf(tick) + 4}
              textAnchor="end"
              className="fill-ink-2 text-[11px] tabular-nums"
            >
              {formatTick(tick)}
            </text>
          ))}
        </svg>
        <svg
          width="100%"
          height={SVG_HEIGHT}
          role="group"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          focusable="false"
          className="block overflow-visible"
        >
          <title id={titleId}>{title}</title>
          <desc id={descriptionId}>{description}</desc>
          {ticks.map((tick) => (
            <line
              key={tick}
              x1="0"
              x2="100%"
              y1={yOf(tick) + 0.5}
              y2={yOf(tick) + 0.5}
              strokeWidth={1}
              className={tick === 0 ? "stroke-ink-2/45" : "stroke-rule/70"}
            />
          ))}
          {data.map((datum, index) => {
            const name = `${datum.name}: ${datum.valueText}${datum.isPartial ? ` (${partialNote})` : ""}`;
            const top = yOf(datum.value);
            const height = BASELINE - top;
            const barX = percent((index + BAR_INSET) * slot);
            const barWidth = percent(BAR_SHARE * slot);
            const center = percent((index + 0.5) * slot);
            const labelAnchor = index === 0 ? "start" : index === count - 1 ? "end" : "middle";
            const labelX = percent((index + (labelAnchor === "start" ? 0 : labelAnchor === "end" ? 1 : 0.5)) * slot);
            const fill = cn(
              datum.isPartial ? "fill-zone-soft" : "fill-zone",
              "transition-[fill] duration-150 group-hover:fill-beam",
            );

            return (
              <g key={datum.key} role="img" aria-label={name} className="group" data-testid="bar" data-month={datum.key}>
                <title>{name}</title>
                <rect x={percent(index * slot)} y={0} width={percent(slot)} height={BASELINE} className="fill-transparent" />
                {datum.value <= 0 ? (
                  <rect x={barX} y={BASELINE - EMPTY_STUB} width={barWidth} height={EMPTY_STUB} className="fill-rule" />
                ) : height <= ROUNDED_END ? (
                  <rect x={barX} y={top} width={barWidth} height={height} className={fill} />
                ) : (
                  <>
                    <rect x={barX} y={top} width={barWidth} height={height} rx={ROUNDED_END} className={fill} />
                    <rect
                      x={barX}
                      y={top + ROUNDED_END}
                      width={barWidth}
                      height={height - ROUNDED_END}
                      className={fill}
                    />
                  </>
                )}
                {datum.value > 0 ? (
                  <text
                    x={labelX}
                    y={top - 6}
                    textAnchor={labelAnchor}
                    className={cn(
                      "pointer-events-none fill-ink text-[12px] font-bold tabular-nums",
                      LABEL_HALO,
                      index !== topIndex &&
                        "opacity-0 transition-opacity duration-150 group-hover:opacity-100",
                    )}
                  >
                    {datum.shortText ?? datum.valueText}
                  </text>
                ) : null}
                <text
                  x={center}
                  y={BASELINE + 17}
                  textAnchor="middle"
                  className={cn("text-[11px]", datum.isPartial ? "fill-ink font-bold" : "fill-ink-2")}
                >
                  {datum.axisLabel}
                </text>
                {datum.yearLabel ? (
                  <text x={center} y={BASELINE + 31} textAnchor="middle" className="fill-ink-2 text-[11px]">
                    {datum.yearLabel}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <ChartTable
        summary={table.summary}
        caption={table.caption}
        headers={table.headers}
        rows={data.map((datum) => [
          datum.isPartial ? `${datum.name} (${partialNote})` : datum.name,
          datum.valueText,
        ])}
      />
    </figure>
  );
}
