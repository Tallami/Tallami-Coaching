import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { formatSignedPercent } from "@/admin/overview/labels";
import { Badge } from "@/components/ui/badge";

/** Más que esto no se escribe: contra un período casi vacío, +4.658 % no dice nada. */
const MAX_SHOWN_PCT = 999;

interface DeltaBadgeProps {
  /**
   * Variación porcentual contra el período anterior (50 es +50 %), o `null` si
   * el anterior no tuvo ingresos y no hay contra qué comparar.
   */
  pct: number | null;
  className?: string;
}

/**
 * La variación de un número contra el período anterior: flecha, signo y
 * porcentaje, nunca solo color (sube en verde, baja en rojo, igual en gris).
 * El número es la variación del ingreso, así que subir es bueno.
 */
export function DeltaBadge({ pct, className }: DeltaBadgeProps) {
  if (pct === null) {
    return (
      <Badge variant="neutral" className={className}>
        <MinusIcon className="size-3.5" aria-hidden="true" />
        Sin comparación
      </Badge>
    );
  }

  const direction = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const Icon = { up: ArrowUpRightIcon, down: ArrowDownRightIcon, flat: MinusIcon }[direction];
  const tone = { up: "ok", down: "danger", flat: "neutral" }[direction] as "ok" | "danger" | "neutral";
  const spoken = { up: "Subió", down: "Bajó", flat: "Sin cambios" }[direction];
  // Una baja nunca pasa de -100 %: el tope solo hace falta para las subas.
  const shown = pct > MAX_SHOWN_PCT ? `+${MAX_SHOWN_PCT} % o más` : formatSignedPercent(pct);

  return (
    <Badge variant={tone} className={className} data-direction={direction}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">{spoken}: </span>
      <span className="tabular-nums">{shown}</span>
    </Badge>
  );
}
