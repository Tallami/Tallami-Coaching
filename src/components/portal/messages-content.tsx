import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { markStudentReadAction, sendStudentMessageAction } from "@/app/[locale]/portal/mensajes/actions";
import { listMessages, type ChatMessage } from "@/chat/conversations";
import { CHAT_IDLE } from "@/chat/form-state";
import { MESSAGE_MAX_LENGTH, MESSAGES_REFRESH_MS } from "@/chat/policy";
import { AutoRefresh } from "@/components/chat/auto-refresh";
import { chatDraftKey } from "@/components/chat/chat-draft";
import { ComposeForm, type ComposeLabels } from "@/components/chat/compose-form";
import { MessageThread } from "@/components/chat/message-thread";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { INTL_TAG, type Locale } from "@/i18n/routing";
import { enabledProviders, isPortalConfigured } from "@/portal/config";
import { getCurrentStudent } from "@/portal/current";
import { MessageView } from "./message-view";
import { SignInButtons } from "./sign-in-buttons";

/** Lo que se sabe de quien mira: sin sesión, cuenta sin vincular o alumno con su conversación. */
type ChatVisitor =
  | { view: "signedOut" }
  | { view: "unlinked" }
  | { view: "linked"; customerId: string; messages: ChatMessage[] };

/**
 * Lee la sesión y, si la cuenta es de un alumno, su conversación. Es la única puerta a los mensajes de
 * esta página: sin sesión, o con una cuenta sin vincular, no se lee ningún mensaje, y los que se leen
 * son siempre los del alumno de esa cuenta.
 */
async function loadChatVisitor(): Promise<ChatVisitor> {
  const account = await getCurrentStudent();
  if (!account) return { view: "signedOut" };
  if (!account.customerId) return { view: "unlinked" };
  return { view: "linked", customerId: account.customerId, messages: await listMessages(await getDb(), account.customerId) };
}

/** Solo el nombre del error: el mensaje podría traer la conexión a la base. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function SignInToChat({ locale }: { locale: Locale }) {
  const t = await getTranslations("Chat.signIn");

  return (
    <section aria-labelledby="chat-sign-in-title" className="stage max-w-2xl rounded-[4px] p-[clamp(24px,4vw,40px)]">
      <h2 id="chat-sign-in-title" className="text-[clamp(1.6rem,4vw,2.25rem)] font-extrabold font-stretch-72% leading-none">
        {t("title")}
      </h2>
      <p className="mt-4 mb-7 max-w-[52ch] text-on-stage-2">{t("body")}</p>
      <SignInButtons providers={enabledProviders()} locale={locale} inviteToken={null} />
    </section>
  );
}

async function UnlinkedChat({ locale }: { locale: Locale }) {
  const t = await getTranslations("Chat.unlinked");

  return (
    <section aria-labelledby="chat-unlinked-title" className="max-w-2xl border-t-4 border-gold bg-white/60 p-[clamp(20px,4vw,32px)]">
      <h2 id="chat-unlinked-title" className="text-[clamp(1.6rem,4vw,2.25rem)] font-extrabold font-stretch-72% leading-none">
        {t("title")}
      </h2>
      <p className="mt-4 max-w-[52ch] text-ink-2">{t("body")}</p>
      <Button asChild variant="ink-outline" size="sm" className="mt-6">
        <a href={`/${locale}#services`}>{t("services")}</a>
      </Button>
    </section>
  );
}

async function Conversation({ locale, customerId, messages }: { locale: Locale; customerId: string; messages: ChatMessage[] }) {
  const t = await getTranslations("Chat");
  const labels: ComposeLabels = {
    label: t("compose.label"),
    hint: t("compose.hint"),
    submit: t("compose.submit"),
    submitting: t("compose.submitting"),
    sent: t("compose.sent"),
    invalid: t("compose.errors.invalid", { max: MESSAGE_MAX_LENGTH }),
    rateLimited: t("compose.errors.rateLimited"),
    signedOut: t("compose.errors.signedOut"),
    failed: t("compose.errors.failed"),
    signIn: { text: t("compose.signIn"), href: `/${locale}/portal`, opensInNewTab: t("compose.opensInNewTab") },
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <MessageThread
        messages={messages}
        viewer="student"
        labels={{ own: t("thread.own"), other: t("thread.other"), empty: t("thread.empty"), thread: t("thread.label") }}
        locale={INTL_TAG[locale]}
      />
      {/* El borrador es del alumno (su propio id): vuelve si el refresco saca el formulario y entra de nuevo en esta pestaña. */}
      <ComposeForm
        action={sendStudentMessageAction}
        initialState={CHAT_IDLE}
        labels={labels}
        maxLength={MESSAGE_MAX_LENGTH}
        draftKey={chatDraftKey("portal", customerId)}
      />
      <AutoRefresh
        intervalMs={MESSAGES_REFRESH_MS}
        incoming={messages.filter(({ sender }) => sender === "coach").length}
        markRead={markStudentReadAction}
      />
    </div>
  );
}

/**
 * Lo que cambia en cada pedido de la página de mensajes: depende de la cookie de sesión. Va sin `Suspense`
 * (ver `page.tsx`: tiene que verse sin JavaScript). `connection()` primero: lo que es de una persona se arma
 * solo cuando esa persona abre la página, nunca en el build ni en una precarga.
 */
export async function MessagesContent({ locale }: { locale: Locale }) {
  await connection();
  if (!isPortalConfigured()) return <MessageView messageKey="unavailable" />;

  let visitor: ChatVisitor;
  try {
    visitor = await loadChatVisitor();
  } catch (error) {
    unstable_rethrow(error);
    console.error(`[mensajes] no se pudo leer la sesión o la conversación del alumno. ${errorName(error)}`);
    return <MessageView messageKey="loadFailed" />;
  }

  switch (visitor.view) {
    case "signedOut":
      return <SignInToChat locale={locale} />;
    case "unlinked":
      return <UnlinkedChat locale={locale} />;
    case "linked":
      return <Conversation locale={locale} customerId={visitor.customerId} messages={visitor.messages} />;
  }
}
