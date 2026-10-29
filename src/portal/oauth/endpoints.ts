// Las tres rutas del ingreso del alumno. Los archivos de `src/app/api/portal/auth/`
// solo llaman a estas funciones; viven acá para probarlas con una base en memoria, un
// `fetch` falso y un reloj propio. `/api` queda fuera del `proxy` (ni next-intl ni la
// guardia del panel): cada ruta hace todas sus verificaciones.
//
//   GET  /api/portal/auth/[provider]?locale=es&invitacion=…
//        404 si el proveedor no existe o no está habilitado, o si el portal no está
//        configurado. Discord y Google solo empiezan en la dirección pública del sitio
//        (`canonicalSignInUrl`): en otra, 302 a la misma ruta allá, sin cookie. Si no, la
//        cookie del ingreso y 302 a la autorización del proveedor. La invitación del link
//        solo viaja en la cookie si el ingreso empezó en el propio sitio (`Sec-Fetch-Site:
//        same-origin`, o sin ese encabezado un `Referer` del mismo origen): un link de otro
//        sitio no puede hacer que la cuenta de otro alumno consuma una invitación.
//   GET  /api/portal/auth/[provider]/callback?code=…&state=… (o ?error=…)
//        Borra la cookie del ingreso SIEMPRE. Si la cookie vale para ese proveedor, el
//        `state` coincide y el proveedor da la identidad: cuenta, canje de la invitación
//        (si trajo una), sesión nueva (cierra la anterior de ese navegador), cookie
//        `tallami_alumno` y 303 a `/{idioma}/portal`, con `?invitacion=vinculada|invalida|ocupada`
//        si hubo invitación. Cualquier falla: 303 a `/{idioma}/portal?ingreso=fallido`, sin
//        sesión (nunca un 500).
//   POST /api/portal/auth/logout?locale=es
//        Cierra la sesión en la base, borra la cookie y 303 a `/{idioma}/portal`. Solo
//        POST: a un GET Next le contesta 405.
//
// Todas las redirecciones de vuelta son rutas relativas del propio sitio armadas con
// uno de los tres idiomas: no hay redirección abierta. Todas las respuestas llevan
// `Cache-Control: no-store`.

import { NextResponse, type NextRequest } from "next/server";
import { shouldUseSecureCookie } from "@/admin/auth/request";
import type { Db } from "@/db/client";
import { routing, type Locale } from "@/i18n/routing";
import { upsertAccountFromIdentity } from "../accounts";
import { isPortalConfigured, type PortalProvider } from "../config";
import { inviteOutcome, redeemInvite, type InviteOutcome } from "../invites";
import { PORTAL_PROVIDERS } from "../policy";
import {
  PORTAL_COOKIE,
  createPortalSession,
  portalCookieOptions,
  purgePortalRecords,
  revokePortalSession,
} from "../sessions";
import {
  FLOW_COOKIE,
  exchangeAndFetchIdentity,
  flowCookieOptions,
  inviteTokenFrom,
  matchesState,
  portalLocale,
  readFlowCookie,
  startFlow,
  type FlowData,
} from "./flow";
import { canonicalSignInUrl, getProviderClient, redirectUriFor } from "./providers";

export interface PortalAuthDeps {
  getDb: () => Promise<Db>;
  /** El `fetch` con el que se habla con el proveedor (los tests pasan uno falso). */
  fetch?: typeof fetch;
  now?: () => Date;
}

/** Lo que se agrega a la dirección del portal cuando el ingreso no se pudo completar: la página muestra el aviso. */
export const SIGN_IN_FAILED_QUERY = { ingreso: "fallido" } as const;

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** Un código de autorización de verdad mide decenas de caracteres; uno enorme ni se manda. */
const MAX_CODE_LENGTH = 2048;

/** La página del portal en `locale`, con `query` si hay algo que avisar. Siempre una ruta del propio sitio. */
export function portalPath(locale: Locale, query: Record<string, string> = {}): string {
  const search = new URLSearchParams(query).toString();
  return `/${locale}/portal${search ? `?${search}` : ""}`;
}

