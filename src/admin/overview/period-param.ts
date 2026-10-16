// El período del resumen en la dirección: `/admin?periodo=30-dias`. Lo que
// llega de la dirección es texto del usuario: se busca en una tabla cerrada y,
// si no está (o falta), se usa el período por defecto. Nunca es un error.

import { PERIODS, type Period } from "@/admin/metrics/period";
import { firstValue } from "@/admin/ui/search-params";

export const DEFAULT_PERIOD: Period = "thisMonth";

/** Cómo se escribe cada período en la dirección. */
export const PERIOD_SLUGS: Record<Period, string> = {
  thisMonth: "este-mes",
  lastMonth: "mes-pasado",
  last30: "30-dias",
  last12: "12-meses",
  thisYear: "este-ano",
};

// Un `Map` y no un objeto: `"__proto__"` o `"constructor"` no pueden colarse
// como si fueran un período.
const PERIOD_BY_SLUG: ReadonlyMap<string, Period> = new Map(
  PERIODS.map((period) => [PERIOD_SLUGS[period], period]),
);

/** El período que dice `?periodo=`; el de por defecto si falta o no se reconoce. */
export function parsePeriodParam(value: string | string[] | undefined): Period {
  const slug = firstValue(value);
  return (slug !== undefined ? PERIOD_BY_SLUG.get(slug) : undefined) ?? DEFAULT_PERIOD;
}

/** A dónde lleva el selector de la página `basePath` para ese período (el de por defecto queda sin parámetro). */
export function periodHref(basePath: string, period: Period): string {
  return period === DEFAULT_PERIOD ? basePath : `${basePath}?periodo=${PERIOD_SLUGS[period]}`;
}

/** A dónde lleva el selector del Resumen para ese período. */
export function overviewHref(period: Period): string {
  return periodHref("/admin", period);
}
