// Del `FormData` que manda el navegador al objeto que valida `saleInputSchema`.
// Los nombres de campo son los del formulario (`customerName`, `paidOn`, …).

function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  // Un archivo o un campo ausente no es texto: la validación lo rechaza.
  return typeof value === "string" ? value : undefined;
}

/** Los campos de la venta tal como llegaron, sin validar. */
export function readSaleForm(formData: FormData): Record<string, unknown> {
  const mode = text(formData, "customerMode");
  const customer =
    mode === "existing"
      ? { mode, id: text(formData, "customerId") }
      : {
          mode,
          name: text(formData, "customerName"),
          discord: text(formData, "customerDiscord"),
          country: text(formData, "customerCountry"),
        };

  return {
    customer,
    item: text(formData, "item"),
    description: text(formData, "description"),
    currency: text(formData, "currency"),
    amount: text(formData, "amount"),
    paymentMethod: text(formData, "paymentMethod"),
    status: text(formData, "status"),
    paidOn: text(formData, "paidOn"),
    dueAt: text(formData, "dueAt"),
    deliveredAt: text(formData, "deliveredAt"),
    rateMode: text(formData, "rateMode"),
    arsPerUnit: text(formData, "arsPerUnit"),
    arsPerUsd: text(formData, "arsPerUsd"),
    notes: text(formData, "notes"),
  };
}
