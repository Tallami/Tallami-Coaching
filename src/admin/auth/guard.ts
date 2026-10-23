// Primera barrera del panel, en el `proxy`: un filtro rápido que corre antes de
// renderizar nada. Deja pasar solo los pedidos con una sesión válida (la misma
// verificación completa de firma, audiencia y vencimiento que hace
// `requireAdmin`), y manda al resto al login.
//
// No es la protección real: la real es `requireAdmin()` en cada página y en
// cada Server Action. El `proxy` no ve, por ejemplo, un Server Action que se
// mude a otra ruta, ni lo que un cambio futuro del `matcher` deje afuera.

import { NextResponse, type NextRequest } from "next/server";
import { getMissingConfig } from "./config";
import { LOGIN_PATH, PANEL_PATH, SETUP_PATH, safeNextPath } from "./redirect";
import { ADMIN_COOKIE, verifySessionToken } from "./session";

const SERVER_ACTION_HEADER = "next-action";
/**
 * Con este encabezado, el cliente de Next entiende que la acción terminó en una redirección y navega
 * (`<ruta>;<push|replace>`): es el mismo que escribe el servidor cuando una acción llama a `redirect()`.
 * Lo lee `serverActionReducer` (`next/dist/client/components/router-reducer/reducers/server-action-reducer`).
 */
const ACTION_REDIRECT_HEADER = "x-action-redirect";
/** Parámetro con el que el router de Next pide los datos de una página; no es parte de la dirección. */
const ROUTER_QUERY = "_rsc";

