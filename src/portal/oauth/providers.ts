// Con quién ingresa un alumno: Discord, Google o el proveedor de prueba. Por cada uno,
// sus direcciones de OAuth 2.0 (autorización, token y perfil), los scopes y cómo se
// lee su perfil. Verificado en la documentación oficial (28-oct-2026):
//
// - Discord (docs.discord.com/developers/topics/oauth2 y /resources/user): autoriza en
//   `https://discord.com/oauth2/authorize`, da el token en
//   `https://discord.com/api/v10/oauth2/token` (form-urlencoded, con `code_verifier` de
//   PKCE) y el perfil en `GET https://discord.com/api/v10/users/@me`. Con `identify`
//   llegan `id`, `username` y `global_name` (el nombre para mostrar, o `null`); con
//   `email` llegan `email` y `verified`. La versión va siempre explícita: sin ella,
//   Discord contesta con la predeterminada, la v6, que está deprecada (tabla de
//   versiones de docs.discord.com/developers/reference; la v10 es la más nueva).
// - Google (su documento de descubrimiento de OpenID Connect,
//   accounts.google.com/.well-known/openid-configuration): autoriza en
//   `https://accounts.google.com/o/oauth2/v2/auth` (PKCE S256), da el token en
//   `https://oauth2.googleapis.com/token` y el perfil en
//   `https://openidconnect.googleapis.com/v1/userinfo`: `sub` (el id, que nunca se
//   reutiliza; el email puede cambiar), `name`, `email` y `email_verified`.
// - El proveedor de prueba es el servidor OAuth falso de los tests
//   (`tests/helpers/mock-oauth-server.mjs`) en `PORTAL_OAUTH_TEST_ISSUER`; nunca en
//   Vercel (`testClient`). Habla como uno de verdad.
//
// `getProviderClient` es la única que decide si un proveedor está habilitado: la lista de
// `enabledProviders` (`config.ts`) sale de ella, así la lista de botones y la ruta que
// empieza el ingreso no pueden discrepar.
//
// De un perfil se guarda solo el id, el nombre para mostrar y el email si el proveedor
// dice que está verificado: nada de avatar ni de tokens.

import { SITE_URL } from "@/lib/site-url";
import type { ProviderIdentity } from "../accounts";
import type { PortalProvider } from "../config";

/** Las direcciones de OAuth de un proveedor y lo que se le pide. */
export interface OAuthEndpoints {
  authorizationUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: readonly string[];
}

/** Un proveedor listo para usar: sus direcciones y el cliente (id y secreto) de esta web. */
export interface ProviderClient extends OAuthEndpoints {
  provider: PortalProvider;
  clientId: string;
  clientSecret: string;
}

export const DISCORD_OAUTH: OAuthEndpoints = {
  authorizationUrl: "https://discord.com/oauth2/authorize",
  tokenUrl: "https://discord.com/api/v10/oauth2/token",
  userinfoUrl: "https://discord.com/api/v10/users/@me",
  scopes: ["identify", "email"],
};

export const GOOGLE_OAUTH: OAuthEndpoints = {
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  scopes: ["openid", "email", "profile"],
};

/**
 * El cliente de esta web en el servidor OAuth falso. No es un secreto: ese servidor
 * solo existe en los tests y en la máquina de quien desarrolla.
 */
const TEST_CLIENT = { clientId: "tallami-portal-test", clientSecret: "cliente-de-prueba-del-portal" } as const;

/** El nombre para mostrar se corta a este largo. */
export const MAX_DISPLAY_NAME_LENGTH = 100;
/** Un email tiene como mucho 254 caracteres (RFC 5321). */
const MAX_EMAIL_LENGTH = 254;
/** Un id del proveedor: de 1 a 255 caracteres visibles, sin espacios (un snowflake de Discord, un `sub` de Google). */
const PROVIDER_USER_ID = /^[\x21-\x7e]{1,255}$/;
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;

/** El valor de una variable sin los espacios de los costados, o `null` si falta o está vacía. */
function readEnv(name: string): string | null {
  return process.env[name]?.trim() || null;
}

/** La dirección del servidor OAuth falso, sin barra final, o `null` si no es una dirección http(s). */
function testIssuer(): string | null {
  const issuer = readEnv("PORTAL_OAUTH_TEST_ISSUER")?.replace(/\/+$/, "");
  if (!issuer || !URL.canParse(issuer)) return null;
  const { protocol } = new URL(issuer);
  return protocol === "http:" || protocol === "https:" ? issuer : null;
}

