// Quién cuenta como "el mismo visitante" en el límite de clics, y cómo se
// guarda sin poder seguirlo. La clave (`interestIpKey`) también la usa el límite
// de intentos de ingreso al panel (`src/admin/auth/login-ip.ts`); `getClientIp`
// no cambia.
//
// - IPv4: la dirección tal cual.
// - IPv6: los primeros 64 bits (el /64). Una conexión doméstica recibe un /64
//   entero y puede cambiar de dirección dentro de él a voluntad: contar por
//   dirección completa daría 2^64 cupos por conexión.
// - IPv6 con una IPv4 adentro (`::ffff:203.0.113.9` o `::ffff:cb00:7109`): se
//   cuenta como esa IPv4, así las dos formas de escribirla comparten cupo.
//
// Lo que se guarda es un HMAC de esa clave con la fecha de Argentina del
// clic (`interestIpHash`): el mismo visitante tiene otro hash cada día, así que
// las filas no se pueden vincular entre días ni con `login_attempts` (que hashea
// la clave sin el día: su ventana de 15 minutos puede cruzar la medianoche).
// Dentro del día el límite funciona igual; a medianoche el cupo vuelve a
// empezar, un costo inofensivo.

import { isIP } from "node:net";
import { hashIp } from "@/admin/auth/session";

const UNKNOWN_KEY = "unknown";
const GROUPS = 8;
const PREFIX_GROUPS = 4;
const MAPPED_MARKER = 0xffff;
const OCTET_MAX = 255;
const GROUP_MAX = 0xffff;
const BYTE = 256;

/** Las 8 partes de 16 bits de una IPv6 válida (con `::`, con una IPv4 al final o con zona), o `null`. */
function parseIpv6(address: string): number[] | null {
  let text = address.split("%")[0].toLowerCase();
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = tail.split(".").map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > OCTET_MAX)) {
      return null;
    }
    const high = (octets[0] * BYTE + octets[1]).toString(16);
    const low = (octets[2] * BYTE + octets[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part === "" ? [] : part.split(":").map((group) => parseInt(group, 16)));
  const head = toGroups(halves[0]);
  const rest = halves.length === 2 ? toGroups(halves[1]) : [];
  const zeros = halves.length === 2 ? GROUPS - head.length - rest.length : 0;
  if (zeros < 0) return null;

  const groups = [...head, ...Array.from({ length: zeros }, () => 0), ...rest];
  const valid = groups.length === GROUPS && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= GROUP_MAX);
  return valid ? groups : null;
}

/**
 * La clave del visitante para `ip` (lo que devuelve `getClientIp`: una IP
 * válida en minúsculas, o `"unknown"`): `v4:203.0.113.9`, `v6:2001:db8:1:2`
 * (el /64) o `unknown`.
 */
export function interestIpKey(ip: string): string {
  const version = isIP(ip);
  if (version === 4) return `v4:${ip}`;
  const groups = version === 6 ? parseIpv6(ip) : null;
  if (!groups) return UNKNOWN_KEY;

  const isMapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === MAPPED_MARKER;
  if (isMapped) {
    return `v4:${Math.floor(groups[6] / BYTE)}.${groups[6] % BYTE}.${Math.floor(groups[7] / BYTE)}.${groups[7] % BYTE}`;
  }
  return `v6:${groups.slice(0, PREFIX_GROUPS).map((group) => group.toString(16)).join(":")}`;
}

/**
 * El hash que se guarda: HMAC de la clave del visitante con el día de Argentina
 * ("AAAA-MM-DD"). Necesita `ADMIN_SESSION_SECRET` (como `hashIp`).
 */
export function interestIpHash(ip: string, day: string): string {
  return hashIp(`${interestIpKey(ip)}|${day}`);
}
