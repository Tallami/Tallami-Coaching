import { barLength } from "@/admin/charts/scale";
import { cn } from "@/lib/utils";

/** Una barra de la tendencia: un mes. */
export interface MiniBar {
  key: string;
  /** Cómo lo nombran los lectores de pantalla: "octubre de 2026". */
  name: string;
  /** Alto de la barra, en la unidad menor (centavos). */
  value: number;
  /** El valor ya escrito: "USD 80,00". */
  valueText: string;
  /** Un mes todavía abierto: se dibuja más claro. */
  isPartial?: boolean;
}

interface MiniBarsProps {
  bars: readonly MiniBar[];
  /** Qué mide, para los lectores de pantalla: "Ingresos por mes". */
  label: string;
  /** Lo que se agrega al nombre de la barra todavía abierta: "mes en curso". */
  partialNote: string;
  className?: string;
}

// Medidas en píxeles: una tendencia chica dentro de una celda de tabla.
const BAR_WIDTH = 10;
const BAR_GAP = 5;
const PLOT_HEIGHT = 30;
const BASELINE_HEIGHT = 1;
const ROUNDED_END = 3;
/** Un mes sin ingresos deja una marca de este alto para que el lugar no parezca vacío. */
const EMPTY_STUB = 2;

/**
 * Barras chicas de una sola serie (la tendencia de un servicio), dibujadas en
 * SVG desde el servidor y sin ejes ni números: el largo cuenta la forma, el
 * valor exacto va en el nombre accesible y en el texto que muestra el mouse al
 * pasar por cada barra. La escala es la de la propia serie (el mayor mes llena
 * el alto), así que sirve para ver si un servicio sube o baja, no para comparar
 * servicios entre sí: para eso están las columnas de ingresos. Las barras
 * nacen de una base común, con la punta redondeada y la base recta; el mes en
 * curso, todavía abierto, va más claro.
 */
export function MiniBars({ bars, label, partialNote, className }: MiniBarsProps) {
  const highest = Math.max(0, ...bars.map((bar) => bar.value));
  const width = bars.length * BAR_WIDTH + (bars.length - 1) * BAR_GAP;
  const height = PLOT_HEIGHT + BASELINE_HEIGHT;
  const spoken = bars
    .map((bar) => `${bar.name} ${bar.valueText}${bar.isPartial ? ` (${partialNote})` : ""}`)
    .join(", ");

  return (
    <svg
      role="img"
      aria-label={`${label}: ${spoken}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      focusable="false"
      className={cn("block shrink-0 overflow-visible", className)}
    >
      <line x1={0} x2={width} y1={PLOT_HEIGHT + 0.5} y2={PLOT_HEIGHT + 0.5} strokeWidth={BASELINE_HEIGHT} className="stroke-ink-2/45" />
      {bars.map((bar, index) => {
        const length = bar.value > 0 ? barLength(bar.value, highest, PLOT_HEIGHT) : 0;
        const barHeight = length > 0 ? length : EMPTY_STUB;
        const x = index * (BAR_WIDTH + BAR_GAP);
        const y = PLOT_HEIGHT - barHeight;
        const fill = bar.value <= 0 ? "fill-rule" : bar.isPartial ? "fill-zone-soft" : "fill-zone";
        const text = `${bar.name}: ${bar.valueText}${bar.isPartial ? ` (${partialNote})` : ""}`;
        return (
          <g key={bar.key} data-testid="mini-bar" data-height={barHeight}>
            <title>{text}</title>
            {/* Lugar completo de la barra, para que el mouse la encuentre aunque sea baja. */}
            <rect x={x - BAR_GAP / 2} y={0} width={BAR_WIDTH + BAR_GAP} height={PLOT_HEIGHT} className="fill-transparent" />
            {barHeight <= ROUNDED_END ? (
              <rect x={x} y={y} width={BAR_WIDTH} height={barHeight} className={fill} />
            ) : (
              <>
                <rect x={x} y={y} width={BAR_WIDTH} height={barHeight} rx={ROUNDED_END} className={fill} />
                <rect x={x} y={y + ROUNDED_END} width={BAR_WIDTH} height={barHeight - ROUNDED_END} className={fill} />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
