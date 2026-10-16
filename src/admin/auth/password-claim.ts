// El claim de contraseña de las sesiones. Cada sesión (JWT) lleva `pwv`, un valor
// corto derivado del hash de la contraseña vigente (`ADMIN_PASSWORD_HASH`) y del
// secreto de las sesiones. Al verificar una sesión se recalcula con el hash
// actual: si Tallami cambia la contraseña, el hash es otro, el claim ya no
// coincide y todas las sesiones anteriores dejan de valer, sin guardar nada en
// la base.
//
// Es un HMAC-SHA256 del hash con una clave que sale del secreto con un contexto
// propio (como `hashIp`), recortado a 16 caracteres hexadecimales (64 bits):
// alcanza para distinguir "la misma contraseña" de "otra" y, como está firmado
// con el secreto, no permite volver al hash. El JWT va en una cookie y su
// contenido se puede leer, por eso el hash nunca viaja tal cual.
//
// Este archivo solo usa `node:crypto`: lo cargan la sesión y los tests e2e (que
// firman sesiones con el hash de prueba).

import { createHmac } from "node:crypto";

/** Nombre del claim dentro del JWT. */
export const PASSWORD_CLAIM = "pwv";
/** Largo del claim, en caracteres hexadecimales. */
export const PASSWORD_CLAIM_LENGTH = 16;

const CONTEXT = "tallami-admin:password-claim:v1";

/** El claim de `passwordHash` para sesiones firmadas con `secret`. */
export function passwordClaim(secret: Uint8Array, passwordHash: string): string {
  const key = createHmac("sha256", secret).update(CONTEXT).digest();
  return createHmac("sha256", key).update(passwordHash).digest("hex").slice(0, PASSWORD_CLAIM_LENGTH);
}
