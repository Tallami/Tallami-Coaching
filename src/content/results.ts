// Resultados de coaching de Tallami. Copia literal del CLAUDE.md: no agregar
// ni redondear nada que no esté ahí.

export type Win = {
  event: "FNCS" | "Reload Elite" | "Second Chance";
  season?: string;
  players: readonly string[];
};

export type OtherResult = {
  place: number;
  event: "EWC Reload" | "EWC ESL" | "Globals";
  season?: string;
};

/** Primeros puestos, en el orden en que se muestran. */
export const WINS: readonly Win[] = [
  { event: "FNCS", season: "CH6S1", players: ["K1ng", "Fazer", "Phzin"] },
  { event: "FNCS", season: "CH5S3", players: ["K1ng", "Fazer"] },
  { event: "FNCS", season: "CH5S2", players: ["Randu", "Lewa"] },
  { event: "Reload Elite", players: ["Phzin", "Edson"] },
  { event: "Reload Elite", players: ["Romero", "Lewa"] },
  { event: "Second Chance", players: ["K1ng", "Fazer"] },
];

/** Otros resultados de torneo, en el orden en que se muestran. */
export const OTHER_RESULTS: readonly OtherResult[] = [
  { place: 5, event: "EWC Reload" },
  { place: 9, event: "EWC ESL" },
  { place: 11, event: "Globals", season: "2025" },
  { place: 12, event: "Globals", season: "2025" },
  { place: 14, event: "Globals", season: "2026" },
  { place: 22, event: "Globals", season: "2024" },
];

export const COACHING_EARNINGS_USD = 45300;
export const EARNINGS_SINCE = "CH5S4";

export const FNCS_TITLES = WINS.filter((win) => win.event === "FNCS").length;
export const FIRST_PLACES = WINS.length;
