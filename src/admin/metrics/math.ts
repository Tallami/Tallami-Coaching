// Cuentas de las métricas: todo es aritmética entera (centavos), con `BigInt`
// donde un `number` podría perder precisión, y los porcentajes salen con un
// decimal, redondeados half-up (lejos del cero). Nada acá usa decimales binarios
// para dinero.

// El tsconfig apunta a ES2017, que no admite literales BigInt (`100n`).
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const PERMILLE = BigInt(1000);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Décimas de punto porcentual en un 100 %: los porcentajes tienen un decimal. */
const TENTHS_IN_WHOLE = 1000;

/**
 * Suma de montos en unidades menores. Tira `RangeError` si algún monto no es un
 * entero o si el total no cabe en un entero seguro de JavaScript: es preferible
 * que el panel falle a que muestre un total redondeado en silencio.
 */
export function sumMinor(values: readonly number[]): number {
  let total = ZERO;
  for (const value of values) total += BigInt(value);
  if (total > MAX_SAFE || total < -MAX_SAFE) {
    throw new RangeError("La suma es demasiado grande para mostrarla sin perder centavos.");
  }
  return Number(total);
}

/** Cociente entero redondeado half-up (lejos del cero); el denominador es positivo. */
function divideRoundBig(numerator: bigint, denominator: bigint): bigint {
  const magnitude = numerator < ZERO ? -numerator : numerator;
  const quotient = (TWO * magnitude + denominator) / (TWO * denominator);
  return numerator < ZERO ? -quotient : quotient;
}

/**
 * `numerator / denominator` redondeado half-up al entero (lejos del cero).
 * Tira `RangeError` si el denominador no es positivo.
 */
export function divideRound(numerator: number, denominator: number): number {
  if (!(denominator > 0)) {
    throw new RangeError(`El denominador tiene que ser mayor a cero, pero llegó ${denominator}.`);
  }
  return Number(divideRoundBig(BigInt(numerator), BigInt(denominator)));
}

/**
 * `part` sobre `whole` como porcentaje con un decimal, half-up (lejos del
 * cero): 1 de 3 → 33.3, 2 de 3 → 66.7, -1 de 2000 → -0.1. Puede ser negativo
 * (variaciones) o pasar de 100. Tira `RangeError` si `whole` no es positivo.
 */
export function percent(part: number, whole: number): number {
  if (!(whole > 0)) {
    throw new RangeError(`El total tiene que ser mayor a cero, pero llegó ${whole}.`);
  }
  const tenths = divideRoundBig(BigInt(part) * PERMILLE, BigInt(whole));
  return Number(tenths) / 10;
}

/**
 * Reparte el 100 % entre `values` (montos no negativos) con un decimal, de modo
 * que los porcentajes sumen exactamente 100,0: cada uno recibe su parte entera
 * en décimas y las décimas que sobran van a quienes tienen el mayor resto (a
 * igual resto, al que viene primero). Si el total es cero, todos reciben 0.
 */
export function splitShares(values: readonly number[]): number[] {
  const amounts = values.map((value) => BigInt(value));
  const total = amounts.reduce((sum, amount) => sum + amount, ZERO);
  if (total <= ZERO) return values.map(() => 0);

  const parts = amounts.map((amount) => ({
    tenths: (amount * PERMILLE) / total,
    remainder: (amount * PERMILLE) % total,
  }));
  const assigned = parts.reduce((sum, part) => sum + part.tenths, ZERO);
  let leftover = Number(BigInt(TENTHS_IN_WHOLE) - assigned);

  const byRemainder = parts
    .map((part, index) => ({ index, remainder: part.remainder }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );
  const extra = new Set<number>();
  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    extra.add(index);
    leftover -= 1;
  }
  return parts.map((part, index) => Number(part.tenths + (extra.has(index) ? ONE : ZERO)) / 10);
}
