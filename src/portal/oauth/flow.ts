// El ingreso de un alumno con OAuth 2.0: flujo "authorization code" con PKCE (S256) y
// `state`. Al empezar se generan al azar el `state` y el verificador de PKCE, y viajan
// en una cookie corta (`tallami_alumno_oauth`, 10 minutos, solo para las rutas del
// ingreso) firmada con HMAC-SHA256: así nadie puede armar ni cambiar un ingreso a
// medio camino (otro `state`, otro idioma, otra invitación, más tiempo). La firma usa
// una clave derivada de `PORTAL_SESSION_SECRET` con un contexto propio, como `hashIp`
// del panel: el mismo secreto no firma dos cosas distintas.
//
// La cookie es de un solo uso: la vuelta la borra pase lo que pase, y el código que
// manda el proveedor también vale una sola vez (lo exige OAuth). Al volver, el `state`
// se compara en tiempo constante. Con el código y el verificador se pide el token, con
// el token el perfil, y el token se descarta: del perfil queda solo la identidad.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { routing, type Locale } from "@/i18n/routing";
import type { ProviderIdentity } from "../accounts";
import { getPortalSecret, type PortalProvider } from "../config";
import { PORTAL_OAUTH_FLOW_MS, PORTAL_PROVIDERS } from "../policy";
import { getProviderClient, profileToIdentity, type ProviderClient } from "./providers";

/** La cookie del ingreso a medio camino. La de la sesión (`tallami_alumno`) es otra. */
export const FLOW_COOKIE = "tallami_alumno_oauth";
/** La cookie solo viaja a las rutas del ingreso (empezar, volver, salir). */
export const FLOW_COOKIE_PATH = "/api/portal/auth";

/** El `state`, el verificador de PKCE y una invitación son 32 bytes en base64url: 43 caracteres. */
const RANDOM_BYTES = 32;
const URL_SAFE_32_BYTES = /^[A-Za-z0-9_-]{43}$/;
const FLOW_SIGNING_CONTEXT = "tallami-portal:oauth-flow:v1";
/** Una cookie buena mide unos 300 caracteres; más que esto ni se mira. */
const MAX_COOKIE_LENGTH = 1024;
/** Lo máximo que se espera a Discord o Google en cada pedido. */
const OAUTH_REQUEST_TIMEOUT_MS = 10_000;

/** Lo que guarda la cookie del ingreso. */
export interface FlowData {
  provider: PortalProvider;
  state: string;
  codeVerifier: string;
  /** El idioma del portal al que se vuelve. */
  locale: Locale;
  /** La invitación con la que llegó el alumno, para canjearla al volver, o `null`. */
  inviteToken: string | null;
  /** Milisegundos desde 1970: la cookie no vale desde ese momento. */
  expiresAt: number;
}

export interface StartFlowInput {
  provider: PortalProvider;
  locale: Locale;
  inviteToken?: string | null;
  /** A dónde vuelve el proveedor (`redirectUriFor`). */
  redirectUri: string;
  now?: Date;
}

const urlSafe32Bytes = z.string().regex(URL_SAFE_32_BYTES);

/** La forma exacta de la cookie: cualquier campo de más, de menos o de otro tipo la anula. */
const flowSchema = z.strictObject({
  provider: z.enum(PORTAL_PROVIDERS),
  state: urlSafe32Bytes,
  codeVerifier: urlSafe32Bytes,
  locale: z.enum(routing.locales),
  inviteToken: urlSafe32Bytes.nullable(),
  expiresAt: z.number().int(),
});

/** Opciones de la cookie del ingreso. `secure` es verdadero salvo http en `localhost` (`shouldUseSecureCookie`). */
export function flowCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    // `Lax` y no `Strict`: la vuelta llega desde Discord o Google y la cookie tiene que viajar.
    sameSite: "lax",
    path: FLOW_COOKIE_PATH,
    maxAge: PORTAL_OAUTH_FLOW_MS / 1000,
  } as const;
}

/** El idioma del portal: `es`, `pt` o `en`; cualquier otra cosa es `es`. */
export function portalLocale(value: string | null | undefined): Locale {
  return routing.locales.find((locale) => locale === value) ?? routing.defaultLocale;
}

/** La invitación de la dirección si tiene la forma de una (32 bytes en base64url), o `null`. */
export function inviteTokenFrom(value: string | null | undefined): string | null {
  return typeof value === "string" && URL_SAFE_32_BYTES.test(value) ? value : null;
}

