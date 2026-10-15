// Lo que dice el medidor del monotributo con palabras y con qué color. El
// porcentaje usado va redondeado a un decimal (99,95 % se ve como 100 %), así
// que no sirve para decidir si el tope se alcanzó o se pasó: eso lo dice lo que
// queda del tope, en centavos y sin redondear. El porcentaje solo decide desde
// cuándo se avisa que se está cerca.

import type { MeterTone } from "@/admin/charts/meter";
import { formatMoney } from "@/lib/money";

/** Desde este porcentaje usado el medidor avisa que se está cerca del tope. */
const WARN_FROM_PCT = 80;
const FULL_PCT = 100;

export interface MonotributoVerdict {
  tone: MeterTone;
  text: string;
}

/**
 * - Lo que queda es negativo: se pasó el tope, por el monto real.
 * - Queda justo cero: se llegó al tope.
 * - Queda algo pero el porcentaje ya se redondea a 100: a punto de llegar.
 * - Desde el 80 %: cerca. Antes: lo que queda, sin aviso.
 *
 * `usedPct` es el porcentaje usado con un decimal y `remainingArsMinor` lo que
 * queda del tope en centavos de peso (negativo si ya se pasó).
 */
export function monotributoVerdict(usedPct: number, remainingArsMinor: number): MonotributoVerdict {
  if (remainingArsMinor < 0) {
    return { tone: "danger", text: `Superaste el tope por ${formatMoney(-remainingArsMinor, "ARS")}` };
  }
  if (remainingArsMinor === 0) return { tone: "danger", text: "Llegaste al tope" };

  const remaining = formatMoney(remainingArsMinor, "ARS");
  if (usedPct >= FULL_PCT) {
    return { tone: "warn", text: `Estás a punto de llegar al tope: te quedan ${remaining}` };
  }
  if (usedPct >= WARN_FROM_PCT) return { tone: "warn", text: `Estás cerca del tope: te quedan ${remaining}` };
  return { tone: "accent", text: `Te quedan ${remaining}` };
}
