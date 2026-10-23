// A dónde se vuelve después de iniciar sesión (`?next=…`). Es entrada del
// visitante: solo se aceptan rutas del propio panel, para que el login no sea
// una redirección abierta (`?next=//sitio-malo.com`).

import { ADMIN_ROUTES } from "../routes";

export const PANEL_PATH = ADMIN_ROUTES.overview;
export const LOGIN_PATH = "/admin/login";
export const SETUP_PATH = "/admin/setup";
/** El segundo paso del ingreso: confirmar con una llave ya registrada. */
export const PASSKEY_STEP_PATH = `${LOGIN_PATH}/llave`;
/** El segundo paso cuando todavía no hay ninguna llave: registrar la primera. */
export const FIRST_KEY_STEP_PATH = `${LOGIN_PATH}/primera-llave`;

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
  return withNext(LOGIN_PATH, next, error ? { error } : {});
}

/**
 * La página de un paso del ingreso (`PASSKEY_STEP_PATH` o `FIRST_KEY_STEP_PATH`),
 * con `?next=` si el destino no es el panel mismo. Ese `next` solo sirve para
 * volver a empezar si el ingreso vence: a dónde se va al terminar lo dice el
 * ingreso a medio camino guardado en la base, nunca la dirección.
 */
export function loginStepPath(step: string, next?: string): string {
  return withNext(step, next);
}

function withNext(pathname: string, next: string | undefined, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  const target = safeNextPath(next);
  if (target !== PANEL_PATH) params.set("next", target);
  for (const [name, value] of Object.entries(extra)) params.set(name, value);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
