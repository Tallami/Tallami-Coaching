import type { ReactNode } from "react";
import { barLength } from "@/admin/charts/scale";
import { cn } from "@/lib/utils";

/** Una barra horizontal: un servicio, un medio de pago o un país. */
export interface HBarRow {
  key: string;
  label: string;
  /** Largo de la barra, en la unidad menor (centavos). */
  value: number;
  /** El valor ya escrito: "USD 2.499,86". */
  valueText: string;
  /** Línea chica bajo el nombre: "20 ventas · 20,7 %". */
  detail?: ReactNode;
  /** Texto de ayuda al pasar el mouse. */
  title?: string;
}

interface HBarChartProps {
  rows: readonly HBarRow[];
  /** Qué lista es, para los lectores de pantalla. */
  ariaLabel: string;
  className?: string;
}

const BAR_HEIGHT = 10;
const BAR_RADIUS = 4;
/** El largo se calcula sobre 1000 unidades de ancho y se escribe en porcentaje. */
const FULL_LENGTH = 1000;
const UNITS_PER_PERCENT = FULL_LENGTH / 100;

/** Una barra con la punta redondeada y el arranque recto: un rectángulo redondeado y, encima, su mitad izquierda recta. */
function Bar({ widthPct, className }: { widthPct: number; className: string }) {
  return (
    <>
      <rect width={`${widthPct}%`} height={BAR_HEIGHT} rx={BAR_RADIUS} className={className} />
      <rect width={`${widthPct / 2}%`} height={BAR_HEIGHT} className={className} />
    </>
  );
}

/**
 * Barras horizontales de una sola serie: nombre y valor arriba, la barra
 * debajo, desde un mismo borde izquierdo y con el largo proporcional al mayor
 * valor. El texto va en HTML (se ajusta solo en el celular) y la barra es un
 * SVG chico; la lista misma es la alternativa para lectores de pantalla.
 */
export function HBarChart({ rows, ariaLabel, className }: HBarChartProps) {
  const max = Math.max(0, ...rows.map((row) => row.value));

  return (
    <ul aria-label={ariaLabel} className={cn("m-0 flex list-none flex-col gap-3.5 p-0", className)}>
      {rows.map((row) => (
        <li key={row.key} title={row.title} data-testid="hbar-row">
          <div className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 font-semibold">{row.label}</span>
            <span className="shrink-0 font-bold tabular-nums">{row.valueText}</span>
          </div>
          <svg width="100%" height={BAR_HEIGHT} aria-hidden="true" focusable="false" className="mt-1 block">
            <Bar widthPct={100} className="fill-neutral-tint" />
            <Bar widthPct={barLength(row.value, max, FULL_LENGTH) / UNITS_PER_PERCENT} className="fill-zone" />
          </svg>
          {row.detail ? <p className="mt-1 text-[0.875rem] text-ink-2">{row.detail}</p> : null}
        </li>
      ))}
    </ul>
  );
}