function isUnder(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

/**
 * Las formas de transporte de una página que Next entiende como la misma ruta:
 * `/admin/ventas.rsc` (datos de la página) y
 * `/admin/ventas.segments/_tree.segment.rsc` (prefetch por segmentos). Son del
 * panel igual que `/admin/ventas` y deben pasar por el mismo filtro.
 *
 * Son las reglas exactas de Next (`SegmentPrefixRSCPathnameNormalizer` y
 * `SuffixPathnameNormalizer`, con `RSC_SEGMENTS_DIR_SUFFIX`, `RSC_SEGMENT_SUFFIX`
 * y `RSC_SUFFIX`), una sola pasada y sobre la ruta cruda: primero el prefetch
 * por segmentos, que se queda con lo que está antes de `.segments/…` (el primer
 * grupo es codicioso: llega hasta el último `.segments/`); si no, el sufijo
 * `.rsc`. Cualquier otra cosa que se le parezca (`/admin/login.segments/lo-que-sea`,
 * que no termina en `.segment.rsc`) no es una forma de transporte: se queda tal
 * cual y, por lo tanto, no es `/admin/login`.
 */
const SEGMENT_PREFETCH_PATH = /^(\/.*)\.segments(\/.*)\.segment\.rsc$/;
const RSC_SUFFIX = /\.rsc$/;

function stripTransport(pathname: string): string {
  const prefetch = SEGMENT_PREFETCH_PATH.exec(pathname);
  if (prefetch) return prefetch[1];
  return pathname.replace(RSC_SUFFIX, "");
}

function decodeOrSelf(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * Sin forma de transporte ni barras finales: `/admin/login.rsc` y `/admin/login/` son `/admin/login`.
 * La forma de transporte se reconoce en la ruta cruda, como hace Next; recién después se decodifica
 * (`/%61dmin/login`). Un `%2E` que formaría `.rsc` al decodificar no cuenta como transporte.
 */
function normalizePath(pathname: string): string {
  const decoded = decodeOrSelf(stripTransport(pathname));
  return decoded.length > 1 ? decoded.replace(/\/+$/, "") : decoded;
}

/**
 * ¿La ruta es del panel? Mira también la ruta decodificada (`/%61dmin` es
 * `/admin` para el router) y sin la forma de transporte (`/admin.rsc`): no
 * puede escaparse del filtro por cómo se escribe ni por cómo se pide.
 */
export function isAdminPath(pathname: string): boolean {
  return [pathname, decodeOrSelf(pathname)].some((candidate) =>
    isUnder(stripTransport(candidate), PANEL_PATH),
  );
}

/**
 * ¿Es una de las puertas del panel, que se abren sin sesión? `/admin/setup` y todo
 * el ingreso: `/admin/login` y sus pasos (`/admin/login/llave`,
 * `/admin/login/primera-llave`…), que hacen sus propias verificaciones con la
 * cookie del ingreso a medio camino. Recibe la ruta ya normalizada. Debajo de
 * `/admin/login/` no vale un segmento `.` o `..` (que llegaría decodificado de un
 * `%2F..%2F`): con eso la dirección saldría del ingreso hacia otra página del panel.
 */
function isDoor(pathname: string): boolean {
  if (pathname === SETUP_PATH || pathname === LOGIN_PATH) return true;
  if (!pathname.startsWith(`${LOGIN_PATH}/`)) return false;
  return pathname.split("/").every((segment) => segment !== "." && segment !== "..");
}

/** Encabezados de toda respuesta del panel: ni los buscadores ni ninguna caché la guardan. */
function withPanelHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function redirectTo(request: NextRequest, pathname: string, next?: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (next) url.searchParams.set("next", next);
  // 307 conserva el método; un POST suelto que vuelve al login se reenvía como GET (303).
  const isRead = request.method === "GET" || request.method === "HEAD";
  return withPanelHeaders(NextResponse.redirect(url, isRead ? 307 : 303));
}

/** Una ruta del panel con `?next=` si hay a dónde volver, como texto relativo (el valor de `x-action-redirect`). */
function pathWithNext(pathname: string, next?: string): string {
  if (!next) return pathname;
  return `${pathname}?${new URLSearchParams({ next })}`;
}

/** Adónde volver tras el login: la dirección pedida, sin el parámetro interno del router. */
function destinationOf(request: NextRequest): string {
  const { pathname, searchParams } = request.nextUrl;
  const query = new URLSearchParams(searchParams);
  query.delete(ROUTER_QUERY);
  const search = query.size > 0 ? `?${query}` : "";
  return safeNextPath(`${stripTransport(pathname)}${search}`);
}

/**
 * La respuesta a un Server Action sin sesión (o con el panel sin configurar): 401 sin cuerpo y con
 * `x-action-redirect`, para que el navegador de quien tenía el panel abierto termine en `target`
 * (el login) en vez de en una excepción.
 *
 * Por qué se contesta acá y no se deja pasar el pedido hasta `requireAdmin()`, que también redirigiría:
 * con la sesión vencida el pedido no está autenticado, y dejarlo seguir haría que Next decodifique el
 * cuerpo de un desconocido (el protocolo Flight de React) antes de que corra código nuestro, como hoy
 * pasa solo con la acción del login, que es pública a propósito. Así el `proxy` sigue siendo una barrera
 * de verdad (ningún Server Action sin sesión llega al código de la app) y `requireAdmin()` sigue en cada
 * acción como la segunda, sin que una dependa de la otra. Un redirect HTTP común no sirve: el navegador
 * lo seguiría y el cliente de Next recibiría HTML, no la respuesta de una acción.
 *
 * El encabezado es el protocolo interno entre el servidor y el cliente de Next, no una API documentada. Si
 * un cambio de versión lo moviera, el 401 volvería a ser un error del lado del navegador y lo atraparía
 * `app/admin/error.tsx`, que ofrece ir al login; `tests/e2e/admin-session-expiry.spec.ts` lo avisa antes.
 */
function unauthorizedAction(target: string): NextResponse {
  const response = withPanelHeaders(new NextResponse(null, { status: 401 }));
  response.headers.set(ACTION_REDIRECT_HEADER, `${target};replace`);
  return response;
}

/**
 * Decide qué pasa con un pedido a `/admin…`:
 * - panel sin configurar → `/admin/setup` (o, si es un Server Action, 401 que manda a ese mismo lugar);
 * - `/admin/login` (con sus pasos, `/admin/login/…`) y `/admin/setup` → pasan (son las puertas, ver `isDoor`);
 * - con sesión válida → pasa;
 * - sin ella → redirección al login con `?next=`; si es un Server Action, 401 con
 *   `x-action-redirect` al login (ver `unauthorizedAction`).
 */
export async function guardAdmin(request: NextRequest): Promise<NextResponse> {
  const pathname = normalizePath(request.nextUrl.pathname);
  const isServerAction = request.headers.has(SERVER_ACTION_HEADER);

  if (getMissingConfig().length > 0) {
    if (isServerAction) return unauthorizedAction(SETUP_PATH);
    if (pathname === SETUP_PATH) return withPanelHeaders(NextResponse.next());
    return redirectTo(request, SETUP_PATH);
  }

  if (isDoor(pathname)) {
    return withPanelHeaders(NextResponse.next());
  }

  if (await verifySessionToken(request.cookies.get(ADMIN_COOKIE)?.value)) {
    return withPanelHeaders(NextResponse.next());
  }

  const destination = destinationOf(request);
  if (isServerAction) return unauthorizedAction(pathWithNext(LOGIN_PATH, destination));
  return redirectTo(request, LOGIN_PATH, destination);
}
