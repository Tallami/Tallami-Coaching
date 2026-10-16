// Textos de la página Servicios.

import { rangeLengthInDays } from "@/admin/overview/labels";

const DAYS_PER_MONTH = 30;
const SHOW_DAYS_UP_TO = 60;

/**
 * Hace cuánto fue un día, para acompañar la fecha de la última venta: "hoy",
 * "ayer", "hace 8 días" y, pasados dos meses, "hace 3 meses". Un día futuro
 * (no debería haber ninguno: la última venta es hasta hoy) se escribe como "hoy".
 */
export function formatDaysAgo(day: string, today: string): string {
  const days = day >= today ? 0 : rangeLengthInDays({ from: day, to: today }) - 1;
  if (days === 0) return "hoy";
  if (days === 1) return "ayer";
  if (days <= SHOW_DAYS_UP_TO) return `hace ${days} días`;
  return `hace ${Math.floor(days / DAYS_PER_MONTH)} meses`;
}

/** "1 venta cobrada", "4 ventas cobradas". */
export function salesCountText(count: number): string {
  return `${count} ${count === 1 ? "venta cobrada" : "ventas cobradas"}`;
}

/** "1 clic en Reservar", "11 clics en Reservar". */
export function clicksCountText(count: number): string {
  return `${count} ${count === 1 ? "clic" : "clics"} en Reservar`;
}

/** "1 clic descartado por exceso", "12 clics descartados por exceso". */
export function droppedClicksText(count: number): string {
  return `${count} ${count === 1 ? "clic descartado" : "clics descartados"} por exceso`;
}
