// Del pago que informa el proveedor a la venta del panel. Es la única función que hace ese
// paso: la llaman el aviso firmado y el respaldo al volver al portal, y el pago que recibe
// salió de consultar la API, nunca del navegador ni del cuerpo de un aviso.
//
// Todo pasa en una transacción que empieza bloqueando el pedido: dos avisos a la vez se
// turnan, y el segundo ve lo que dejó el primero. Por eso un mismo pago hace una sola venta.
// Si algo falla no queda nada hecho y el error sube: el aviso contesta 500 y el proveedor
// reintenta.
//
// Los estados no van para atrás: una lectura atrasada (`pending` después de `approved`,
// `approved` después de `refunded`) no cambia nada.

import { and, eq, inArray, ne } from "drizzle-orm";
import { INCOME_STATUSES, PAYMENT_LABELS } from "@/admin/catalog";
import { formatDay, todayInArgentina } from "@/admin/dates";
import type { Db } from "@/db/client";
import { customers, orders, portalAccounts, sales } from "@/db/schema";
import { isUuid } from "@/db/uuid";
import { linkAccountToCustomer } from "@/portal/accounts";
import { markProPaymentLinkPaid } from "@/pro/payment-links";
import type { OrderStatus } from "./policy";
import type { PaymentStatus, ProviderPayment } from "./provider";

export type ApplyOutcome =
  | { kind: "unknown-order" }
  /** El pago que llegó y no le corresponde al pedido: su id, su monto y su moneda, no los del pedido. */
  | { kind: "mismatch"; orderId: string; providerPaymentId: string; amountMinor: number; currency: string }
  | { kind: "sale-created"; orderId: string; saleId: string; status: "paid" | "refunded"; linkAlreadyPaid?: true }
  | {
      kind: "sale-updated";
      orderId: string;
      saleId: string;
      change: "refunded" | "partial-refund" | "mediation" | "charged-back";
      linkAlreadyPaid?: true;
    }
  | { kind: "order-updated"; orderId: string; status: string }
  | { kind: "no-change"; orderId: string };

type Provider = "mercadopago";
type Order = typeof orders.$inferSelect;

/** Lo que se está aplicando, ya dentro de la transacción y con el pedido bloqueado. */
interface Application {
  tx: Db;
  provider: Provider;
  order: Order;
  payment: ProviderPayment;
  now: Date;
}

/** Los pedidos se cobran en pesos: el monto del pedido es `amountArsMinor`. */
const ORDER_CURRENCY = "ARS";
/** Lo que un cobro en pesos guarda como "pesos por unidad de la moneda cobrada". */
const ARS_PER_ARS = "1.0000";
/** País de quien paga en pesos con una cuenta argentina; Tallami lo puede corregir. */
const BUYER_COUNTRY = "AR";

/** Estados de un pedido cuya aprobación ya se procesó: tienen venta, y otro pago que cobre no les cabe. */
const SETTLED_STATUSES: readonly string[] = ["approved", "refunded", "charged_back"] satisfies OrderStatus[];
/** Estados de los que un pedido ya no vuelve. */
const CLOSED_STATUSES: readonly string[] = ["refunded", "charged_back"] satisfies OrderStatus[];

/** ¿El pago en este estado le sacó plata a alguien? Un `Record` para que un estado nuevo obligue a decidirlo. */
const TOOK_MONEY: Record<PaymentStatus, boolean> = {
  approved: true,
  partially_refunded: true,
  refunded: true,
  in_mediation: true,
  charged_back: true,
  pending: false,
  rejected: false,
  cancelled: false,
};

/** ¿La aprobación de este pedido ya se procesó? Tiene venta: otra consulta no le puede agregar nada. */
export function isSettled(order: Pick<Order, "status">): boolean {
  return SETTLED_STATUSES.includes(order.status);
}

function isClosed(order: Order): boolean {
  return CLOSED_STATUSES.includes(order.status);
}

function noChange(order: Order): ApplyOutcome {
  return { kind: "no-change", orderId: order.id };
}

/**
 * Guarda el estado del pedido. Devuelve `true` si este pago crea una venta con un link de Temporada Pro
 * que ya había pagado otro pedido: el link no bloquea un segundo pedido, así que Tallami se tiene que
 * enterar.
 */
