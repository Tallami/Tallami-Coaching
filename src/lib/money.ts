// Dinero del panel de admin. Los montos son siempre enteros en unidades menores
// (centavos): nada de `number` con decimales para plata. Los tipos de cambio
// son texto decimal con 4 decimales ("1517.0000", como la columna
// `numeric(14,4)` de la base) y toda la aritmética va con `BigInt`, con
// redondeo half-up al centavo.

import type { Currency } from "@/admin/catalog";

/** Decimales de un tipo de cambio guardado. */
const RATE_DECIMALS = 4;
// El tsconfig apunta a ES2017, que no admite literales BigInt (`100n`): las
// constantes se arman con `BigInt()`.
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const FIFTY = BigInt(50);
const CENTS_PER_UNIT = BigInt(100);
const RATE_SCALE = BigInt(10_000); // 10^RATE_DECIMALS
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Lo que se escribe antes del número, por moneda (es-AR). */
const CURRENCY_PREFIX: Record<Currency, string> = {
  USD: "USD",
  ARS: "$",
  BRL: "R$",
  USDT: "USDT",
};

/** El texto que escribió el usuario no es un monto válido. */
export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmountError";
  }
}

/** El texto que escribió el usuario no es un tipo de cambio válido. */
export class InvalidRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRateError";
  }
}

// --- Montos escritos por una persona ---------------------------------------

/** "1234", "1234,56", "1234.56": solo dígitos y, a lo sumo, un separador. */
const PLAIN_AMOUNT = /^(\d+)(?:[.,](\d{1,2}))?$/;
/** "1.234,56", "1.234.567": miles con punto y centavos con coma. */
const GROUPED_AMOUNT = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/;
/**
 * "1,234" o "1.234": tres dígitos tras el separador pueden ser miles o
 * decimales. Un error de 1000 veces en plata no se adivina: se pide aclarar.
 */
const AMBIGUOUS_AMOUNT = /^\d{1,3}[.,]\d{3}$/;

/**
 * Pasa un monto escrito ("1.234,56", "1234,56", "1234.56", "1234") a unidades
 * menores (123456). Tira `InvalidAmountError`, con el mensaje listo para
 * mostrar, si no es un monto positivo con hasta 2 decimales.
 */
export function parseAmountToMinor(input: string): number {
  const text = input.trim();
  if (text === "") {
    throw new InvalidAmountError("Ingresá un monto.");
  }
  if (AMBIGUOUS_AMOUNT.test(text)) {
    throw new InvalidAmountError(
      `El monto "${text}" es ambiguo: escribilo sin separador de miles (1234) o con hasta 2 decimales (1234,50).`,
    );
  }
  const match = PLAIN_AMOUNT.exec(text) ?? GROUPED_AMOUNT.exec(text);
  if (!match) {
    throw new InvalidAmountError(
      "El monto no es válido: usá solo números, con coma o punto para los centavos (hasta 2 decimales), por ejemplo 1.234,56.",
    );
  }
  const whole = match[1].replaceAll(".", "");
  const cents = (match[2] ?? "").padEnd(2, "0");
  const minor = BigInt(whole) * CENTS_PER_UNIT + BigInt(cents);
  if (minor <= ZERO) {
    throw new InvalidAmountError("El monto tiene que ser mayor a cero.");
  }
  if (minor > MAX_SAFE) {
    throw new InvalidAmountError("El monto es demasiado grande.");
  }
  return Number(minor);
}

// --- Mostrar montos --------------------------------------------------------

/** Agrupa los miles con punto: 1234567 → "1.234.567". */
function groupThousands(units: bigint): string {
  return units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function assertWholeMinor(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `El monto tiene que ser un entero en unidades menores (centavos), pero llegó ${value}.`,
    );
  }
}

/**
 * Da formato es-AR a un monto en unidades menores: "USD 1.234,56",
 * "$ 1.234,56", "R$ 1.234,56", "USDT 1.234,56". Con `decimals: 0` redondea
 * half-up a la unidad entera. Los miles se agrupan a mano (no con `Intl`) para
 * que 1.234,56 salga igual en todos los motores, con espacio normal.
 */
