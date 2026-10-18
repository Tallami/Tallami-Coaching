// Del `FormData` que manda el navegador al objeto que valida `saleInputSchema`.
// Los nombres de campo son los del formulario (`customerName`, `paidOn`, …).

import { formText } from "@/admin/text";

/** Los campos de la venta tal como llegaron, sin validar. */
export function readSaleForm(formData: FormData): Record<string, unknown> {
  const mode = formText(formData, "customerMode");
  const customer =
    mode === "existing"
      ? { mode, id: formText(formData, "customerId") }
      : {
          mode,
          name: formText(formData, "customerName"),
          discord: formText(formData, "customerDiscord"),
          country: formText(formData, "customerCountry"),
        };

  return {
    customer,
    item: formText(formData, "item"),
    description: formText(formData, "description"),
    currency: formText(formData, "currency"),
    amount: formText(formData, "amount"),
    paymentMethod: formText(formData, "paymentMethod"),
    status: formText(formData, "status"),
    paidOn: formText(formData, "paidOn"),
    dueAt: formText(formData, "dueAt"),
    deliveredAt: formText(formData, "deliveredAt"),
    rateMode: formText(formData, "rateMode"),
    arsPerUnit: formText(formData, "arsPerUnit"),
    arsPerUsd: formText(formData, "arsPerUsd"),
    notes: formText(formData, "notes"),
  };
}