async function saveOrder(
  { tx, order, payment, now }: Application,
  status: OrderStatus,
  saleId: string | null = order.saleId,
): Promise<boolean> {
  // Un pago que cobró gasta el link de Temporada Pro con el que se armó el pedido, solo ese, aunque se
  // haya devuelto antes de que llegara su aprobación: un link pagado no se vuelve a usar.
  let linkAlreadyPaid = false;
  if (TOOK_MONEY[payment.status] && order.proPaymentLinkId !== null) {
    const marked = await markProPaymentLinkPaid(tx, order.proPaymentLinkId, now);
    linkAlreadyPaid = !marked && saleId !== order.saleId;
  }
  await tx
    .update(orders)
    .set({ status, saleId, providerPaymentId: payment.providerPaymentId })
    .where(eq(orders.id, order.id));
  return linkAlreadyPaid;
}

/** Le suma al resultado la marca de un link pagado dos veces. */
function flagLink<T extends ApplyOutcome>(outcome: T, linkAlreadyPaid: boolean): T {
  return linkAlreadyPaid ? { ...outcome, linkAlreadyPaid: true } : outcome;
}

async function insertCustomer(
  tx: Db,
  person: { name: string; email: string | null; discord: string | null },
): Promise<string> {
  const [customer] = await tx
    .insert(customers)
    .values({ ...person, country: BUYER_COUNTRY })
    .returning({ id: customers.id });
  return customer.id;
}

/**
 * El alumno de la venta. Si la cuenta ya tiene, ese. Si no, se crea y se vincula, con la
 * cuenta bloqueada para que dos pedidos de la misma cuenta a la vez hagan un solo alumno: el
 * segundo espera y lee el alumno que creó el primero. Es `no key update` y no `update` por lo
 * que explica `createInvite`: armar un pedido o una sesión toma `key share` sobre la cuenta, y
 * leer la cuenta no tiene por qué esperarlos. Pero vincularla sí choca: `customer_id` tiene un
 * índice único, así que el `update` de `linkAccountToCustomer` toma la fuerza de `for update`, que
 * espera a cualquier `key share`. Con `redeemInvite` a la vez sobre la misma cuenta (su invitación
 * toma `key share` sobre la cuenta y después la quiere vincular) puede haber un interbloqueo: es raro
 * y no rompe nada, Postgres aborta a uno de los dos. Si es este cobro, todo se deshace, el aviso
 * contesta 500 y Mercado Pago reintenta; si es el canje, el alumno lo vuelve a intentar.
 *
 * No se busca coincidencia por email: abriría el historial de un alumno a quien tenga ese email en
 * otra cuenta.
 */
async function customerForOrder(tx: Db, order: Order): Promise<string> {
  const orderCopy = { name: order.buyerName, email: order.buyerEmail, discord: order.buyerHandle };
  if (order.accountId === null) return insertCustomer(tx, orderCopy);

  const [account] = await tx
    .select({
      customerId: portalAccounts.customerId,
      displayName: portalAccounts.displayName,
      email: portalAccounts.email,
      handle: portalAccounts.providerHandle,
    })
    .from(portalAccounts)
    .where(eq(portalAccounts.id, order.accountId))
    .for("no key update");
  if (!account) return insertCustomer(tx, orderCopy);
  if (account.customerId !== null) return account.customerId;

  const customerId = await insertCustomer(tx, {
    name: account.displayName,
    email: account.email ?? order.buyerEmail,
    discord: account.handle,
  });
  const linked = await linkAccountToCustomer(tx, order.accountId, customerId);
  if (linked !== "linked") throw new Error(`No se pudo vincular la cuenta del pedido: ${linked}.`);
  return customerId;
}

async function createSale(
  { tx, provider, order, payment, now }: Application,
  status: "paid" | "refunded",
  notes: string | null = null,
): Promise<string> {
  const customerId = await customerForOrder(tx, order);
  const [sale] = await tx
    .insert(sales)
    .values({
      customerId,
      item: order.item,
      currency: ORDER_CURRENCY,
      amountMinor: payment.amountMinor,
      arsPerUnit: ARS_PER_ARS,
      arsPerUsd: order.arsPerUsd,
      rateSource: "manual",
      rateQuotedOn: todayInArgentina(order.createdAt),
      amountArsMinor: payment.amountMinor,
      amountUsdMinor: order.amountUsdMinor,
      paymentMethod: provider,
      status,
      // `date_approved` puede faltar: la venta tiene que existir igual, y esa plata ya entró.
      paidOn: todayInArgentina(payment.approvedAt ?? now),
      dueAt: null,
      invoiceStatus: "pending",
      source: provider,
      notes,
    })
    .returning({ id: sales.id });
  return sale.id;
}

