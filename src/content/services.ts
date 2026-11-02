// Servicios y precios en USD. Copia del CLAUDE.md: los precios nunca se
// escriben en los JSON de mensajes, llegan desde acá como argumento ICU.

export type ServiceId = "vodRecorded" | "tournamentReview" | "vodLive" | "gamePlan";

export type Service = {
  id: ServiceId;
  priceUsd: number;
};

export const SERVICES: readonly Service[] = [
  { id: "vodRecorded", priceUsd: 30 },
  { id: "tournamentReview", priceUsd: 60 },
  { id: "vodLive", priceUsd: 45 },
  { id: "gamePlan", priceUsd: 120 },
];

/** Temporada Pro: un precio fijo por equipo para toda la temporada. */
export const PRO_SEASON = { priceUsd: 2500 } as const;

/**
 * Destino del botón de cada servicio. Hoy todos llevan a la sección de
 * servicios; el pago y la agenda llegan en la fase de pagos y este es el
 * único lugar a cambiar.
 */
export function bookingHref(id: ServiceId | "proSeason"): string {
  void id;
  return "#services";
}
