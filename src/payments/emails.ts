// Los emails que salen cuando un pago cambió algo. A Tallami, en español como el panel; a
// quien compró, en el idioma del pedido, con los textos de `messages/*.json`.
//
// Nunca tiran ni hacen fallar el cobro: salen después de responderle al proveedor, y un
// email que no sale queda en el log. Qué se manda sale del resultado de `applyProviderPayment`,
// y `no-change` no manda nada: por eso un aviso repetido no repite el email.

import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { CURRENCIES, ITEM_LABELS, type Currency, type SaleItem } from "@/admin/catalog";
import { applicationHref, saleHref } from "@/admin/routes";
import type { Db } from "@/db/client";
import { customers, orders, proApplications, sales } from "@/db/schema";
import { isUuid } from "@/db/uuid";
import { sendPublicEmail, sendTallamiEmail, type EmailDeps, type EmailMessage } from "@/email/send";
import type { Locale } from "@/i18n/routing";
import { formatMoment } from "@/admin/dates";
import { formatMoney } from "@/lib/money";
import { SITE_URL } from "@/lib/site-url";
import { formatPortalMoney } from "@/portal/format";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import pt from "../../messages/pt.json";
import type { ApplyOutcome } from "./apply";
import { REPLAY_DELIVERY_HOURS, STATEMENT_DESCRIPTOR } from "./policy";

type Order = typeof orders.$inferSelect;
type TallamiEmail = Omit<EmailMessage, "to">;
type SaleChange = Extract<ApplyOutcome, { kind: "sale-updated" }>["change"];

const CATALOGS: Record<Locale, typeof es> = { es, pt, en };

const CHANGE_TITLES: Record<SaleChange, string> = {
  refunded: "Reembolso en Mercado Pago",
  "partial-refund": "Reembolso parcial en Mercado Pago",
  mediation: "Mediación en Mercado Pago",
  "charged-back": "Contracargo en Mercado Pago",
};

const CHANGE_EXPLANATIONS: Record<SaleChange, string> = {
  refunded: "Mercado Pago informa que este pago se reembolsó. La venta quedó reembolsada.",
  "partial-refund":
    "Mercado Pago informa un reembolso parcial de este pago. La venta sigue cobrada y quedó anotado en sus notas. Cuánto se devolvió se ve en Mercado Pago.",
  mediation: "El comprador abrió una mediación por este pago. La venta no cambió. Se responde en Mercado Pago.",
  "charged-back": "Mercado Pago informa un contracargo de este pago. Si la venta seguía cobrada, quedó reembolsada.",
};

function saleLink(saleId: string): string {
  return `${SITE_URL}${saleHref(saleId)}`;
}

function itemLabel(order: Order): string {
  return ITEM_LABELS[order.item as SaleItem];
}

/** Quién compró. El Discord y el email son lo que Tallami tiene para escribirle. */
function buyerLine(order: Order): string {
  const contact = [order.buyerHandle && `Discord: ${order.buyerHandle}`, order.buyerEmail && `email: ${order.buyerEmail}`]
    .filter(Boolean)
    .join(", ");
  return `Quién: ${order.buyerName}${contact ? ` (${contact})` : ""}`;
}

/** Quién, qué, pesos y dólares. */
function orderDetails(order: Order): string[] {
  return [
    buyerLine(order),
    `Qué: ${itemLabel(order)}`,
    `Pesos: ${formatMoney(order.amountArsMinor, "ARS")}`,
    `Dólares: ${formatMoney(order.amountUsdMinor, "USD")}`,
  ];
}

function tallamiEmail(subject: string, intro: string, order: Order, closing: string[]): TallamiEmail {
  return { subject, text: [intro, "", ...orderDetails(order), "", ...closing].join("\n") };
}

function saleCreatedEmail(order: Order, saleId: string, status: "paid" | "refunded"): TallamiEmail {
  const closing = [`Venta: ${saleLink(saleId)}`];
  if (status === "refunded") {
    return tallamiEmail(
      `Venta ya reembolsada: ${itemLabel(order)}`,
      "Mercado Pago informa un pago que ya se reembolsó, sin que llegara el aviso de su aprobación. La venta quedó creada y reembolsada.",
      order,
      closing,
    );
  }
  return tallamiEmail(`Venta nueva: ${itemLabel(order)}`, "Entró un pago por la web.", order, closing);
}

/** Un monto en la moneda que informó el proveedor: una que el panel no conoce sale con su código. */
function paymentAmount(amountMinor: number, currency: string): string {
  if ((CURRENCIES as readonly string[]).includes(currency)) return formatMoney(amountMinor, currency as Currency);
  return formatMoney(amountMinor, "USD").replace(/^USD/, currency);
}