/** La marca de un reembolso parcial en las notas de la venta: encontrarla evita repetir la línea. */
function partialRefundMark({ provider, payment }: Application): string {
  return `Reembolso parcial en ${PAYMENT_LABELS[provider]} (pago ${payment.providerPaymentId})`;
}

function partialRefundLine(application: Application): string {
  return `${partialRefundMark(application)}, avisado el ${formatDay(todayInArgentina(application.now))}.`;
}

/** Suma la línea a las notas de la venta. `false` si ya estaba: el mismo aviso otra vez. */
async function notePartialRefund(application: Application, saleId: string): Promise<boolean> {
  const { tx } = application;
  const [sale] = await tx.select({ notes: sales.notes }).from(sales).where(eq(sales.id, saleId)).for("no key update");
  if (!sale || sale.notes?.includes(partialRefundMark(application))) return false;
  const line = partialRefundLine(application);
  await tx
    .update(sales)
    .set({ notes: sale.notes ? `${sale.notes}\n${line}` : line })
    .where(eq(sales.id, saleId));
  return true;
}

/** Pasa la venta a `refunded` si todavía contaba como ingreso. `false` si Tallami ya la había marcado. */
async function refundSale(tx: Db, saleId: string): Promise<boolean> {
  const refunded = await tx
    .update(sales)
    .set({ status: "refunded" })
    .where(and(eq(sales.id, saleId), inArray(sales.status, [...INCOME_STATUSES])))
    .returning({ id: sales.id });
  return refunded.length > 0;
}

async function applyApproved(application: Application): Promise<ApplyOutcome> {
  const { order } = application;
  if (isSettled(order)) return noChange(order);
  const saleId = await createSale(application, "paid");
  const linkAlreadyPaid = await saveOrder(application, "approved", saleId);
  return flagLink({ kind: "sale-created", orderId: order.id, saleId, status: "paid" }, linkAlreadyPaid);
}

/** `pending`, `rejected` o `cancelled`: sin venta. Otro pago del mismo pedido todavía puede aprobarse. */
async function applyUnpaid(application: Application, status: OrderStatus): Promise<ApplyOutcome> {
  const { order, payment } = application;
  if (isSettled(order)) return noChange(order);
  if (order.status === status && order.providerPaymentId === payment.providerPaymentId) return noChange(order);
  await saveOrder(application, status);
  return { kind: "order-updated", orderId: order.id, status };
}

async function applyRefund(application: Application): Promise<ApplyOutcome> {
  const { tx, order } = application;
  if (isClosed(order)) return noChange(order);
  if (!isSettled(order)) {
    // La aprobación nunca llegó: la plata entró y salió, y el panel lo tiene que mostrar.
    const saleId = await createSale(application, "refunded");
    const linkAlreadyPaid = await saveOrder(application, "refunded", saleId);
    return flagLink({ kind: "sale-created", orderId: order.id, saleId, status: "refunded" }, linkAlreadyPaid);
  }
  await saveOrder(application, "refunded");
  if (order.saleId !== null && (await refundSale(tx, order.saleId))) {
    return { kind: "sale-updated", orderId: order.id, saleId: order.saleId, change: "refunded" };
  }
  return { kind: "order-updated", orderId: order.id, status: "refunded" };
}

async function applyChargeback(application: Application): Promise<ApplyOutcome> {
  const { tx, order } = application;
  if (order.status === "charged_back") return noChange(order);
  const saleId = isSettled(order) ? order.saleId : await createSale(application, "refunded");
  if (isSettled(order) && saleId !== null) await refundSale(tx, saleId);
  const linkAlreadyPaid = await saveOrder(application, "charged_back", saleId);
  if (saleId === null) return { kind: "order-updated", orderId: order.id, status: "charged_back" };
  // Aunque Tallami ya la hubiera marcado: un contracargo siempre se avisa.
  return flagLink({ kind: "sale-updated", orderId: order.id, saleId, change: "charged-back" }, linkAlreadyPaid);
}

