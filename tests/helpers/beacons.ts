// Ayuda de los e2e del sitio público: ver qué avisos de interés manda una
// página. Playwright no entrega el cuerpo de un pedido de `sendBeacon` (es un
// Blob), así que el cuerpo se anota desde la propia página, antes de que cargue
// su código, y los pedidos al endpoint se cuentan desde la red.

import type { Page } from "@playwright/test";

export const INTEREST_PATH = "/api/interest";

export interface BeaconWatch {
  /** Pedidos a `/api/interest` que salieron de la página (desde que se empezó a mirar). */
  requests: () => string[];
  /** Cuerpos que la página mandó con `navigator.sendBeacon`, en orden. */
  bodies: () => Promise<string[]>;
}

declare global {
  interface Window {
    __beaconBodies?: string[];
  }
}

/** Empieza a mirar los avisos de `page`. Hay que llamarla antes de navegar. */
export async function watchBeacons(page: Page): Promise<BeaconWatch> {
  await page.addInitScript(() => {
    const sent: string[] = [];
    window.__beaconBodies = sent;
    const original = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      if (data instanceof Blob) void data.text().then((text) => sent.push(text));
      return original(url, data);
    };
  });
  const urls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === INTEREST_PATH) urls.push(request.method());
  });
  return {
    requests: () => [...urls],
    bodies: () => page.evaluate(() => [...(window.__beaconBodies ?? [])]),
  };
}
