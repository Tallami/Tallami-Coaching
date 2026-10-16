import Link from "next/link";
import { PERIODS, PERIOD_LABELS, type Period } from "@/admin/metrics/period";
import { periodHref } from "@/admin/overview/period-param";
import { cn } from "@/lib/utils";

interface PeriodSelectorProps {
  current: Period;
  /** La página a la que lleva cada enlace (`?periodo=` se agrega solo): el Resumen por defecto. */
  basePath?: string;
  /** Nombre de la navegación para los lectores de pantalla. */
  label?: string;
}

/**
 * El selector de período: cinco enlaces (no hace falta JavaScript, la dirección
 * guarda la elección y se puede compartir). Marca el actual y envuelve en
 * varias líneas en el celular. Lo usan el Resumen y Servicios.
 */
export function PeriodSelector({
  current,
  basePath = "/admin",
  label = "Período del resumen",
}: PeriodSelectorProps) {
  return (
    <nav aria-label={label}>
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0 narrow:gap-1.5">
        {PERIODS.map((period) => {
          const isCurrent = period === current;
          return (
            <li key={period}>
              <Link
                href={periodHref(basePath, period)}
                prefetch={false}
                aria-current={isCurrent ? "true" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-[4px] border-2 border-ink px-4 font-bold transition-[color,background-color] duration-150 narrow:px-2.5 narrow:text-[0.875rem]",
                  isCurrent ? "bg-ink text-paper" : "bg-white hover:bg-gold/20",
                )}
              >
                {PERIOD_LABELS[period]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
