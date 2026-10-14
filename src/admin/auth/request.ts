// Datos del pedido que usa el ingreso: de qué IP viene y si la cookie de
// sesión debe llevar `Secure`.

import { isIP } from "node:net";

/** IP que se usa cuando el pedido no trae una válida: todos esos pedidos comparten un solo cupo de intentos. */
const UNKNOWN_IP = "unknown";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * IP del cliente: el primer valor de `x-forwarded-for`.
 *
 * Confianza: en Vercel ese encabezado lo escribe Vercel con la IP real del
 * cliente y descarta lo que mande el visitante, así que el primer valor no se
 * puede falsificar. Fuera de Vercel (local, o un servidor propio sin proxy) lo
 * manda el propio cliente y sí se puede falsificar: el límite de intentos solo
 * es una defensa real detrás de Vercel o de un proxy que lo sobrescriba. Los
 * e2e lo usan a propósito, con una IP distinta por test.
 *
 * Si el valor no es una IP, se devuelve `"unknown"` (cupo compartido).
 */
export function getClientIp(headers: Headers): string {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first && isIP(first) ? first.toLowerCase() : UNKNOWN_IP;
}

function hostnameOf(host: string | null): string | undefined {
  // Sin el puerto: "localhost:3000" y "[::1]:3000" (la IPv6 va entre corchetes).
  return host?.replace(/:\d+$/, "").toLowerCase();
}

/**
 * ¿La cookie de sesión lleva `Secure`? Sí, salvo en una sola situación: http
 * plano en `localhost` (desarrollo y e2e con `next start`, que no tienen
 * https). Se decide por el pedido y no solo por `NODE_ENV`, porque los e2e
 * corren un build de producción sobre http.
 *
 * - En Vercel (`VERCEL` definida) siempre `Secure`, diga lo que diga el pedido.
 * - Con `x-forwarded-proto: https` (proxy propio) también.
 * - Un host que no es de esta máquina (dominio, IP de la red) también: si el
 *   navegador llegó por http a otro equipo, la cookie no se guarda y hay que
 *   usar https (o `localhost`), mejor que mandar la sesión sin cifrar.
 */
export function shouldUseSecureCookie(headers: Headers): boolean {
  if (process.env.VERCEL) return true;
  const protocol = headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (protocol === "https") return true;
  const hostname = hostnameOf(headers.get("host"));
  return !hostname || !LOOPBACK_HOSTS.has(hostname);
}
