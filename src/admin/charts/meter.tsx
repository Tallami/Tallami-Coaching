import { cn } from "@/lib/utils";

export type MeterTone = "accent" | "warn" | "danger";

interface MeterProps {
  /** Cuánto del total se usó, en porcentaje; puede pasar de 100 (se llena la barra y listo). */
  usedPct: number;
  /** Qué mide, para los lectores de pantalla: "Tope de facturación usado". */
  label: string;
  /** Lo que dice el lector: "66,2 % del tope". */
  valueText: string;
  tone: MeterTone;
  className?: string;
}

/** Barra de progreso: el relleno lleva el estado y la pista es un paso más claro del mismo color. */
const TONE_CLASSES: Record<MeterTone, { fill: string; track: string }> = {
  accent: { fill: "fill-zone", track: "fill-zone/15" },
  warn: { fill: "fill-warn", track: "fill-warn/15" },
  danger: { fill: "fill-danger", track: "fill-danger/15" },
};

const METER_HEIGHT = 14;
const CORNER_RADIUS = 4;
const FULL_PCT = 100;
/** Desde acá el medidor avisa que se está llegando al tope. */
const WARN_FROM_PCT = 80;

/** El tono según cuánto se usó: acento hasta el 80 %, aviso hasta el 100 %, alerta al pasarlo. */
export function meterTone(usedPct: number): MeterTone {
  if (usedPct >= FULL_PCT) return "danger";
  if (usedPct >= WARN_FROM_PCT) return "warn";
  return "accent";
}

/**
 * Medidor de un número contra un tope. SVG del servidor: el ancho del relleno
 * es un porcentaje, así que ocupa lo que ocupe el contenedor. El estado nunca
 * va solo en el color: quien lo usa escribe también lo que queda o lo que se pasó.
 */
export function Meter({ usedPct, label, valueText, tone, className }: MeterProps) {
  const filled = Math.min(FULL_PCT, Math.max(0, usedPct));
  const classes = TONE_CLASSES[tone];

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={FULL_PCT}
      aria-valuenow={filled}
      aria-valuetext={valueText}
      className={cn("w-full", className)}
    >
      <svg width="100%" height={METER_HEIGHT} aria-hidden="true" focusable="false" className="block">
        <rect width="100%" height={METER_HEIGHT} rx={CORNER_RADIUS} className={classes.track} />
        {filled > 0 ? (
          <rect
            width={`${filled}%`}
            height={METER_HEIGHT}
            rx={CORNER_RADIUS}
            className={classes.fill}
            data-testid="meter-fill"
          />
        ) : null}
      </svg>
    </div>
  );
}
