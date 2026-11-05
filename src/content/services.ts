// Servicios y precios en USD. Copia del CLAUDE.md: los precios nunca se
// escriben en los JSON de mensajes, llegan desde acá como argumento ICU.

import type { Locale } from "@/i18n/routing";

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

const CENTS_PER_DOLLAR = 100;

export function serviceById(id: ServiceId): Service {
  const service = SERVICES.find((candidate) => candidate.id === id);
  if (!service) throw new Error(`Servicio desconocido: ${id}.`);
  return service;
}

/** El precio de un servicio en centavos de dólar: lo que usan las cuentas de `src/lib/money.ts` y de los pagos. */
export function priceUsdMinor(id: ServiceId): number {
  return serviceById(id).priceUsd * CENTS_PER_DOLLAR;
}

/** La dirección de la pantalla de confirmación de cada servicio: la misma en los tres idiomas. */
export const SERVICE_SLUGS: Record<ServiceId, string> = {
  vodRecorded: "vod-3-partidas",
  tournamentReview: "vod-torneo",
  vodLive: "vod-en-vivo",
  gamePlan: "plan-de-juego",
};

/** La de Temporada Pro: se llega solo con el link de pago que manda Tallami. */
export const PRO_SEASON_SLUG = "temporada-pro";

/** Todas las pantallas de compra. Lo demás bajo `/comprar` es un 404 (`next.config.ts`). */
export const CHECKOUT_SLUGS: readonly string[] = [...Object.values(SERVICE_SLUGS), PRO_SEASON_SLUG];

/** El servicio de esa dirección, o `null`. Temporada Pro no es uno de ellos: se entra por aplicación. */
export function serviceFromSlug(slug: string): ServiceId | null {
  return SERVICES.find(({ id }) => SERVICE_SLUGS[id] === slug)?.id ?? null;
}

/** ¿Es una de las pantallas de compra? Solo a estas puede volver un ingreso. */
export function isCheckoutSlug(slug: string): boolean {
  return CHECKOUT_SLUGS.includes(slug);
}

/** Lo que se le agrega a la dirección de una pantalla de compra. */
export interface CheckoutQuery {
  /** El token del link de pago, si llegó con uno. */
  link?: string | null;
  /** Por qué no se pudo pagar (`CheckoutResult`). */
  error?: string;
}

/** La pantalla de compra de `slug`. Siempre una ruta del propio sitio. */
export function checkoutHref(slug: string, locale: Locale, { link, error }: CheckoutQuery = {}): string {
  const query = new URLSearchParams();
  if (link) query.set("link", link);
  if (error) query.set("error", error);
  const search = query.toString();
  return `/${locale}/comprar/${slug}${search ? `?${search}` : ""}`;
}

/** Destino del botón de cada servicio: su pantalla de compra. Temporada Pro va a su aplicación. */
export function bookingHref(id: ServiceId | "proSeason", locale: Locale): string {
  return id === "proSeason" ? `/${locale}/temporada-pro` : checkoutHref(SERVICE_SLUGS[id], locale);
}