/** ¿Ya se avisó en este proceso que el proveedor de prueba se ignora? (Se pregunta en cada pedido.) */
let warnedTestProviderIgnored = false;

/**
 * El cliente del servidor OAuth falso, o `null` si `PORTAL_OAUTH_TEST_ISSUER` falta o no es
 * una dirección http(s). En Vercel (`VERCEL`, en cualquier entorno: producción, vista previa o
 * `vercel dev`) se ignora con un aviso en el log, una vez por proceso, igual que
 * `ADMIN_WEBAUTHN_ORIGIN` y `EXCHANGE_RATE_SOURCE`: una variable de prueba olvidada ahí dejaría
 * entrar con un proveedor falso. Se mira `VERCEL` y no `NODE_ENV` porque los e2e corren un
 * build de producción en la máquina.
 */
function testClient(): ProviderClient | null {
  if (!readEnv("PORTAL_OAUTH_TEST_ISSUER")) return null;
  if (process.env.VERCEL) {
    if (!warnedTestProviderIgnored) {
      warnedTestProviderIgnored = true;
      console.warn(
        "PORTAL_OAUTH_TEST_ISSUER se ignora en Vercel (VERCEL está definida): no hay proveedor de prueba. Sacá la variable.",
      );
    }
    return null;
  }
  const issuer = testIssuer();
  if (!issuer) return null;
  return {
    provider: "test",
    authorizationUrl: `${issuer}/authorize`,
    tokenUrl: `${issuer}/token`,
    userinfoUrl: `${issuer}/userinfo`,
    scopes: GOOGLE_OAUTH.scopes,
    ...TEST_CLIENT,
  };
}

function realClient(provider: "discord" | "google", endpoints: OAuthEndpoints): ProviderClient | null {
  const prefix = provider.toUpperCase();
  const clientId = readEnv(`${prefix}_CLIENT_ID`);
  const clientSecret = readEnv(`${prefix}_CLIENT_SECRET`);
  if (!clientId || !clientSecret) return null;
  return { provider, ...endpoints, clientId, clientSecret };
}

/**
 * El proveedor listo para usar, o `null` si no está habilitado ahora (sin su id y su
 * secreto, o el de prueba sin `PORTAL_OAUTH_TEST_ISSUER`, con una dirección que no
 * sirve, o en Vercel). Es la fuente de verdad de qué proveedores están habilitados.
 */
export function getProviderClient(provider: PortalProvider): ProviderClient | null {
  switch (provider) {
    case "discord":
      return realClient("discord", DISCORD_OAUTH);
    case "google":
      return realClient("google", GOOGLE_OAUTH);
    case "test":
      return testClient();
  }
}

/**
 * La dirección a la que vuelve el proveedor después de autorizar. Discord y Google
 * vuelven a la dirección pública del sitio (`NEXT_PUBLIC_SITE_URL`): es la que se
 * registra en sus consolas y tiene que coincidir letra por letra. El proveedor de
 * prueba vuelve al servidor que empezó el ingreso (`requestOrigin`): los e2e corren
 * en su propio puerto, y ese proveedor nunca existe en producción.
 */
export function redirectUriFor(provider: PortalProvider, requestOrigin: string): string {
  const origin = provider === "test" ? requestOrigin : SITE_URL;
  return `${origin}/api/portal/auth/${provider}/callback`;
}

/**
 * La marca que lleva la redirección a la dirección pública (`?redirigido=1`). Si la dirección
 * pública a su vez manda de vuelta al origen de donde vino el pedido (un servidor de adelante que
 * redirige la raíz al `www`, o al revés), cada vuelta armaría otra redirección y el navegador
 * giraría hasta rendirse. Un pedido que ya llega marcado a un origen que no es el público no se
 * redirige otra vez: se corta con un 404 (`isCanonicalRedirectLoop`).
 */
export const CANONICAL_REDIRECT_PARAM = "redirigido";