export function formatMoney(
  minor: number,
  currency: Currency,
  opts: { decimals?: 0 | 2 } = {},
): string {
  assertWholeMinor(minor);
  const decimals = opts.decimals ?? 2;
  const abs = BigInt(Math.abs(minor));
  const wholeUnitsHalfUp = (abs + FIFTY) / CENTS_PER_UNIT;
  const shown =
    decimals === 0
      ? groupThousands(wholeUnitsHalfUp)
      : `${groupThousands(abs / CENTS_PER_UNIT)},${(abs % CENTS_PER_UNIT).toString().padStart(2, "0")}`;
  const isZero = decimals === 0 ? wholeUnitsHalfUp === ZERO : abs === ZERO;
  const sign = minor < 0 && !isZero ? "-" : "";
  return `${sign}${CURRENCY_PREFIX[currency]} ${shown}`;
}

/**
 * Un monto en unidades menores como número plano con coma decimal y sin
 * separador de miles ("1234,56"): lo que se escribe en un campo para
 * editarlo o en un CSV que Excel en español tiene que reconocer como número.
 * `parseAmountToMinor` lo lee de vuelta.
 */
export function formatPlainAmount(minor: number): string {
  assertWholeMinor(minor);
  const abs = BigInt(Math.abs(minor));
  const body = `${abs / CENTS_PER_UNIT},${(abs % CENTS_PER_UNIT).toString().padStart(2, "0")}`;
  return minor < 0 ? `-${body}` : body;
}

/**
 * Un tipo de cambio guardado ("1400.5000") como se lee en es-AR: "1.400,50".
 * Muestra al menos 2 decimales y hasta 4 si hacen falta ("301,5651").
 */
export function formatRate(rate: string): string {
  const [whole = "0", fraction = ""] = rate.split(".");
  const decimals = fraction.replace(/0+$/, "").padEnd(2, "0");
  return `${groupThousands(BigInt(whole))},${decimals}`;
}

// --- Tipos de cambio y conversiones ----------------------------------------

const RATE_TEXT = /^(\d+)(?:\.(\d{1,4}))?$/;
const DECIMAL_TEXT = /^(\d+)(?:\.(\d+))?$/;

function formatScaledRate(scaled: bigint): string {
  const fraction = (scaled % RATE_SCALE).toString().padStart(RATE_DECIMALS, "0");
  return `${scaled / RATE_SCALE}.${fraction}`;
}

/**
 * Lleva un decimal cualquiera ("1517", "301.565148") a tipo de cambio con 4
 * decimales ("1517.0000", "301.5651"), redondeando half-up sobre el texto, sin
 * pasar por `number` (con decimales binarios, 1.00105 se redondearía mal).
 * Tira `RangeError` si no es un decimal positivo.
 */
export function normalizeRate(decimal: string): string {
  const match = DECIMAL_TEXT.exec(decimal);
  if (!match) {
    throw new RangeError(
      `Tipo de cambio inválido: "${decimal}" (se espera un decimal con punto, como 1517.5).`,
    );
  }
  const [, whole, fraction = ""] = match;
  let scaled =
    BigInt(whole) * RATE_SCALE +
    BigInt(fraction.slice(0, RATE_DECIMALS).padEnd(RATE_DECIMALS, "0"));
  if (fraction.length > RATE_DECIMALS && Number(fraction[RATE_DECIMALS]) >= 5) {
    scaled += ONE;
  }
  if (scaled <= ZERO) {
    throw new RangeError(`Tipo de cambio inválido: "${decimal}" tiene que ser mayor a cero.`);
  }
  return formatScaledRate(scaled);
}

/** Tope de un tipo de cambio escrito: 100.000 pesos por unidad. Mucho más es un error de tipeo. */
const MAX_RATE_SCALED = BigInt(100_000) * RATE_SCALE;
/** "1500", "1500,5", "1500.5": solo dígitos y, a lo sumo, un separador con hasta 4 decimales. */
const PLAIN_RATE = /^(\d+)(?:[.,](\d{1,4}))?$/;
/** "1.500,25": miles con punto y decimales con coma. */
const GROUPED_RATE = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,4}))?$/;

