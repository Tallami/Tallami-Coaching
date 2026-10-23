// Las cookies del navegador como las ve el servidor en los tests unitarios de las
// acciones del panel: lo que una acción guarda o borra queda a la vista del test y
// del pedido siguiente. Se entrega como el valor de `cookies()` de `next/headers`.

import { vi } from "vitest";

export function createCookieJar() {
  const values = new Map<string, string>();
  return {
    values,
    get: vi.fn((name: string) => (values.has(name) ? { name, value: values.get(name) } : undefined)),
    // El tercer argumento (las opciones de la cookie) queda en `mock.calls`.
    set: vi.fn((...[name, value]: [name: string, value: string, options?: unknown]) => {
      values.set(name, value);
    }),
    delete: vi.fn((options: string | { name: string; path?: string }) => {
      values.delete(typeof options === "string" ? options : options.name);
    }),
  };
}

export type CookieJar = ReturnType<typeof createCookieJar>;