function asProvider(value: string): PortalProvider | null {
  return PORTAL_PROVIDERS.find((provider) => provider === value) ?? null;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Una redirección sin caché. Sin `Referer` hacia el destino: la dirección de vuelta
 * lleva el código del proveedor y la de inicio, la invitación.
 */
function redirectTo(location: string, status: 302 | 303): NextResponse {
  return new NextResponse(null, {
    status,
    headers: { ...NO_STORE, Location: location, "Referrer-Policy": "no-referrer" },
  });
}

function emptyResponse(status: 403 | 404): NextResponse {
  return new NextResponse(null, { status, headers: NO_STORE });
}

/**
 * ¿El ingreso empezó en el propio sitio (con un clic en la página del portal)? Se mira
 * `Sec-Fetch-Site`, que el navegador pone y la página no puede cambiar: vale solo
 * `same-origin`. Sin ese encabezado (un navegador viejo), un `Referer` del mismo
 * origen. Un link de otro sitio, una dirección escrita a mano (`none`) o un pedido sin
 * ninguna de las dos pistas no cuentan.
 */
function startedOnThisSite(request: NextRequest): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const referer = request.headers.get("referer");
  return referer !== null && URL.canParse(referer) && new URL(referer).origin === request.nextUrl.origin;
}

/**
 * `GET /api/portal/auth/[provider]`: empieza el ingreso. `locale` que no es del sitio
 * pasa a `es`; una invitación con otra forma, o que no viene de la página del portal, se
 * descarta (el ingreso sigue, sin invitación).
 */
export function handleSignInStart(
  request: NextRequest,
  providerParam: string,
  { now }: { now?: () => Date } = {},
): NextResponse {
  const provider = asProvider(providerParam);
  if (!provider || !getProviderClient(provider) || !isPortalConfigured()) return emptyResponse(404);

  // La cookie del ingreso tiene que quedar donde vuelve el proveedor: en la dirección pública.
  const canonical = canonicalSignInUrl(provider, request.nextUrl);
  if (canonical) return redirectTo(canonical, 302);

  const { origin, searchParams } = request.nextUrl;
  const { authorizationUrl, cookieValue } = startFlow({
    provider,
    locale: portalLocale(searchParams.get("locale")),
    inviteToken: startedOnThisSite(request) ? inviteTokenFrom(searchParams.get("invitacion")) : null,
    redirectUri: redirectUriFor(provider, origin),
    now: now?.(),
  });
  const response = redirectTo(authorizationUrl, 302);
  response.cookies.set(FLOW_COOKIE, cookieValue, flowCookieOptions(shouldUseSecureCookie(request.headers)));
  return response;
}

/**
 * Borra las sesiones, las invitaciones y las cuentas sin vincular viejas. Es una limpieza
 * de pasada: si falla, el alumno igual entra. Se anota solo el nombre del error (el mensaje
 * podría traer la conexión a la base).
 */
async function purgeQuietly(db: Db, now: Date): Promise<void> {
  try {
    await purgePortalRecords(db, now);
  } catch (error) {
    console.error(`Portal: no se pudieron borrar los registros viejos. ${errorName(error)}`);
  }
}

/** Un ingreso que salió bien: el token de la sesión nueva y, si el alumno llegó con una invitación, qué pasó con ella. */
interface SignedIn {
  token: string;
  invite: InviteOutcome | null;
}

/**
 * Lo que pasa cuando la cookie del ingreso ya se verificó: la vuelta trae el `state`
 * del ingreso y un código, el proveedor da la identidad y la base abre la sesión. Si el
 * ingreso trajo una invitación se canjea para esa cuenta antes de abrir la sesión, y al
 * abrirla se cierra la que el navegador tenía. Devuelve el ingreso, o `null` ante
 * cualquier falla.
 */
