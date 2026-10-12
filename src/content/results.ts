// Resultados de coaching de Tallami. Los datos salen del CLAUDE.md: no agregar
// ni redondear nada que no esté ahí. Los nombres de torneo van completos
// ("Reload Elite Series", "Esports World Cup"), no con las siglas del CLAUDE.md.

export type Win = {
  event: "FNCS" | "Reload Elite Series" | "Second Chance";
  season?: string;
  players: readonly string[];
};

export type LanResult = {
  place: number;
  event: "Esports World Cup" | "FNCS Globals";
  /** Edición o sede: "Reload", "ESL", "2025". */
  label: string;
};

/** Primeros puestos online, en el orden en que se muestran. */
export const WINS: readonly Win[] = [
  { event: "FNCS", season: "CH6S1", players: ["K1ng", "Fazer", "Phzin"] },
  { event: "FNCS", season: "CH5S3", players: ["K1ng", "Fazer"] },
  { event: "FNCS", season: "CH5S2", players: ["Randu", "Lewa"] },
  { event: "Reload Elite Series", players: ["Phzin", "Edson"] },
  { event: "Reload Elite Series", players: ["Romero", "Lewa"] },
  { event: "Second Chance", players: ["K1ng", "Fazer"] },
];

/** Campeonatos presenciales, del mejor al peor puesto. */
export const LAN_RESULTS: readonly LanResult[] = [
  { place: 5, event: "Esports World Cup", label: "Reload" },
  { place: 9, event: "Esports World Cup", label: "ESL" },
  { place: 11, event: "FNCS Globals", label: "2025" },
  { place: 12, event: "FNCS Globals", label: "2025" },
  { place: 14, event: "FNCS Globals", label: "2026" },
  { place: 22, event: "FNCS Globals", label: "2024" },
];

export const FNCS_TITLES = WINS.filter((win) => win.event === "FNCS").length;
export const FIRST_PLACES = WINS.length;
