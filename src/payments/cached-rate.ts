// Los pesos por dólar para las páginas públicas. Con `use cache` las páginas
// siguen prerenderizadas; guardar el valor en el panel invalida la etiqueta.

import { cacheLife, cacheTag } from "next/cache";
import { getDb } from "@/db/client";
import { PESOS_PER_DOLLAR_TAG, getPesosPerDollar } from "@/payments/pricing";

/**
 * El valor guardado ("1500.0000") o `null` si no hay. Durante el build, sin
 * `DATABASE_URL`, no abre la base (abrir PGlite ahí chocaría con un servidor
 * de desarrollo en la misma carpeta). Si la base falla, devuelve `null` con
 * vida de minutos para no guardar el fallo para siempre (como `getTweetCards`).
 */
export async function getPublicPesosPerDollar(): Promise<string | null> {
  "use cache";
  cacheTag(PESOS_PER_DOLLAR_TAG);
  cacheLife("max");

  if (process.env.NEXT_PHASE === "phase-production-build" && !process.env.DATABASE_URL) {
    return null;
  }
  try {
    return (await getPesosPerDollar(await getDb()))?.rate ?? null;
  } catch {
    cacheLife("minutes");
    return null;
  }
}
