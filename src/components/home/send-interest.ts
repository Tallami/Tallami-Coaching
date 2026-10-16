// Cómo el sitio avisa un clic en "Reservar": `navigator.sendBeacon`, que el
// navegador entrega aunque la página se cierre o cambie en ese momento, y
// `fetch` con `keepalive` si no hay beacon. Es un aviso anónimo y sin respuesta
// que importe: cualquier fallo se ignora, porque el enlace tiene que funcionar
// siempre. Sin cookies: el pedido es del mismo origen y el sitio no las usa.

import type { InterestItem, InterestLocale } from "@/admin/catalog";

export const INTEREST_ENDPOINT = "/api/interest";

/** Lo que usa el aviso del navegador; se pasa de afuera para probarlo sin navegador. */
export interface InterestTransport {
  sendBeacon?: (url: string, data: Blob) => boolean;
  fetch?: (url: string, init: RequestInit) => Promise<unknown>;
}

function browserTransport(): InterestTransport {
  return {
    sendBeacon:
      typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
        ? (url, data) => navigator.sendBeacon(url, data)
        : undefined,
    fetch: typeof fetch === "function" ? (url, init) => fetch(url, init) : undefined,
  };
}

/** Avisa que se tocó el botón de `item`, desde la página en `locale`. Nunca tira. */
export function sendInterest(
  item: InterestItem,
  locale: InterestLocale,
  transport: InterestTransport = browserTransport(),
): void {
  const body = JSON.stringify({ item, locale });
  try {
    const queued = transport.sendBeacon?.(INTEREST_ENDPOINT, new Blob([body], { type: "application/json" }));
    if (queued) return;
  } catch {
    // Sin beacon, se intenta con fetch.
  }
  try {
    void Promise.resolve(
      transport.fetch?.(INTEREST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }),
    ).catch(() => undefined);
  } catch {
    // El aviso es opcional: el enlace sigue su camino.
  }
}
