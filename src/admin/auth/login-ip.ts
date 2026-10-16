// Quién cuenta como "la misma conexión" en el límite de intentos de ingreso.
// Es la misma clave que usa el registro de clics (`interestIpKey`): una IPv6 se
// cuenta por su /64 (una conexión doméstica recibe un /64 entero y puede
// cambiar de dirección dentro de él a voluntad: contar por dirección completa
// le daría 2^64 cupos de 5 intentos) y una IPv4 escrita dentro de una IPv6
// (`::ffff:203.0.113.9`) cuenta como esa IPv4.
//
// Lo que se guarda en `login_attempts` es el HMAC de esa clave (`hashIp`), sin
// la fecha: la ventana de 15 minutos puede cruzar la medianoche y el límite
// tiene que seguir contando. No coincide con lo que guardan los clics
// (`interestIpHash`, que suma el día), así las dos tablas no se pueden vincular.

import { interestIpKey } from "../interest/ip-key";
import { hashIp } from "./session";

/** El hash con el que se agrupan los intentos de ingreso de `ip` (lo que devuelve `getClientIp`). */
export function loginIpHash(ip: string): string {
  return hashIp(interestIpKey(ip));
}