async function completeSignIn(
  request: NextRequest,
  provider: PortalProvider,
  flow: FlowData,
  deps: PortalAuthDeps,
  now: Date,
): Promise<SignedIn | null> {
  const { origin, searchParams } = request.nextUrl;
  // El alumno canceló (`access_denied`) o el proveedor falló: no hay código que cambiar.
  if (searchParams.has("error")) return null;
  const code = searchParams.get("code");
  if (!matchesState(flow, searchParams.get("state")) || !code || code.length > MAX_CODE_LENGTH) return null;

  const identity = await exchangeAndFetchIdentity(provider, code, flow.codeVerifier, {
    redirectUri: redirectUriFor(provider, origin),
    fetch: deps.fetch,
  });
  if (!identity) return null;

  try {
    const db = await deps.getDb();
    const account = await upsertAccountFromIdentity(db, identity, now);
    // Una invitación que no sirve (o está ocupada) no impide entrar: el portal avisa qué pasó.
    const invite = flow.inviteToken
      ? inviteOutcome(await redeemInvite(db, flow.inviteToken, account.id, now))
      : null;
    const token = await createPortalSession(db, account.id, now);
    // La sesión que el navegador tenía (otra persona en la misma computadora, o la misma de nuevo) ya no vale.
    await revokePortalSession(db, request.cookies.get(PORTAL_COOKIE)?.value, now);
    await purgeQuietly(db, now);
    return { token, invite };
  } catch (error) {
    console.error(`Portal: no se pudo abrir la sesión del alumno. ${errorName(error)}`);
    return null;
  }
}

/** A dónde vuelve el alumno: el portal, con el resultado de la invitación o con el aviso de que el ingreso falló. */
function portalPathAfterSignIn(locale: Locale, signedIn: SignedIn | null): string {
  if (!signedIn) return portalPath(locale, SIGN_IN_FAILED_QUERY);
  return portalPath(locale, signedIn.invite ? { invitacion: signedIn.invite } : {});
}

/** `GET /api/portal/auth/[provider]/callback`: la vuelta del proveedor. Nunca tira. */
export async function handleCallback(
  request: NextRequest,
  providerParam: string,
  deps: PortalAuthDeps,
): Promise<NextResponse> {
  const now = deps.now?.() ?? new Date();
  const secure = shouldUseSecureCookie(request.headers);
  const provider = asProvider(providerParam);
  const flow = provider ? readFlowCookie(request.cookies.get(FLOW_COOKIE)?.value, provider, now) : null;
  // Sin una cookie que valga no se sabe el idioma: el de siempre.
  const locale = flow?.locale ?? routing.defaultLocale;
  const signedIn = provider && flow ? await completeSignIn(request, provider, flow, deps, now) : null;

  const response = redirectTo(portalPathAfterSignIn(locale, signedIn), 303);
  if (signedIn) response.cookies.set(PORTAL_COOKIE, signedIn.token, portalCookieOptions(secure));
  // De un solo uso: se borra salga bien o mal.
  response.cookies.set(FLOW_COOKIE, "", { ...flowCookieOptions(secure), maxAge: 0 });
  return response;
}

/**
 * `POST /api/portal/auth/logout`: cierra la sesión. Un POST que manda otro sitio
 * (`Sec-Fetch-Site: cross-site`) no cierra nada. Si la base no responde, la cookie se
 * borra igual.
 */
export async function handleLogout(request: NextRequest, deps: PortalAuthDeps): Promise<NextResponse> {
  if (request.headers.get("sec-fetch-site") === "cross-site") return emptyResponse(403);

  const token = request.cookies.get(PORTAL_COOKIE)?.value;
  if (token) {
    try {
      await revokePortalSession(await deps.getDb(), token, deps.now?.() ?? new Date());
    } catch (error) {
      console.error(`Portal: no se pudo cerrar la sesión del alumno en la base. ${errorName(error)}`);
    }
  }

  const response = redirectTo(portalPath(portalLocale(request.nextUrl.searchParams.get("locale"))), 303);
  response.cookies.set(PORTAL_COOKIE, "", {
    ...portalCookieOptions(shouldUseSecureCookie(request.headers)),
    maxAge: 0,
  });
  return response;
}
