// Números al azar con semilla fija para los datos de ejemplo: el mismo día da
// siempre los mismos datos, en cualquier motor de JavaScript.

const TWO_POW_32 = 4_294_967_296;

export type Random = () => number;

/** mulberry32: un generador chico y determinístico. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / TWO_POW_32;
  };
}

/** Elige un valor según sus pesos relativos. */
export function pickWeighted<T>(random: Random, options: readonly (readonly [T, number])[]): T {
  const total = options.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return options[options.length - 1][0];
}
