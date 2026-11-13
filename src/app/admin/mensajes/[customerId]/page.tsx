import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/admin/auth/require-admin";
import { ConversationHeader } from "@/admin/chat/conversation-header";
import { DeleteConversation } from "@/admin/chat/delete-conversation";
import { BUSINESS_TIME_ZONE } from "@/admin/dates";
import { ADMIN_ROUTES } from "@/admin/routes";
import { EmptyState } from "@/admin/ui/empty-state";
import { PageHeader } from "@/admin/ui/page-header";
import { PanelShell } from "@/app/admin/panel-shell";
import { listMessages } from "@/chat/conversations";
import { CHAT_IDLE } from "@/chat/form-state";
import { MESSAGE_MAX_LENGTH, MESSAGES_REFRESH_MS } from "@/chat/policy";
import { AutoRefresh } from "@/components/chat/auto-refresh";
import { chatDraftKey } from "@/components/chat/chat-draft";
import { ComposeForm, type ComposeLabels } from "@/components/chat/compose-form";
import { MessageThread } from "@/components/chat/message-thread";
import { Button } from "@/components/ui/button";
import { getDb, type Db } from "@/db/client";
import { customers } from "@/db/schema";
import { isUuid } from "@/db/uuid";
import { accountForCustomer } from "@/portal/accounts";
import { markCoachReadAction, sendCoachMessageAction } from "../actions";

export const metadata: Metadata = { title: "Conversación" };

const COMPOSE_LABELS: ComposeLabels = {
  label: "Tu respuesta",
  hint: "El alumno recibe un aviso por email, sin el texto. Con Ctrl + Enter también se envía.",
  submit: "Enviar",
  submitting: "Enviando…",
  sent: "Mensaje enviado.",
  invalid: `Escribí un mensaje de hasta ${MESSAGE_MAX_LENGTH} caracteres.`,
  rateLimited: "Mandaste muchos mensajes en poco tiempo. Esperá un rato y probá de nuevo.",
  signedOut: "Tu sesión del panel se cerró. Ingresá de nuevo y volvé a enviar.",
  failed: "No pudimos enviar el mensaje. Probá de nuevo en unos minutos: lo que escribiste sigue acá.",
  noAccount:
    "Este alumno no tiene una cuenta del portal vinculada, así que no se guardó nada y nadie lo leería. Invitalo desde su ficha. Lo que escribiste sigue acá.",
};

/** El nombre del alumno, o `null` si el id no es un alumno. */
async function studentNameOf(db: Db, customerId: string): Promise<string | null> {
  if (!isUuid(customerId)) return null;
  const [row] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId));
  return row?.name ?? null;
}

export default async function ConversationPage(props: PageProps<"/admin/mensajes/[customerId]">) {
  await requireAdmin();
  const { customerId } = await props.params;
  const db = await getDb();
  const studentName = await studentNameOf(db, customerId);

  if (studentName === null) {
    return (
      <PanelShell active="messages">
        <PageHeader title="Conversación" />
        <EmptyState
          title="No encontramos a ese alumno"
          description="Puede que el enlace esté mal escrito o que el alumno ya no exista. Volvé a la bandeja."
          action={
            <Button asChild variant="ink-outline">
              <Link href={ADMIN_ROUTES.messages}>Volver a mensajes</Link>
            </Button>
          }
        />
      </PanelShell>
    );
  }

  const [account, messages] = await Promise.all([accountForCustomer(db, customerId), listMessages(db, customerId)]);

  return (
    <PanelShell active="messages">
      <PageHeader
        title={studentName}
        description="La conversación es solo entre vos y el alumno. Las horas son de Argentina."
        actions={
          <Button asChild variant="ink-outline">
            <Link href={ADMIN_ROUTES.messages}>Volver a mensajes</Link>
          </Button>
        }
      />
      <ConversationHeader customerId={customerId} studentName={studentName} account={account} />
      <div className="flex max-w-3xl flex-col gap-6">
        <MessageThread
          messages={messages}
          viewer="coach"
          labels={{
            own: "Vos",
            other: studentName,
            empty: "Todavía no hay mensajes en esta conversación.",
            thread: `Conversación con ${studentName}`,
          }}
          timeZone={BUSINESS_TIME_ZONE}
        />
        {account ? (
          <ComposeForm
            action={sendCoachMessageAction.bind(null, customerId)}
            initialState={CHAT_IDLE}
            labels={COMPOSE_LABELS}
            maxLength={MESSAGE_MAX_LENGTH}
            draftKey={chatDraftKey("admin", customerId)}
          />
        ) : null}
        <AutoRefresh
          intervalMs={MESSAGES_REFRESH_MS}
          incoming={messages.filter(({ sender }) => sender === "student").length}
          markRead={markCoachReadAction.bind(null, customerId)}
        />
        <DeleteConversation customerId={customerId} studentName={studentName} />
      </div>
    </PanelShell>
  );
}
