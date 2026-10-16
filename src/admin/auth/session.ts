// Sesión del panel: un JWT firmado (HS256) con `ADMIN_SESSION_SECRET`, guardado
// en una cookie. No hay usuarios ni sesiones en la base: la cookie es válida si
// la firma, la audiencia, el vencimiento y el claim de la contraseña son
// correctos. El claim (`password-claim.ts`) cambia cuando cambia
// `ADMIN_PASSWORD_HASH`, así cambiar la contraseña cierra todas las sesiones.

import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getPasswordHash, getSessionSecret } from "./config";
import { PASSWORD_CLAIM, passwordClaim } from "./password-claim";

export const ADMIN_COOKIE = "tallami_admin";
/** Para qué sirve el token: un token firmado con el mismo secreto pero otra audiencia no entra. */
export const SESSION_AUDIENCE = "tallami-admin";
export const SESSION_HOURS = 12;
export const SESSION_MAX_AGE_SECONDS = SESSION_HOURS * 60 * 60;
/** La cookie solo viaja a `/admin`: el sitio público y `/api` nunca la reciben. */
export const SESSION_COOKIE_PATH = "/admin";

const ALGORITHM = "HS256";
const IP_HASH_CONTEXT = "tallami-admin:ip-hash:v1";

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
 * Firma una sesión nueva: audiencia del panel, vencimiento a las 12 horas y el
 * claim de la contraseña vigente. Tira si falta el secreto o el hash.
 */
export async function createSessionToken(): Promise<string> {
  const secret = requireSecret();
  const claim = currentPasswordClaim(secret);
  if (claim === null) {
    throw new Error("ADMIN_PASSWORD_HASH falta o no tiene el formato esperado.");
  }
  return new SignJWT({ [PASSWORD_CLAIM]: claim })
    .setProtectedHeader({ alg: ALGORITHM })
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret);
}

/**
 * ¿Es `token` una sesión válida? Exige firma HS256 con el secreto, la audiencia
 * del panel, un vencimiento que no pasó y el claim de la contraseña vigente:
 * una sesión de antes de cambiar `ADMIN_PASSWORD_HASH` (o de antes de que
 * existiera el claim) no vale. Cualquier otra cosa (sin cookie, texto
 * cualquiera, `alg: none`, otro algoritmo, token sin vencimiento) es `false`;
 * nunca tira.
 */
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  const secret = getSessionSecret();
  if (!token || !secret) return false;
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
      audience: SESSION_AUDIENCE,
      requiredClaims: ["exp"],
    });
    const expected = currentPasswordClaim(secret);
    const claim = payload[PASSWORD_CLAIM];
    return expected !== null && typeof claim === "string" && sameText(claim, expected);
  } catch {
    return false;
  }
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
