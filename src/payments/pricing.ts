// Pesos por dólar: el valor que carga Tallami en el panel y con el que la web
// muestra, debajo de cada precio en dólares, el precio en pesos. Vive en la
// tabla `settings` como una fila más; este módulo es el único que interpreta
// lo guardado (si la forma es rara, se trata como "sin valor").

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { settings } from "@/db/schema";
import { InvalidRateError, parseRateInput } from "@/lib/money";

/** Clave de la fila de `settings` con los pesos por dólar. */
export const PESOS_PER_DOLLAR_SETTING_KEY = "pesosPerDollar";
/** Etiqueta del caché de la web: la acción de guardar la invalida. */
export const PESOS_PER_DOLLAR_TAG = "pesos-per-dollar";

const RATE_DECIMALS = 4;
const CENTS_PER_PESO = BigInt(100);
const RATE_SCALE = BigInt(10) ** BigInt(RATE_DECIMALS);
const STORED_RATE = /^(\d+)\.(\d{4})$/;

/**
 * Lo guardado es `{ rate }`, con el valor como texto de 4 decimales
 * ("1500.0000") y mayor a cero. Va en un objeto y no como texto suelto: Drizzle
 * le hace `JSON.parse` a lo que lee de un `jsonb` y un texto como "1500.5000"
 * volvería como número.
 */
const storedRateSchema = z.object({
  rate: z
    .string()
    .regex(STORED_RATE)
    .refine((rate) => Number(rate) > 0),
});

export interface PesosPerDollarRecord {
  /** "1500.0000". */
  rate: string;
  updatedAt: Date;
}

export type SavePesosPerDollarResult =
  | { saved: true; rate: string }
  | { saved: false; error: string };

/** Los pesos por dólar guardados, o `null` si no hay fila o lo guardado no sirve. */
export async function getPesosPerDollar(db: Db): Promise<PesosPerDollarRecord | null> {
  const [row] = await db
    .select({ value: settings.value, updatedAt: settings.updatedAt })
    .from(settings)
    .where(eq(settings.key, PESOS_PER_DOLLAR_SETTING_KEY))
    .limit(1);
  if (!row) return null;
  const parsed = storedRateSchema.safeParse(row.value);
  return parsed.success ? { rate: parsed.data.rate, updatedAt: row.updatedAt } : null;
}

/**
 * Valida lo escrito ("1.500,50", "1500") y, si sirve, reemplaza lo guardado y
 * mueve la fecha. Ante algo inválido no escribe y devuelve el mensaje listo
 * para mostrar.
 */
export async function savePesosPerDollar(db: Db, input: string): Promise<SavePesosPerDollarResult> {
  let rate: string;
  try {
    rate = parseRateInput(input);
  } catch (error) {
    if (error instanceof InvalidRateError) return { saved: false, error: error.message };
    throw error;
  }
  await db
    .insert(settings)
    .values({ key: PESOS_PER_DOLLAR_SETTING_KEY, value: { rate } })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: { rate }, updatedAt: new Date() },
    });
  return { saved: true, rate };
}

/**
 * Dólares (en centavos) × pesos por dólar, redondeado al peso entero (half-up,
 * sin redondeos "lindos"). Devuelve centavos de peso, siempre múltiplo de 100.
 * Se hace todo en enteros: el redondeo sale del valor exacto, no de uno ya redondeado.
 */
export function pesosForUsd(usdMinor: number, rate: string): number {
  const match = STORED_RATE.exec(rate);
  if (!match || !Number.isSafeInteger(usdMinor) || usdMinor < 0) {
    throw new RangeError(`Entrada inválida para pesosForUsd: ${usdMinor} × "${rate}".`);
  }
  const scaledRate = BigInt(match[1]) * RATE_SCALE + BigInt(match[2]);
  const denominator = CENTS_PER_PESO * RATE_SCALE;
  const pesos = (BigInt(2) * BigInt(usdMinor) * scaledRate + denominator) / (BigInt(2) * denominator);
  const result = Number(pesos * CENTS_PER_PESO);
  if (!Number.isSafeInteger(result)) throw new RangeError("El precio en pesos es demasiado grande.");
  return result;
}
