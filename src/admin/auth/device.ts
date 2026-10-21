// Una descripción corta y legible del navegador y el sistema de un pedido
// ("Chrome en Windows", "Safari en iPhone"), a partir del `user-agent`. Es solo
// para mostrar: en la lista de sesiones abiertas y en los avisos por email. No
// es una forma de reconocer dispositivos (el `user-agent` lo manda el cliente).

const UNKNOWN_BROWSER = "Navegador desconocido";
/** Un `user-agent` de verdad mide unos 150 caracteres: lo que pase de acá no se mira. */
const MAX_USER_AGENT_LENGTH = 512;

type Rule = readonly [name: string, pattern: RegExp];

/**
 * Los navegadores, del más específico al más general: Edge, Opera y Samsung
 * Internet se anuncian también como Chrome, y Chrome como Safari, así que el
 * primero que coincide es el que vale.
 */
const BROWSERS: readonly Rule[] = [
  ["Edge", /\b(?:Edg|EdgA|EdgiOS|Edge)\//],
  ["Opera", /\b(?:OPR|OPT)\/|\bOpera\b/],
  ["Samsung Internet", /\bSamsungBrowser\//],
  ["Firefox", /\b(?:Firefox|FxiOS)\//],
  ["Chrome", /\b(?:Chrome|CriOS)\//],
  ["Safari", /\bSafari\//],
];

/**
 * Los sistemas, del más específico al más general: un iPhone dice "like Mac OS X"
 * y un Android dice "Linux", así que Mac y Linux van al final.
 */
const SYSTEMS: readonly Rule[] = [
  ["iPhone", /\biPhone\b/],
  ["iPad", /\biPad\b/],
  ["Android", /\bAndroid\b/],
  ["Windows", /\bWindows\b/],
  ["Mac", /\bMacintosh\b|\bMac OS X\b/],
  ["Chrome OS", /\bCrOS\b/],
  ["Linux", /\bLinux\b|\bX11\b/],
];

function firstMatch(rules: readonly Rule[], text: string): string | null {
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/**
 * "Chrome en Windows", "Safari en iPhone"… Si el sistema no se reconoce, solo el
 * navegador; si el navegador no se reconoce (o no hay `user-agent`), "Navegador
 * desconocido". Nunca pasa de unos 25 caracteres, por largo que sea el encabezado.
 */
export function describeDevice(userAgent: string | null): string {
  const text = userAgent?.slice(0, MAX_USER_AGENT_LENGTH).trim();
  if (!text) return UNKNOWN_BROWSER;
  const browser = firstMatch(BROWSERS, text);
  if (browser === null) return UNKNOWN_BROWSER;
  const system = firstMatch(SYSTEMS, text);
  return system === null ? browser : `${browser} en ${system}`;
}
