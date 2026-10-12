// Servicios y precios en USD. Copia del CLAUDE.md: los precios nunca se
// escriben en los JSON de mensajes, llegan desde acá como argumento ICU.

export type ServiceId =
  | "vodRecorded"
  | "vodLive"
  | "lesson"
  | "gamePlan"
  | "tournament";

export type PriceUnit = "perTeam";

export type Service = {
  id: ServiceId;
  priceUsd: number;
  unit?: PriceUnit;
};

const LESSON_PRICE_USD = 40;

export const SERVICES: readonly Service[] = [
  { id: "vodRecorded", priceUsd: 30 },
  { id: "vodLive", priceUsd: 45 },
  { id: "lesson", priceUsd: LESSON_PRICE_USD },
  { id: "gamePlan", priceUsd: 120 },
  { id: "tournament", priceUsd: 150, unit: "perTeam" },
];

export const LESSON_PACK = { sessions: 4, priceUsd: 140 } as const;

/** Temporada Pro: un precio fijo por equipo para toda la temporada. */
export const PRO_SEASON = { priceUsd: 2500 } as const;

/** Lo que se ahorra comprando el pack de clases en vez de clases sueltas. */
export function lessonPackSavingsUsd(): number {
  return LESSON_PACK.sessions * LESSON_PRICE_USD - LESSON_PACK.priceUsd;
}

/**
 * Destino del botón de cada servicio. Hoy todos llevan a la sección de
 * servicios; el pago y la agenda llegan en la fase de pagos y este es el
 * único lugar a cambiar.
 */
export function bookingHref(id: ServiceId | "proSeason"): string {
  void id;
  return "#services";
}
