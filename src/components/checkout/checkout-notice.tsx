import { getTranslations } from "next-intl/server";
import type { CheckoutErrorReason } from "@/payments/checkout";

/** Por qué no salió a pagar. Se anuncia con urgencia, y el texto sale del catálogo, nunca de la dirección. */
export async function CheckoutNotice({ reason }: { reason: CheckoutErrorReason }) {
  const t = await getTranslations("Checkout.errors");

  return (
    <p role="alert" className="mb-8 border-l-4 border-danger bg-danger-tint px-4 py-3 font-semibold text-danger-ink">
      {t(reason)}
    </p>
  );
}
