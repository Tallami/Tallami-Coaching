// ¿Se puede pagar desde la web? Hacen falta las credenciales de Mercado Pago, el valor de pesos por
// dólar y un remitente de email de un dominio verificado. Los botones de la portada no dependen de
// esto: llevan siempre a la pantalla de confirmación, que es la que lo mira.
//
// El valor se lee directo de la base, nunca del caché de la portada: lo que manda es esta lectura.

import type { Db } from "@/db/client";
import { getPublicEmailSetup } from "@/email/send";
import { isMercadoPagoConfigured } from "./mercadopago";
import { getPesosPerDollar } from "./pricing";

export type PaymentRequirement = "credentials" | "rate" | "sender";

export interface PaymentAvailability {
  canPay: boolean;
  /** Los pesos por dólar guardados ("1500.0000"), o `null`. */
  rate: string | null;
  /** Lo que falta para poder cobrar. Son nombres, nunca valores. */
  missing: PaymentRequirement[];
}

/** El token cobra y el secreto valida los avisos: sin avisos, un pago de quien no vuelve al sitio nunca llegaría al panel. */
function hasCredentials(): boolean {
  return isMercadoPagoConfigured() && Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim());
}

export async function getPaymentAvailability(db: Db): Promise<PaymentAvailability> {
  const rate = (await getPesosPerDollar(db))?.rate ?? null;
  const missing: PaymentRequirement[] = [
    ...(hasCredentials() ? [] : (["credentials"] as const)),
    ...(rate ? [] : (["rate"] as const)),
    ...(getPublicEmailSetup().kind === "ready" ? [] : (["sender"] as const)),
  ];
  return { canPay: missing.length === 0, rate, missing };
}