/**
 * El pago que no coincide va con su id y su monto, separados de los del pedido: un cobro doble se
 * devuelve con el id del pago de más, y la venta del pedido sigue siendo la del otro.
 */
function mismatchEmail(order: Order, outcome: Extract<ApplyOutcome, { kind: "mismatch" }>): TallamiEmail {
  return {
    subject: `Un pago no coincide con su pedido: ${itemLabel(order)}`,
    text: [
      `Llegó un pago de Mercado Pago que no coincide con el pedido ${order.id}: el monto o la moneda son otros, o el pedido ya tenía otro pago. Ese pago no creó ninguna venta.`,
      "",
      buyerLine(order),
      `Qué: ${itemLabel(order)}`,
      `Monto del pedido: ${formatMoney(order.amountArsMinor, "ARS")} (${formatMoney(order.amountUsdMinor, "USD")})`,
      "",
      `Pago que no coincide: ${outcome.providerPaymentId}`,
      `Monto del pago: ${paymentAmount(outcome.amountMinor, outcome.currency)}`,
      ...(order.saleId && order.providerPaymentId ? [`Pago de la venta: ${order.providerPaymentId}`] : []),
      "",
      `Para encontrarlo en Mercado Pago, buscá la referencia ${order.id}.`,
      ...(order.saleId ? [`Venta del pedido: ${saleLink(order.saleId)}`] : []),
    ].join("\n"),
  };
}

/**
 * Un link de Temporada Pro que pagaron dos pedidos: el link no bloquea un segundo pedido, así que se
 * cobró dos veces. Va con las ventas de los dos, para devolver la que sobre.
 */
async function linkPaidTwiceEmail(db: Db, order: Order, saleId: string): Promise<TallamiEmail | null> {
  if (order.proPaymentLinkId === null) return null;
  const others = await db
    .select({ saleId: orders.saleId })
    .from(orders)
    .where(and(eq(orders.proPaymentLinkId, order.proPaymentLinkId), ne(orders.id, order.id), isNotNull(orders.saleId)))
    .orderBy(asc(orders.createdAt), asc(orders.id));
  const saleIds = [...others.flatMap((other) => (other.saleId ? [other.saleId] : [])), saleId];
  return tallamiEmail(
    `Link de Temporada Pro pagado dos veces: ${itemLabel(order)}`,
    "Un link de pago de la Temporada Pro se pagó más de una vez. Cada pago creó su venta: revisá con el equipo cuál corresponde y devolvé la que sobre en Mercado Pago.",
    order,
    saleIds.map((id, index) => `Venta ${index + 1}: ${saleLink(id)}`),
  );
}

function saleUpdatedEmail(order: Order, saleId: string, change: SaleChange): TallamiEmail {
  return tallamiEmail(`${CHANGE_TITLES[change]}: ${itemLabel(order)}`, CHANGE_EXPLANATIONS[change], order, [
    `Venta: ${saleLink(saleId)}`,
  ]);
}

function emailForTallami(order: Order, outcome: ApplyOutcome): TallamiEmail | null {
  switch (outcome.kind) {
    case "sale-created":
      return saleCreatedEmail(order, outcome.saleId, outcome.status);
    case "sale-updated":
      return saleUpdatedEmail(order, outcome.saleId, outcome.change);
    case "mismatch":
      return mismatchEmail(order, outcome);
    default:
      return null;
  }
}

type Translator = ReturnType<typeof createTranslator>;

/** Para un VOD review, qué sigue: pegar los códigos en el portal. Otro servicio no suma nada. */
function replayLines(order: Order, t: Translator): string[] {
  const hours = REPLAY_DELIVERY_HOURS[order.item as keyof typeof REPLAY_DELIVERY_HOURS];
  return hours === undefined ? [] : ["", t("Emails.purchase.replay", { hours })];
}

/** La confirmación a quien compró: Mercado Pago la recomienda para bajar contracargos. */
function emailForBuyer(order: Order, to: string): EmailMessage {
  const locale = order.locale as Locale;
  const t = createTranslator({ locale, messages: CATALOGS[locale] });
  const service = t(`Portal.items.${order.item as SaleItem}`);
  const amount = formatPortalMoney(order.amountArsMinor, "ARS", locale);
  return {
    to,
    subject: t("Emails.purchase.subject", { service }),
    text: [
      t("Emails.purchase.greeting", { name: order.buyerName }),
      "",
      t("Emails.purchase.confirmed", { amount, service }),
      t("Emails.purchase.statement", { descriptor: STATEMENT_DESCRIPTOR }),
      "",
      t("Emails.purchase.portal", { url: `${SITE_URL}/${locale}/portal` }),
      t("Emails.purchase.chat", { url: `${SITE_URL}/${locale}/portal/mensajes` }),
      ...replayLines(order, t),
      "",
      t("Emails.purchase.refund"),
      "",
      t("Emails.purchase.signature"),
    ].join("\n"),
  };
}

