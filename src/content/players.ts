// Jugadores de la franja "Trabajé con", en el orden en que se muestran. El
// nombre es el de jugador, sin tag de equipo; `handle` es su usuario de X.
//
// Para sumar uno:
//   1. `npm run players:photo -- <usuario>` baja su foto a
//      `src/assets/players/<usuario en minúsculas>.jpg`.
//   2. Importala arriba (en orden alfabético, como las demás) y agregá una
//      línea a `PLAYERS` con `name`, `handle` y `photo`, escrita como las
//      demás (cada jugador en una sola línea: los e2e leen la lista de ese
//      formato, y un test avisa si deja de coincidir).
//   3. Corré `npm run test` y `npm run test:e2e`.
//
// La foto es opcional: sin foto se muestra la inicial sobre un círculo azul.
// Si el archivo de la foto existe pero no se importó, un test lo avisa. Los
// tweets de la sección "Reviews" solo pueden ser de jugadores de esta lista.

import type { StaticImageData } from "next/image";
import edsonmalado from "@/assets/players/edsonmalado.jpg";
import fazerfn from "@/assets/players/fazerfn.jpg";
import k1ng from "@/assets/players/k1ng.jpg";
import lewafn from "@/assets/players/lewafn.jpg";
import loudDiguera from "@/assets/players/loud_diguera.jpg";
import mackftn from "@/assets/players/mackftn.jpg";
import phzinfps1 from "@/assets/players/phzinfps1.jpg";
import randuimmm from "@/assets/players/randuimmm.jpg";
import romerofdps from "@/assets/players/romerofdps.jpg";
import tiscofn from "@/assets/players/tiscofn.jpg";
import vadealfn from "@/assets/players/vadealfn.jpg";

export type Player = {
  name: string;
  handle: string;
  photo?: StaticImageData;
};

export const PLAYERS: readonly Player[] = [
  { name: "K1ng", handle: "k1ng", photo: k1ng },
  { name: "Fazer", handle: "fazerfn", photo: fazerfn },
  { name: "Phzin", handle: "Phzinfps1", photo: phzinfps1 },
  { name: "Randu", handle: "randuimmm", photo: randuimmm },
  { name: "Lewa", handle: "LewaFn", photo: lewafn },
  { name: "Romero", handle: "romerofdps", photo: romerofdps },
  { name: "Edson", handle: "edsonmalado", photo: edsonmalado },
  { name: "Tisco", handle: "Tiscofn", photo: tiscofn },
  { name: "Diguera", handle: "loud_diguera", photo: loudDiguera },
  { name: "Mack", handle: "mackftn", photo: mackftn },
  { name: "Vadeal", handle: "VadealFN", photo: vadealfn },
];

// Un `Map`: un usuario como "constructor" o "__proto__" no tiene que encontrar
// nada. X no distingue mayúsculas en los usuarios, así que se busca en minúscula.
const PLAYERS_BY_HANDLE: ReadonlyMap<string, Player> = new Map(
  PLAYERS.map((player) => [player.handle.toLowerCase(), player]),
);

/**
 * El jugador de ese usuario de X, o `undefined` si no está en la lista. Las
 * tarjetas del muro de Reviews lo usan para mostrar su foto local en lugar del
 * avatar que manda X.
 */
export function playerByHandle(handle: string): Player | undefined {
  return PLAYERS_BY_HANDLE.get(handle.toLowerCase());
}
