// De la pantalla de confirmación a Mercado Pago, y de vuelta. Del navegador solo llegan qué servicio,
// la casilla, el monto que vio (para compararlo) y el token del link: el precio y el valor salen de
// `SERVICES` y de la base. Si el monto que vio ya no es el de ahora, no se cobra otro: vuelve a la
// pantalla con el precio nuevo.
//
// Ninguna función de acá tira por culpa del proveedor: la pantalla y el portal siempre contestan.

import { priceUsdMinor, type ServiceId } from "@/content/services";
import type { Db } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-url";
import type { PortalAccount } from "@/portal/accounts";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import pt from "../../messages/pt.json";
import { applyProviderPayment, isSettled } from "./apply";
import { getPaymentAvailability } from "./availability";
import { notifyPaymentOutcome } from "./emails";
import { cancelOrder, createOrder, type Order } from "./orders";
import { ORDER_TTL_MS } from "./policy";
import { pesosForUsd } from "./pricing";
import type { PaymentProviderClient, ProviderPayment } from "./provider";

export const CHECKOUT_ERROR_REASONS = ["adult", "price-changed", "unavailable", "link-invalid", "provider"] as const;
export type CheckoutErrorReason = (typeof CHECKOUT_ERROR_REASONS)[number];

export type CheckoutResult = { kind: "redirect"; url: string } | { kind: "error"; reason: CheckoutErrorReason };

export interface CheckoutInput {
  account: PortalAccount;
  item: ServiceId | "proSeason";
  adultConfirmed: boolean;
  /** Los centavos de peso que mostró la pantalla: solo para compararlos con los de ahora. */
  shownArsMinor: number;
  linkToken: string | null;
  locale: Locale;
  /** El origen del pedido. Fuera de Vercel es a donde se vuelve; en Vercel se vuelve siempre a `SITE_URL`. */
  returnOrigin: string;
}

const CATALOGS: Record<Locale, typeof es> = { es, pt, en };

/** Lo que dice la dirección de la pantalla, o `null`: un texto suelto nunca llega a ser un aviso. */
export function checkoutErrorFrom(value: string | undefined): CheckoutErrorReason | null {
  return CHECKOUT_ERROR_REASONS.find((reason) => reason === value) ?? null;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function failed(reason: CheckoutErrorReason): CheckoutResult {
  return { kind: "error", reason };
}

function returnUrl({ returnOrigin, locale }: CheckoutInput, orderId: string): string {
  const origin = process.env.VERCEL ? SITE_URL : returnOrigin;
  return `${origin}/${locale}/portal?compra=${orderId}`;
}

/** Cancela el pedido que no llegó al proveedor. Si la base tampoco contesta, queda sin pago y vence solo. */
async function cancelQuietly(db: Db, orderId: string): Promise<void> {
  try {
    await cancelOrder(db, orderId);
  } catch (error) {
    console.error("[pagos] no se pudo cancelar el pedido:", errorName(error));
  }
}

/**
 * Arma un pedido y le pide a Mercado Pago el pago. Cada llamada es un pedido nuevo: un intento que
 * falló queda cancelado y el siguiente no depende de él.
 */
export async function startCheckout(
  db: Db,
  client: PaymentProviderClient,
  input: CheckoutInput,
  now: Date = new Date(),
): Promise<CheckoutResult> {
  const { account, item, adultConfirmed, shownArsMinor, locale } = input;
  // Temporada Pro se paga solo con su link, que llega con la página de aplicaciones.
  if (item === "proSeason") return failed("link-invalid");

  const { canPay, rate } = await getPaymentAvailability(db);
  if (!canPay || rate === null) return failed("unavailable");
  if (!adultConfirmed) return failed("adult");

  const amountUsdMinor = priceUsdMinor(item);
  const amountArsMinor = pesosForUsd(amountUsdMinor, rate);
  if (shownArsMinor !== amountArsMinor) return failed("price-changed");

  const expiresAt = new Date(now.getTime() + ORDER_TTL_MS);
  const order = await createOrder(db, {
    provider: client.id,
    accountId: account.id,
    buyerName: account.displayName,
    buyerEmail: account.email,
    buyerHandle: account.handle,
    item,
    amountUsdMinor,
    arsPerUsd: rate,
    amountArsMinor,
    adultConfirmedAt: now,
    locale,
    createdAt: now,
    expiresAt,
  });

  try {
    const { redirectUrl } = await client.createCheckout({
      orderId: order.id,
      title: `Tallami Coaching: ${CATALOGS[locale].Services.items[item].name}`,
      amountArsMinor,
      payerEmail: account.email,
      expiresAt,
      returnUrl: returnUrl(input, order.id),
    });
    return { kind: "redirect", url: redirectUrl };
  } catch (error) {
    console.error("[pagos] Mercado Pago no armó el pago:", errorName(error));
    await cancelQuietly(db, order.id);
    return failed("provider");
  }
}

/**
 * El pago de este pedido según el proveedor. `paymentIdHint` sale de la dirección, que la escribe
 * cualquiera: solo dice qué mirar primero, y un pago que dice ser de otro pedido se descarta.
 */
async function paymentOfOrder(
  client: PaymentProviderClient,
  order: Order,
  paymentIdHint: string | null,
): Promise<ProviderPayment | null> {
  const hinted = paymentIdHint ? await client.fetchPayment(paymentIdHint) : null;
  if (hinted?.orderId === order.id) return hinted;
  return client.findPaymentForOrder(order.id);
}

/**
 * El respaldo por si el aviso no llegó: el comprador volvió al portal con un pedido sin confirmar, así
 * que se consulta su pago y se aplica con las mismas funciones que el aviso. `applyProviderPayment`
 * bloquea el pedido, así que hacerlo a la vez que el aviso no hace dos ventas. Un pedido ya confirmado
 * no se consulta.
 *
 * `schedule` corre los emails después de responder (la página pasa `after`); sin él, se esperan acá.
 * Nunca tira: si falla, el pedido sigue como estaba y el aviso o la próxima visita lo arreglan.
 */
export async function reconcileOrder(
  db: Db,
  client: PaymentProviderClient,
  order: Order,
  paymentIdHint: string | null,
  now: Date = new Date(),
  schedule?: (task: () => Promise<void>) => void,
): Promise<void> {
  if (isSettled(order)) return;
  try {
    const payment = await paymentOfOrder(client, order, paymentIdHint);
    if (payment === null) return;
    const outcome = await applyProviderPayment(db, client.id, payment, now);
    if (schedule) schedule(() => notifyPaymentOutcome(db, outcome));
    else await notifyPaymentOutcome(db, outcome);
  } catch (error) {
    console.error("[pagos] no se pudo consultar el pago al volver:", errorName(error));
  }
}
