// Cómo se guarda el visitante de un clic sin poder seguirlo. La clave
// (`interestIpKey`, en `src/admin/net/ip-key.ts`) decide quién cuenta como "el
// mismo visitante"; lo que se guarda es un HMAC de esa clave con la fecha de
// Argentina del clic (`interestIpHash`): el mismo visitante tiene otro hash
// cada día, así que las filas no se pueden vincular entre días ni con
// `login_attempts` (que hashea la clave sin el día: su ventana de 15 minutos
// puede cruzar la medianoche). Dentro del día el límite funciona igual; a
// medianoche el cupo vuelve a empezar, un costo inofensivo.

import { hashIp } from "@/admin/auth/session";
import { interestIpKey } from "@/admin/net/ip-key";

/**
 * El hash que se guarda: HMAC de la clave del visitante con el día de Argentina
 * ("AAAA-MM-DD"). Necesita `ADMIN_SESSION_SECRET` (como `hashIp`).
 */
export function interestIpHash(ip: string, day: string): string {
  return hashIp(`${interestIpKey(ip)}|${day}`);
}
