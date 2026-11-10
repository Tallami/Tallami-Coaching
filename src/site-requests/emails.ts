// Los emails de un pedido del sitio: la constancia a quien escribió (arrepentimiento y baja, en
// su idioma, con el código) y el aviso a Tallami (en español). Nunca tiran.

import { createTranslator } from "next-intl";
import { ADMIN_ROUTES } from "@/admin/routes";
import type { siteRequests } from "@/db/schema";
import { sendPublicEmail, sendTallamiEmail, type EmailDeps } from "@/email/send";
import type { Locale } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-url";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import pt from "../../messages/pt.json";

type SiteRequestRow = typeof siteRequests.$inferSelect;

const CATALOGS: Record<Locale, typeof es> = { es, pt, en };
const KIND_LABELS = { withdrawal: "Arrepentimiento", cancellation: "Baja de servicio", contact: "Contacto" } as const;

function receiptFor(request: SiteRequestRow) {
  const locale = request.locale as Locale;
  const t = createTranslator({ locale, messages: CATALOGS[locale] });
  const kind = request.kind === "cancellation" ? "cancellation" : "withdrawal";
  return {
    to: request.email,
    subject: t(`Emails.request.${kind}.subject`, { code: request.code }),
    text: [
      t("Emails.request.greeting", { name: request.name }),
      "",
      t(`Emails.request.${kind}.body`, { code: request.code }),
      "",
      t("Emails.request.signature"),
    ].join("\n"),
  };
}

function noticeForTallami(request: SiteRequestRow) {
  const label = KIND_LABELS[request.kind as keyof typeof KIND_LABELS];
  return {
    subject: `${label}: ${request.name} (${request.code})`,
    // Para contestarle con un clic. Solo en el aviso a Tallami, nunca en la constancia.
    replyTo: request.email,
    text: [
      `Llegó un pedido nuevo desde la web: ${label}.`,
      "",
      `Código: ${request.code}`,
      `Nombre: ${request.name}`,
      `Email: ${request.email}`,
      ...(request.orderReference ? [`Pedido o compra: ${request.orderReference}`] : []),
      ...(request.message ? [`Mensaje: ${request.message}`] : []),
      "",
      `Pedidos del sitio: ${SITE_URL}${ADMIN_ROUTES.siteRequests}`,
    ].join("\n"),
  };
}

/**
 * Manda lo que corresponde al pedido. `true` si salió el email de constancia (el que ve quien
 * escribió); en un contacto, que no lleva constancia, si salió el aviso a Tallami.
 */
export async function notifySiteRequest(request: SiteRequestRow, deps: EmailDeps = {}): Promise<boolean> {
  try {
    const toTallami = sendTallamiEmail(noticeForTallami(request), deps);
    if (request.kind === "contact") return await toTallami;
    const [receiptSent] = await Promise.all([sendPublicEmail(receiptFor(request), deps), toTallami]);
    return receiptSent;
  } catch (error) {
    console.error("[sitio] no se pudieron mandar los emails del pedido:", error instanceof Error ? error.name : typeof error);
    return false;
  }
}
