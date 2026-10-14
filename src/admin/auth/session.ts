// Sesión del panel: un JWT firmado (HS256) con `ADMIN_SESSION_SECRET`, guardado
// en una cookie. No hay usuarios ni sesiones en la base: la cookie es válida si
// la firma, la audiencia y el vencimiento son correctos.

import { createHmac } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getSessionSecret } from "./config";

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

/** Firma una sesión nueva: audiencia del panel y vencimiento a las 12 horas. */
export async function createSessionToken(): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(requireSecret());
}

/**
 * ¿Es `token` una sesión válida? Exige firma HS256 con el secreto, la audiencia
 * del panel y un vencimiento que no pasó. Cualquier otra cosa (sin cookie,
 * texto cualquiera, `alg: none`, otro algoritmo, token sin vencimiento) es
 * `false`; nunca tira.
 */
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  const secret = getSessionSecret();
  if (!token || !secret) return false;
  try {
    await jwtVerify(token, secret, {
      algorithms: [ALGORITHM],
      audience: SESSION_AUDIENCE,
      requiredClaims: ["exp"],
    });
    return true;
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
