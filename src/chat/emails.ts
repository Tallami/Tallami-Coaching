// Los avisos de un mensaje nuevo: a Tallami cuando escribe el alumno, al alumno cuando escribe
// Tallami. **Ningún email lleva el texto del mensaje**: solo quién escribió y el enlace. Quién
// manda un aviso y cuándo (`notify`) lo decide `conversations.ts`; esto solo lo arma y lo envía.
//
// Nunca tira ni hace fallar el envío del mensaje, que ya quedó guardado. Un error se anota en el
// log solo con su tipo: el mensaje de un error puede traer direcciones.

import { createTranslator } from "next-intl";
import { conversationHref } from "@/admin/routes";
import type { Db } from "@/db/client";
import { customers } from "@/db/schema";
import { isUuid } from "@/db/uuid";
import { sendPublicEmail, sendTallamiEmail, type EmailDeps } from "@/email/send";
import type { Locale } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-url";
import { accountForCustomer } from "@/portal/accounts";
import { eq } from "drizzle-orm";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import pt from "../../messages/pt.json";
import type { MessageSender } from "./policy";

const CATALOGS: Record<Locale, typeof es> = { es, pt, en };

async function noticeForTallami(db: Db, customerId: string, deps: EmailDeps): Promise<void> {
  const [student] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
  if (!student) return;
  await sendTallamiEmail(
    {
      subject: `Mensaje nuevo de ${student.name}`,
      text: [
        `${student.name} te escribió en el chat de la web.`,
        "",
        `Conversación: ${SITE_URL}${conversationHref(customerId)}`,
      ].join("\n"),
    },
    deps,
  );
}

async function noticeForStudent(db: Db, customerId: string, deps: EmailDeps): Promise<void> {
  const account = await accountForCustomer(db, customerId);
  if (!account?.email) return;
  const t = createTranslator({ locale: account.locale, messages: CATALOGS[account.locale] });
  await sendPublicEmail(
    {
      to: account.email,
      subject: t("Emails.chat.subject"),
      text: [
        t("Emails.chat.greeting", { name: account.displayName }),
        "",
        t("Emails.chat.newMessage"),
        t("Emails.chat.link", { url: `${SITE_URL}/${account.locale}/portal/mensajes` }),
        "",
        t("Emails.chat.signature"),
      ].join("\n"),
    },
    deps,
  );
}

/**
 * Avisa de un mensaje nuevo de `sender` en la conversación del alumno `customerId`: si escribió el
 * alumno, a Tallami; si escribió Tallami, al email de la cuenta del alumno, en su idioma. Una cuenta
 * sin email, un alumno sin cuenta o un id que no existe no mandan nada. Nunca tira.
 */
export async function notifyChatMessage(
  db: Db,
  customerId: string,
  sender: MessageSender,
  deps: EmailDeps = {},
): Promise<void> {
  try {
    if (!isUuid(customerId)) return;
    if (sender === "student") await noticeForTallami(db, customerId, deps);
    else await noticeForStudent(db, customerId, deps);
  } catch (error) {
    console.error("[mensajes] no se pudo mandar el aviso:", error instanceof Error ? error.name : typeof error);
  }
}
