// Ayuda de los e2e del sitio público: ver qué avisos de interés manda una
// página. Playwright no entrega el cuerpo de un pedido de `sendBeacon` (es un
// Blob), así que el cuerpo se anota desde la propia página, antes de que cargue
// su código, y los pedidos al endpoint se cuentan desde la red.
//
// El botón de un servicio lleva a otra página, y el aviso sale justo antes de irse: leer el Blob es
// asíncrono y la página ya no estaría, y lo que quedara en `window` se pierde al navegar. Por eso el
// texto se guarda al crear el Blob y se le entrega a Playwright en el mismo momento del `sendBeacon`.

import type { Locator, Page, Response, Route } from "@playwright/test";

export const INTEREST_PATH = "/api/interest";

/**
 * Toca un botón que avisa y navega, y devuelve la respuesta del aviso. El aviso sobrevive a la navegación,
 * pero Playwright ya no ve su respuesta si la página que lo mandó se fue: por eso la navegación espera
 * a que el aviso haya contestado. Sigue su camino sola; quien llama mira a dónde llegó.
 */
export async function clickAndWaitForBeacon(page: Page, link: Locator): Promise<Response> {
  const answered = page.waitForResponse((response) => new URL(response.url()).pathname === INTEREST_PATH);
  const holdNavigation = async (route: Route) => {
    if (route.request().isNavigationRequest()) await answered;
    await route.fallback();
  };
  await page.route("**/*", holdNavigation);
  await link.click();
  const response = await answered;
  await page.unroute("**/*", holdNavigation);
  return response;
}

export interface BeaconWatch {
  /** Pedidos a `/api/interest` que salieron de la página (desde que se empezó a mirar). */
  requests: () => string[];
  /** Cuerpos que la página mandó con `navigator.sendBeacon`, en orden, aunque después haya navegado. */
  bodies: () => Promise<string[]>;
}

declare global {
  interface Window {
    __noteBeacon?: (body: string) => Promise<void>;
  }
}

/** Empieza a mirar los avisos de `page`. Hay que llamarla antes de navegar. */
export async function watchBeacons(page: Page): Promise<BeaconWatch> {
  const bodies: string[] = [];
  await page.exposeFunction("__noteBeacon", (body: string) => {
    bodies.push(body);
  });
  await page.addInitScript(() => {
    const NativeBlob = window.Blob;
    const texts = new WeakMap<Blob, string>();
    window.Blob = class extends NativeBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        super(parts, options);
        texts.set(this, (parts ?? []).map(String).join(""));
      }
    };
    const original = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      if (data instanceof NativeBlob) void window.__noteBeacon?.(texts.get(data) ?? "");
      return original(url, data);
    };
  });
  const urls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === INTEREST_PATH) urls.push(request.method());
  });
  return {
    requests: () => [...urls],
    bodies: async () => [...bodies],
  };
}