/** El `code_challenge` S256 de PKCE: el SHA-256 del verificador en base64url sin relleno (RFC 7636). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function randomToken(): string {
  return randomBytes(RANDOM_BYTES).toString("base64url");
}

function signature(payload: string, secret: Uint8Array): string {
  const key = createHmac("sha256", secret).update(FLOW_SIGNING_CONTEXT).digest();
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** Igualdad en tiempo constante de dos textos (falso enseguida si el largo difiere). */
function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function authorizationUrl(client: ProviderClient, flow: FlowData, redirectUri: string): string {
  const url = new URL(client.authorizationUrl);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: redirectUri,
    scope: client.scopes.join(" "),
    state: flow.state,
    code_challenge: pkceChallenge(flow.codeVerifier),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/**
 * Empieza un ingreso: la dirección de autorización del proveedor (con `state` y el
 * `code_challenge`) y el valor firmado de la cookie del ingreso. Tira si falta el
 * secreto del portal o si el proveedor no está habilitado: quien llama lo mira antes.
 */
export function startFlow({
  provider,
  locale,
  inviteToken = null,
  redirectUri,
  now = new Date(),
}: StartFlowInput): { authorizationUrl: string; cookieValue: string } {
  const secret = getPortalSecret();
  if (!secret) throw new Error("PORTAL_SESSION_SECRET falta o tiene menos de 32 caracteres.");
  const client = getProviderClient(provider);
  if (!client) throw new Error(`El proveedor ${provider} no está habilitado.`);

  const flow: FlowData = {
    provider,
    state: randomToken(),
    codeVerifier: randomToken(),
    locale: portalLocale(locale),
    inviteToken: inviteTokenFrom(inviteToken),
    expiresAt: now.getTime() + PORTAL_OAUTH_FLOW_MS,
  };
  const payload = Buffer.from(JSON.stringify(flow)).toString("base64url");
  return {
    authorizationUrl: authorizationUrl(client, flow, redirectUri),
    cookieValue: `${payload}.${signature(payload, secret)}`,
  };
}

function parseFlow(payload: string): FlowData | null {
  try {
    const result = flowSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Lo que guarda la cookie del ingreso, si la firmó este portal, es de un ingreso con
 * `provider` y no venció a la hora `now`; si no, `null` (sin cookie, alterada, firmada
 * con otro secreto, de otro proveedor, vencida). Nunca tira.
 */
export function readFlowCookie(
  raw: string | undefined,
  provider: PortalProvider,
  now: Date = new Date(),
): FlowData | null {
  const secret = getPortalSecret();
  if (!secret || !raw || raw.length > MAX_COOKIE_LENGTH) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  const [payload, signed] = parts;
  if (!sameText(signed, signature(payload, secret))) return null;
  const flow = parseFlow(payload);
  if (!flow || flow.provider !== provider || flow.expiresAt <= now.getTime()) return null;
  return flow;
}

/** ¿Es `state` (el que trajo la vuelta) el del ingreso? Comparación en tiempo constante. */
export function matchesState(flow: FlowData, state: string | null): boolean {
  return typeof state === "string" && sameText(state, flow.state);
}

export interface ExchangeOptions {
  /** La misma dirección de vuelta que se mandó al empezar: el proveedor la compara. */
  redirectUri: string;
  /** El `fetch` con el que se habla con el proveedor (los tests pasan uno falso). */
  fetch?: typeof fetch;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Anota por qué no se pudo leer la identidad: solo el paso y el código HTTP o el nombre
 * del error, nunca un cuerpo, el código, el verificador ni un token.
 */
function logFailure(provider: PortalProvider, reason: string): void {
  console.warn(`Portal: no se pudo completar el ingreso con ${provider} (${reason}).`);
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const json: unknown = await response.json();
    return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function requestInit(init: RequestInit): RequestInit {
  return { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(OAUTH_REQUEST_TIMEOUT_MS) };
}

/** El token de acceso a cambio del código y el verificador, o `null` si el proveedor no lo da. */
async function requestAccessToken(
  client: ProviderClient,
  code: string,
  codeVerifier: string,
  { redirectUri, fetch: fetchWith = globalThis.fetch }: ExchangeOptions,
): Promise<string | null> {
  const response = await fetchWith(
    client.tokenUrl,
    requestInit({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        client_id: client.clientId,
        client_secret: client.clientSecret,
      }).toString(),
    }),
  );
  if (!response.ok) {
    logFailure(client.provider, `el token respondió ${response.status}`);
    return null;
  }
  const body = await readJson(response);
  const token = body?.access_token;
  const type = body?.token_type;
  if (typeof token !== "string" || !token || typeof type !== "string" || type.toLowerCase() !== "bearer") {
    logFailure(client.provider, "la respuesta del token no trae un token de acceso");
    return null;
  }
  return token;
}

/** Quién ingresó, según el perfil que da el proveedor con el token, o `null`. */
async function requestIdentity(
  client: ProviderClient,
  accessToken: string,
  fetchWith: typeof fetch,
): Promise<ProviderIdentity | null> {
  const response = await fetchWith(
    client.userinfoUrl,
    requestInit({ method: "GET", headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } }),
  );
  if (!response.ok) {
    logFailure(client.provider, `el perfil respondió ${response.status}`);
    return null;
  }
  const identity = profileToIdentity(client.provider, await readJson(response));
  if (!identity) logFailure(client.provider, "el perfil no identifica a nadie");
  return identity;
}

/**
 * Cambia el código de la vuelta por la identidad del alumno: pide el token (con el
 * verificador de PKCE) y con él el perfil. El token se descarta acá mismo. Devuelve
 * `null` ante cualquier falla (proveedor no habilitado, respuesta con error, JSON roto,
 * perfil sin id, red caída o lenta) y nunca tira.
 */
export async function exchangeAndFetchIdentity(
  provider: PortalProvider,
  code: string,
  codeVerifier: string,
  options: ExchangeOptions,
): Promise<ProviderIdentity | null> {
  const client = getProviderClient(provider);
  if (!client) return null;
  try {
    const accessToken = await requestAccessToken(client, code, codeVerifier, options);
    if (!accessToken) return null;
    return await requestIdentity(client, accessToken, options.fetch ?? globalThis.fetch);
  } catch (error) {
    logFailure(provider, `sin respuesta: ${errorName(error)}`);
    return null;
  }
}