/** ¿Se le confirma la compra a quien pagó? Solo una venta nueva y cobrada, y si hay a dónde escribirle. */
function buyerAddress(order: Order, outcome: ApplyOutcome): string | null {
  return outcome.kind === "sale-created" && outcome.status === "paid" ? order.buyerEmail : null;
}

/**
 * Manda lo que corresponda al resultado de aplicar un pago. Lo llama el aviso con `after`, así
 * que se lee el pedido de nuevo, ya con la transacción cerrada. Un email que falla no frena al
 * otro. Nunca tira.
 *
 * `unknown-order` no manda nada: la cuenta de Mercado Pago puede recibir pagos que no son de la web.
 */
export async function notifyPaymentOutcome(db: Db, outcome: ApplyOutcome, deps: EmailDeps = {}): Promise<void> {
  try {
    if (outcome.kind === "unknown-order") return;
    const [order] = await db.select().from(orders).where(eq(orders.id, outcome.orderId));
    if (!order) return;

    const forTallami = emailForTallami(order, outcome);
    const linkTwice =
      (outcome.kind === "sale-created" || outcome.kind === "sale-updated") && outcome.linkAlreadyPaid
        ? await linkPaidTwiceEmail(db, order, outcome.saleId)
        : null;
    const buyer = buyerAddress(order, outcome);
    await Promise.all([
      forTallami ? sendTallamiEmail(forTallami, deps) : false,
      linkTwice ? sendTallamiEmail(linkTwice, deps) : false,
      buyer ? sendPublicEmail(emailForBuyer(order, buyer), deps) : false,
    ]);
  } catch (error) {
    // Solo el tipo de error: el mensaje puede traer la dirección de la base.
    console.error("[pagos] no se pudieron armar los emails:", error instanceof Error ? error.name : typeof error);
  }
}

/**
 * Avisa a Tallami que un alumno mandó los códigos de replay de su VOD review: desde ahí corre el plazo.
 * Sale solo con el primer envío. No incluye los códigos (se ven en la venta). Nunca tira.
 */
export async function notifyReplayCodesSent(db: Db, saleId: string, deps: EmailDeps = {}): Promise<void> {
  try {
    if (!isUuid(saleId)) return;
    const [row] = await db
      .select({
        item: sales.item,
        dueAt: sales.dueAt,
        sentAt: sales.replayCodesSentAt,
        customerName: customers.name,
        customerDiscord: customers.discord,
      })
      .from(sales)
      .innerJoin(customers, eq(sales.customerId, customers.id))
      .where(eq(sales.id, saleId));
    if (!row || !row.sentAt) return;
    const service = ITEM_LABELS[row.item as SaleItem];
    await sendTallamiEmail(
      {
        subject: `Códigos de replay recibidos: ${service}`,
        text: [
          "Un alumno mandó los códigos de replay de su VOD review. Desde ahora corre el plazo de entrega.",
          "",
          `Quién: ${row.customerName}${row.customerDiscord ? ` (Discord: ${row.customerDiscord})` : ""}`,
          `Qué: ${service}`,
          `Recibidos: ${formatMoment(row.sentAt)} (hora de Argentina)`,
          ...(row.dueAt ? [`Entrega hasta: ${formatMoment(row.dueAt)}`] : []),
          "",
          `Venta: ${saleLink(saleId)}`,
        ].join("\n"),
      },
      deps,
    );
  } catch (error) {
    console.error("[pagos] no se pudo avisar de los códigos:", error instanceof Error ? error.name : typeof error);
  }
}

/** Avisa a Tallami de una aplicación nueva a la Temporada Pro. Nunca tira. */
export async function notifyProApplication(
  application: typeof proApplications.$inferSelect,
  deps: EmailDeps = {},
): Promise<void> {
  try {
    await sendTallamiEmail(
      {
        subject: `Aplicación a Temporada Pro: ${application.name}`,
        text: [
          "Llegó una aplicación nueva a la Temporada Pro.",
          "",
          `Nombre: ${application.name}`,
          `Discord: ${application.discord}`,
          `Integrantes: ${application.teamMembers}`,
          `Resultados: ${application.results}`,
          ...(application.message ? [`Mensaje: ${application.message}`] : []),
          "",
          `Aplicación: ${SITE_URL}${applicationHref(application.id)}`,
        ].join("\n"),
      },
      deps,
    );
  } catch (error) {
    console.error("[pro] no se pudo avisar de la aplicación:", error instanceof Error ? error.name : typeof error);
  }
}
