// A dónde se vuelve después de iniciar sesión (`?next=…`). Es entrada del
// visitante: solo se aceptan rutas del propio panel, para que el login no sea
// una redirección abierta (`?next=//sitio-malo.com`).

export const PANEL_PATH = "/admin";
export const LOGIN_PATH = "/admin/login";
export const SETUP_PATH = "/admin/setup";

const MAX_NEXT_LENGTH = 2048;
/** Origen inventado: sirve para que `URL` resuelva la ruta y para detectar si saltó a otro sitio. */
const PLACEHOLDER_ORIGIN = "http://panel.invalid";

function isUnder(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

/**
 * La ruta a la que volver, o `/admin` si `raw` no sirve. Solo vale una ruta
 * `/admin…` del mismo sitio; se descartan los destinos que dan vueltas
 * (`/admin/login`, `/admin/setup`) y todo lo que `URL` resuelve fuera de
 * `/admin` (`//otro.com`, `/\otro.com`, `/admin/../es`, `/admin/%2e%2e/es`).
 */
export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_NEXT_LENGTH) {
    return PANEL_PATH;
  }
  // Una ruta, no una URL: empieza con una sola barra y no lleva barras
  // invertidas (algunos navegadores las leen como barras).
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return PANEL_PATH;
  }

  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return PANEL_PATH;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return PANEL_PATH;
  if (!isUnder(url.pathname, PANEL_PATH)) return PANEL_PATH;
  if (isUnder(url.pathname, LOGIN_PATH) || isUnder(url.pathname, SETUP_PATH)) return PANEL_PATH;

  return `${url.pathname}${url.search}`;
}

/**
 * `/admin/login`, con `?next=` si el destino no es el panel mismo y con
 * `?error=` si hay un aviso para mostrar.
 */
export function loginPath({ next, error }: { next?: string; error?: string } = {}): string {
  const params = new URLSearchParams();
  const target = safeNextPath(next);
  if (target !== PANEL_PATH) params.set("next", target);
  if (error) params.set("error", error);
  const query = params.toString();
  return query ? `${LOGIN_PATH}?${query}` : LOGIN_PATH;
}
