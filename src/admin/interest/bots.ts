// Bots que no se cuentan como interés. Un navegador de verdad siempre manda
// `user-agent`; los rastreadores, las herramientas de auditoría y los clientes
// HTTP sueltos se anuncian en él. La lista es corta a propósito (no pretende
// atrapar a un bot que se disfraza: eso lo frena el límite por IP):
//
// - rastreadores: `bot` (Googlebot, bingbot, AhrefsBot…), `crawl`, `spider`, `slurp` (Yahoo);
// - vistas previas de redes: `facebookexternalhit`;
// - navegadores sin cabeza y auditorías: `headless`, `lighthouse`, `pagespeed`, `pingdom`;
// - clientes HTTP: `curl`, `wget`, `python-requests`, `go-http-client`, `node-fetch`, `undici`, `axios`.
//
// Se prefiere perder algún clic de más a contar un bot: `bot` también deja
// afuera a quien navega con un celular de marca "Cubot", un costo que se acepta.

const BOT_MARKERS = [
  "bot",
  "crawl",
  "spider",
  "slurp",
  "facebookexternalhit",
  "headless",
  "lighthouse",
  "pagespeed",
  "pingdom",
  "curl",
  "wget",
  "python-requests",
  "go-http-client",
  "node-fetch",
  "undici",
  "axios",
] as const;

const BOT_PATTERN = new RegExp(BOT_MARKERS.join("|"), "i");

/** ¿Este `user-agent` es de un bot? Sin `user-agent` (o vacío) también: ningún navegador lo omite. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const value = userAgent?.trim();
  return !value || BOT_PATTERN.test(value);
}