/**
 * Discord y Google vuelven a `SITE_URL`, y la cookie del ingreso tiene que estar en ese
 * mismo sitio: un ingreso que empieza en otra dirección (el `www`, una vista previa de
 * Vercel) dejaría la cookie ahí y la vuelta no la encontraría. Si el pedido llegó a un
 * origen que no es el público, devuelve la misma ruta y consulta en `SITE_URL`, más la marca
 * `CANONICAL_REDIRECT_PARAM`, para mandar al navegador ahí antes de empezar. `null` si no hace
 * falta: ya está en el origen público, o es el proveedor de prueba (que vuelve al servidor que
 * empezó). Quien la usa corta antes los bucles con `isCanonicalRedirectLoop`.
 *
 * La dirección se arma sumando textos (`SITE_URL` + ruta): una ruta como `//otro.com`
 * queda dentro de este sitio, nunca se vuelve una dirección sin protocolo.
 */
export function canonicalSignInUrl(provider: PortalProvider, requestUrl: URL): string | null {
  if (isOnPublicOrigin(provider, requestUrl)) return null;
  const separator = requestUrl.search ? "&" : "?";
  return `${SITE_URL}${requestUrl.pathname}${requestUrl.search}${separator}${CANONICAL_REDIRECT_PARAM}=1`;
}

/**
 * ¿Es este pedido la segunda vuelta de una redirección a la dirección pública que no llegó a
 * ella? Lleva la marca y sigue en un origen que no es el público: redirigir otra vez sería un
 * bucle. En la dirección pública la marca es la vuelta normal y no cuenta.
 */
export function isCanonicalRedirectLoop(provider: PortalProvider, requestUrl: URL): boolean {
  return !isOnPublicOrigin(provider, requestUrl) && requestUrl.searchParams.has(CANONICAL_REDIRECT_PARAM);
}

/** ¿Empieza el ingreso donde corresponde? El proveedor de prueba, donde sea; los demás, en `SITE_URL`. */
function isOnPublicOrigin(provider: PortalProvider, requestUrl: URL): boolean {
  return provider === "test" || requestUrl.origin === new URL(SITE_URL).origin;
}

type Profile = Record<string, unknown>;

function asProfile(json: unknown): Profile | null {
  return typeof json === "object" && json !== null && !Array.isArray(json) ? (json as Profile) : null;
}

function cleanId(value: unknown): string | null {
  return typeof value === "string" && PROVIDER_USER_ID.test(value) ? value : null;
}

/** Un nombre sin caracteres de control ni espacios a los costados, cortado al máximo; `null` si queda vacío. */
function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(CONTROL_CHARACTERS, "").trim().slice(0, MAX_DISPLAY_NAME_LENGTH).trim();
  return name || null;
}

function cleanEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  return email.length <= MAX_EMAIL_LENGTH && EMAIL.test(email) ? email : null;
}

function identity(
  provider: PortalProvider,
  providerUserId: string | null,
  displayName: string | null,
  email: string | null,
): ProviderIdentity | null {
  if (!providerUserId || !displayName) return null;
  return { provider, providerUserId, displayName, email };
}

/** Discord: `id`, `global_name` (o `username`) y el email solo si `verified` es `true`. */
function discordIdentity(profile: Profile): ProviderIdentity | null {
  const email = profile.verified === true ? cleanEmail(profile.email) : null;
  const name = cleanName(profile.global_name) ?? cleanName(profile.username);
  return identity("discord", cleanId(profile.id), name, email);
}

/** Google: `sub`, `name` y el email solo si `email_verified` es `true`. Sin nombre, se muestra el email. */
function googleIdentity(profile: Profile): ProviderIdentity | null {
  const email = profile.email_verified === true ? cleanEmail(profile.email) : null;
  return identity("google", cleanId(profile.sub), cleanName(profile.name) ?? email, email);
}

/** El proveedor de prueba: `sub`, `name` y `email`. */
function testIdentity(profile: Profile): ProviderIdentity | null {
  return identity("test", cleanId(profile.sub), cleanName(profile.name), cleanEmail(profile.email));
}

const PROFILE_READERS: Record<PortalProvider, (profile: Profile) => ProviderIdentity | null> = {
  discord: discordIdentity,
  google: googleIdentity,
  test: testIdentity,
};

/**
 * Quién ingresó, según el perfil que devolvió el proveedor, o `null` si el perfil no
 * identifica a nadie (sin id, sin ningún nombre, o algo que no es un perfil).
 */
export function profileToIdentity(provider: PortalProvider, json: unknown): ProviderIdentity | null {
  const profile = asProfile(json);
  return profile ? PROFILE_READERS[provider](profile) : null;
}
