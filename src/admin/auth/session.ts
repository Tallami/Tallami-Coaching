// Cookie de sesión del panel: un JWT firmado (HS256) con `ADMIN_SESSION_SECRET`
// que lleva el id de una sesión guardada en la base (`sessions.ts`). El token es
// válido si la firma, la audiencia, el vencimiento (el máximo de la sesión) y el
// claim de la contraseña son correctos y trae un id bien formado: es la
// verificación criptográfica que hace el `proxy` sin tocar la base. Que la
// sesión exista, no esté cerrada ni lleve mucho sin uso lo mira `requireAdmin()`
// en la base. El claim de la contraseña (`password-claim.ts`) cambia cuando
// cambia `ADMIN_PASSWORD_HASH`, así cambiar la contraseña cierra todas las
// sesiones.

import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getPasswordHash, getSessionSecret } from "./config";
import { PASSWORD_CLAIM, passwordClaim } from "./password-claim";
import { SESSION_MAX_MS } from "./policy";

export const ADMIN_COOKIE = "tallami_admin";
/** Para qué sirve el token: un token firmado con el mismo secreto pero otra audiencia no entra. */
export const SESSION_AUDIENCE = "tallami-admin";
/** La cookie y el token duran lo que la sesión más larga: 8 horas. */
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_MS / 1000;
/** La cookie solo viaja a `/admin`: el sitio público y `/api` nunca la reciben. */
export const SESSION_COOKIE_PATH = "/admin";
/** El claim del token con el id de la sesión de la base. */
const SESSION_ID_CLAIM = "sid";
/** Un id de sesión son 32 bytes al azar, en base64url: 43 caracteres. */
export const SESSION_ID_BYTES = 32;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const ALGORITHM = "HS256";
const IP_HASH_CONTEXT = "tallami-admin:ip-hash:v1";

/** ¿Tiene `value` la forma de un id de sesión? (No dice si la sesión existe.) */
export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

function requireSecret(): Uint8Array {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET falta o tiene menos de 32 caracteres.");
  }
  return secret;
}

/** El claim de la contraseña vigente, o `null` si el hash no está configurado. */
function currentPasswordClaim(secret: Uint8Array): string | null {
  const passwordHash = getPasswordHash();
  return passwordHash ? passwordClaim(secret, passwordHash) : null;
}

/** Igualdad en tiempo constante de dos textos (falso enseguida si el largo difiere). */
function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Firma el token de la sesión `sessionId`: audiencia del panel, vencimiento a las
 * 8 horas (lo máximo que dura una sesión), el claim de la contraseña vigente y el
 * id de la sesión (`sid`). Tira si falta el secreto o el hash, o si `sessionId` no
 * tiene la forma de un id de sesión.
 */
export async function createSessionToken(sessionId: string): Promise<string> {
  if (!isSessionId(sessionId)) {
    throw new Error("El id de sesión no tiene el formato esperado.");
  }
  const secret = requireSecret();
  const claim = currentPasswordClaim(secret);
  if (claim === null) {
    throw new Error("ADMIN_PASSWORD_HASH falta o no tiene el formato esperado.");
  }
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({ [PASSWORD_CLAIM]: claim, [SESSION_ID_CLAIM]: sessionId })
    .setProtectedHeader({ alg: ALGORITHM })
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SESSION_MAX_AGE_SECONDS)
    .sign(secret);
}

/**
 * El id de sesión de `token`, si el token es válido. Exige firma HS256 con el
 * secreto, la audiencia del panel, un vencimiento que no pasó, el claim de la
 * contraseña vigente (una sesión de antes de cambiar `ADMIN_PASSWORD_HASH` no
 * vale) y un `sid` con la forma de un id de sesión: un token de antes de que las
 * sesiones se guardaran en la base no vale. Cualquier otra cosa (sin cookie,
 * texto cualquiera, `alg: none`, otro algoritmo, token sin vencimiento) es
 * `null`; nunca tira. No consulta la base: que la sesión exista y siga abierta
 * lo decide `validateSession`.
 */
export async function readSessionClaims(
  token: string | undefined,
): Promise<{ sessionId: string } | null> {
  const secret = getSessionSecret();
  if (!token || !secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
      audience: SESSION_AUDIENCE,
      requiredClaims: ["exp"],
    });
    const expected = currentPasswordClaim(secret);
    const claim = payload[PASSWORD_CLAIM];
    if (expected === null || typeof claim !== "string" || !sameText(claim, expected)) return null;
    const sessionId = payload[SESSION_ID_CLAIM];
    return isSessionId(sessionId) ? { sessionId } : null;
  } catch {
    return null;
  }
}

/**
 * ¿Es `token` una sesión válida para el `proxy`? La verificación criptográfica
 * de `readSessionClaims`, sin la base. Nunca tira.
 */
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  return (await readSessionClaims(token)) !== null;
}

/**
 * HMAC-SHA256 de la IP, en hexadecimal. Con él se agrupan los intentos de
 * ingreso sin guardar la IP: sin el secreto no se puede volver de un hash a
 * la dirección probando las 4.300 millones de IPv4. La clave sale del secreto
 * de sesión con un contexto propio, así el mismo secreto no firma dos cosas
 * distintas.
 */
export function hashIp(ip: string): string {
  const key = createHmac("sha256", requireSecret()).update(IP_HASH_CONTEXT).digest();
  return createHmac("sha256", key).update(ip).digest("hex");
}

/** Opciones de la cookie de sesión. `secure` lo decide `shouldUseSecureCookie`. */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: SESSION_COOKIE_PATH,
    maxAge: SESSION_MAX_AGE_SECONDS,
  } as const;
}
