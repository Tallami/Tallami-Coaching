// Escalas de los gráficos: el tope y las líneas guía del eje de dinero, y el
// largo de una barra. Todo en unidades menores (centavos) y enteros; los
// pasos son 1, 2 o 5 por una potencia de diez, en dólares enteros, así el eje
// dice 0 / 500 / 1.000 y no 0 / 430 / 860.

export interface MoneyScale {
  /** Tope del eje en centavos: el primer múltiplo del paso que alcanza al máximo. */
  max: number;
  /** Líneas guía en centavos, de 0 al tope. */
  ticks: number[];
}

const CENTS_PER_UNIT = 100;
const MAX_INTERVALS = 5;
const STEP_FACTORS = [1, 2, 5] as const;
const MAX_POWER_OF_TEN = 12;
/** Con todo en cero se dibuja un eje de 0 a 100 dólares. */
const EMPTY_SCALE_STEP_MINOR = 20 * CENTS_PER_UNIT;
/** Una barra con plata nunca desaparece: como mínimo, 2 píxeles. */
const MIN_VISIBLE_LENGTH = 2;

/**
 * Eje de dinero para un máximo en centavos: a lo sumo cinco tramos. Tira
 * `RangeError` si el máximo no es un entero desde cero.
 */
export function niceScale(maxMinor: number): MoneyScale {
  if (!Number.isSafeInteger(maxMinor) || maxMinor < 0) {
    throw new RangeError(`El máximo tiene que ser un entero desde 0 (centavos), pero llegó ${maxMinor}.`);
  }
  const step = maxMinor === 0 ? EMPTY_SCALE_STEP_MINOR : stepFor(maxMinor);
  const intervals = maxMinor === 0 ? MAX_INTERVALS : Math.max(1, Math.ceil(maxMinor / step));
  return {
    max: step * intervals,
    ticks: Array.from({ length: intervals + 1 }, (_, index) => index * step),
  };
}

function stepFor(maxMinor: number): number {
  for (let power = 0; power <= MAX_POWER_OF_TEN; power += 1) {
    for (const factor of STEP_FACTORS) {
      const step = factor * 10 ** power * CENTS_PER_UNIT;
      if (Math.ceil(maxMinor / step) <= MAX_INTERVALS) return step;
    }
  }
  throw new RangeError(`El monto ${maxMinor} es demasiado grande para dibujarlo.`);
}

/** Cuántas unidades de largo (píxeles) mide una barra: proporcional al tope, entre 0 y `fullLength`. */
export function barLength(value: number, max: number, fullLength: number): number {
  if (value <= 0 || max <= 0) return 0;
  const length = Math.round((value / max) * fullLength);
  return Math.min(fullLength, Math.max(length, MIN_VISIBLE_LENGTH));
}
