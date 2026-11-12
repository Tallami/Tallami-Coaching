import type { Metadata } from "next";
import { requireAdmin } from "@/admin/auth/require-admin";
import { InboxList } from "@/admin/chat/inbox-list";
import { EmptyState } from "@/admin/ui/empty-state";
import { Notice } from "@/admin/ui/notice";
import { PageHeader } from "@/admin/ui/page-header";
import { firstValue } from "@/admin/ui/search-params";
import { PanelShell } from "@/app/admin/panel-shell";
import { listInbox } from "@/chat/conversations";
import { getDb } from "@/db/client";

export const metadata: Metadata = { title: "Mensajes" };

export default async function MessagesInboxPage(props: PageProps<"/admin/mensajes">) {
  await requireAdmin();
  const [rows, params] = await Promise.all([listInbox(await getDb()), props.searchParams]);
  const deleted = firstValue(params.borrada) === "1";

  return (
    <PanelShell active="messages">
      <PageHeader
        title="Mensajes"
        description="Las conversaciones con tus alumnos: arriba las que tienen algo sin leer. Se borran solas a los 24 meses sin mensajes nuevos."
      />
      {deleted ? (
        <Notice tone="ok" className="mb-6">
          Conversación borrada.
        </Notice>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="Todavía no hay conversaciones. Podés escribirle a un alumno desde su ficha." />
      ) : (
        <InboxList rows={rows} />
      )}
    </PanelShell>
  );
}
