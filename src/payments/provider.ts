// La interfaz que cumple cada proveedor de pagos. Hoy hay uno (Mercado Pago); el
// resto del código habla con esto y no con la API de ninguno.

/** El estado de un pago, ya normalizado: no depende del proveedor. */
export type PaymentStatus =
  | "approved"
  | "pending"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "partially_refunded"
  | "in_mediation"
  | "charged_back";

/** Un pago como lo informa el proveedor al consultarlo. */
export interface ProviderPayment {
  providerPaymentId: string;
  /** El pedido al que dice pertenecer (`external_reference`), o `null`. */
  orderId: string | null;
  status: PaymentStatus;
  /** En unidades menores de `currency` (centavos). */
  amountMinor: number;
  currency: string;
  approvedAt: Date | null;
}

export interface CheckoutRequest {
  orderId: string;
  title: string;
  amountArsMinor: number;
  payerEmail: string | null;
  expiresAt: Date;
  returnUrl: string;
}

export interface PaymentProviderClient {
  readonly id: "mercadopago";
  createCheckout(request: CheckoutRequest): Promise<{ redirectUrl: string }>;
  /** El pago `paymentId`, o `null` si el proveedor no lo conoce. Tira ante una falla. */
  fetchPayment(paymentId: string): Promise<ProviderPayment | null>;
  /** El pago más reciente del pedido, o `null` si todavía no hay. Tira ante una falla. */
  findPaymentForOrder(orderId: string): Promise<ProviderPayment | null>;
}
