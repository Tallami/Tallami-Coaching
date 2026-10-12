// Jugadores de la franja "Trabajé con", en el orden en que se muestran. El
// nombre es el de jugador, sin tag de equipo; `handle` es su usuario de X.
//
// Para sumar uno: `npm run players:photo -- <usuario>` baja su foto a
// `src/assets/players/<usuario en minúsculas>.jpg`; se importa acá y se agrega
// a la lista. La foto es opcional: sin foto se muestra la inicial.

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