/**
 * Pasa un tipo de cambio escrito ("1.512,50", "1512,5", "1512.5", "1512") a
 * texto con 4 decimales ("1512.5000"), listo para guardar. Igual que con los
 * montos, "1.500" o "1,500" es ambiguo y se pide aclarar. Tira
 * `InvalidRateError`, con el mensaje listo para mostrar, si no es un número
 * mayor a cero y de hasta 100.000.
 */
export function parseRateInput(input: string): string {
  const text = input.trim();
  if (text === "") {
    throw new InvalidRateError("Ingresá el tipo de cambio.");
  }
  if (AMBIGUOUS_AMOUNT.test(text)) {
    throw new InvalidRateError(
      `El tipo de cambio "${text}" es ambiguo: escribilo sin separador de miles (1500) o con coma para los decimales (1500,50).`,
    );
  }
  const match = PLAIN_RATE.exec(text) ?? GROUPED_RATE.exec(text);
  if (!match) {
    throw new InvalidRateError(
      "El tipo de cambio no es válido: usá solo números, con coma o punto para los decimales (hasta 4), por ejemplo 1.512,50.",
    );
  }
  const scaled =
    BigInt(match[1].replaceAll(".", "")) * RATE_SCALE +
    BigInt((match[2] ?? "").padEnd(RATE_DECIMALS, "0"));
  if (scaled <= ZERO) {
    throw new InvalidRateError("El tipo de cambio tiene que ser mayor a cero.");
  }
  if (scaled > MAX_RATE_SCALED) {
    throw new InvalidRateError("El tipo de cambio es demasiado grande.");
  }
  return formatScaledRate(scaled);
}

/** Tipo de cambio guardado → entero escalado por 10^4. Estricto: hasta 4 decimales. */
function parseRate(rate: string): bigint {
  const match = RATE_TEXT.exec(rate);
  if (!match) {
    throw new RangeError(
      `Tipo de cambio inválido: "${rate}" (se espera un decimal con hasta 4 decimales, como 1517.0000).`,
    );
  }
  const scaled =
    BigInt(match[1]) * RATE_SCALE + BigInt((match[2] ?? "").padEnd(RATE_DECIMALS, "0"));
  if (scaled <= ZERO) {
    throw new RangeError(`Tipo de cambio inválido: "${rate}" tiene que ser mayor a cero.`);
  }
  return scaled;
}

/** Cociente redondeado half-up; solo para numerador y denominador positivos. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (TWO * numerator + denominator) / (TWO * denominator);
}

/**
 * Aplica `convert` al valor absoluto del monto y devuelve el resultado con el
 * mismo signo: -x se convierte igual que x pero negativo.
 */
function convertSymmetric(amountMinor: number, convert: (abs: bigint) => bigint): number {
  assertWholeMinor(amountMinor);
  const converted = convert(BigInt(Math.abs(amountMinor)));
  const result = Number(amountMinor < 0 ? -converted : converted);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("El monto convertido es demasiado grande.");
  }
  return result;
}

/**
 * Pasa un monto en unidades menores de otra moneda a centavos de peso, con el
 * tipo de cambio en pesos por unidad ("1517.0000"). Half-up.
 */
export function convertToArsMinor(amountMinor: number, arsPerUnit: string): number {
  const rate = parseRate(arsPerUnit);
  return convertSymmetric(amountMinor, (abs) => divideHalfUp(abs * rate, RATE_SCALE));
}

/**
 * Pasa centavos de peso a centavos de dólar, con los pesos por dólar
 * ("1517.0000"). Half-up.
 */
export function arsToUsdMinor(arsMinor: number, arsPerUsd: string): number {
  const rate = parseRate(arsPerUsd);
  return convertSymmetric(arsMinor, (abs) => divideHalfUp(abs * RATE_SCALE, rate));
}