async function applyPartialRefund(application: Application): Promise<ApplyOutcome> {
  const { order } = application;
  if (isClosed(order)) return noChange(order);
  if (!isSettled(order)) {
    // La aprobación nunca llegó y esta plata se cobró: se crea la venta, ya con su nota.
    const saleId = await createSale(application, "paid", partialRefundLine(application));
    const linkAlreadyPaid = await saveOrder(application, "approved", saleId);
    return flagLink({ kind: "sale-updated", orderId: order.id, saleId, change: "partial-refund" }, linkAlreadyPaid);
  }
  if (order.saleId === null || !(await notePartialRefund(application, order.saleId))) return noChange(order);
  return { kind: "sale-updated", orderId: order.id, saleId: order.saleId, change: "partial-refund" };
}

async function applyMediation(application: Application): Promise<ApplyOutcome> {
  const { order } = application;
  if (isClosed(order)) return noChange(order);
  if (!isSettled(order)) {
    // La aprobación nunca llegó: el aviso a Tallami necesita una venta con la que enlazar.
    const saleId = await createSale(application, "paid");
    const linkAlreadyPaid = await saveOrder(application, "approved", saleId);
    return flagLink({ kind: "sale-updated", orderId: order.id, saleId, change: "mediation" }, linkAlreadyPaid);
  }
  if (order.saleId === null) return noChange(order);
  return { kind: "sale-updated", orderId: order.id, saleId: order.saleId, change: "mediation" };
}

/**
 * ¿Este pago no le corresponde a este pedido? Un monto o una moneda distintos, o un pago ya
 * asociado a otro pedido, que la base rechazaría y haría fallar cada reintento.
 *
 * Una preferencia permite reintentar, así que un pedido puede tener varios pagos. Si ya tuvo el
 * suyo, otro que cobró es un cobro doble y es Tallami quien devuelve. Otro que no cobró nada es
 * un intento viejo que llegó tarde: no es un error, sea cual sea su monto, y `applyUnpaid` lo deja
 * pasar sin escribir nada.
 */
async function isMismatch({ tx, provider, order, payment }: Application): Promise<boolean> {
  const isSamePayment = order.providerPaymentId === payment.providerPaymentId;
  if (isSettled(order) && !isSamePayment) return TOOK_MONEY[payment.status];
  if (payment.amountMinor !== order.amountArsMinor || payment.currency !== ORDER_CURRENCY) return true;
  if (isSamePayment) return false;
  const [taken] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.provider, provider),
        eq(orders.providerPaymentId, payment.providerPaymentId),
        ne(orders.id, order.id),
      ),
    );
  return taken !== undefined;
}

function applyStatus(application: Application): Promise<ApplyOutcome> {
  const { status } = application.payment;
  switch (status) {
    case "approved":
      return applyApproved(application);
    case "pending":
    case "rejected":
    case "cancelled":
      return applyUnpaid(application, status);
    case "refunded":
      return applyRefund(application);
    case "partially_refunded":
      return applyPartialRefund(application);
    case "in_mediation":
      return applyMediation(application);
    case "charged_back":
      return applyChargeback(application);
  }
}

/**
 * Lleva el pago `payment` al pedido que dice ser suyo y, si corresponde, a su venta. Tira
 * solo ante un fallo de la base, y entonces no queda nada hecho.
 *
 * `now` es la hora del aviso: el `paidOn` de una venta cuyo pago no trae fecha de aprobación.
 */
export async function applyProviderPayment(
  db: Db,
  provider: Provider,
  payment: ProviderPayment,
  now: Date = new Date(),
): Promise<ApplyOutcome> {
  const { orderId } = payment;
  if (orderId === null || !isUuid(orderId)) return { kind: "unknown-order" };

  return db.transaction(async (tx): Promise<ApplyOutcome> => {
    // Es `no key update` y no `update` por lo que explica `createInvite`. Sigue chocando consigo
    // mismo, que es lo que hace falta para que dos avisos a la vez se turnen.
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.provider, provider)))
      .for("no key update");
    if (!order) return { kind: "unknown-order" };

    const application: Application = { tx, provider, order, payment, now };
    if (await isMismatch(application)) {
      const { providerPaymentId, amountMinor, currency } = payment;
      return { kind: "mismatch", orderId: order.id, providerPaymentId, amountMinor, currency };
    }
    return applyStatus(application);
  });
}
