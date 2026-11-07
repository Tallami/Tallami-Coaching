import type { Metadata } from "next";
import { requireAdmin } from "@/admin/auth/require-admin";
import { formatMoment } from "@/admin/dates";
import { DeleteSiteRequest } from "@/admin/site-requests/delete-site-request";
import { EmptyState } from "@/admin/ui/empty-state";
import { Notice } from "@/admin/ui/notice";
import { PageHeader } from "@/admin/ui/page-header";
import { firstValue } from "@/admin/ui/search-params";
import { PanelShell } from "@/app/admin/panel-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { listSiteRequests, type SiteRequest } from "@/site-requests/requests";
import { markSiteRequestHandledAction } from "./actions";

export const metadata: Metadata = { title: "Pedidos del sitio" };

const KIND_LABELS = { withdrawal: "Arrepentimiento", cancellation: "Baja de servicio", contact: "Contacto" } as const;

function Datum({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <dt className="text-[0.875rem] font-bold text-ink-2">{label}</dt>
      <dd className="mt-0.5 break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

function RequestCard({ request }: { request: SiteRequest }) {
  const kind = KIND_LABELS[request.kind as keyof typeof KIND_LABELS];
  const isNew = request.status === "new";
  return (
    <li className="border-2 border-ink bg-white p-5" data-testid="site-request">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[1.125rem] font-extrabold">{request.code}</h2>
        <Badge variant="info">{kind}</Badge>
        <Badge variant={isNew ? "warn" : "ok"}>{isNew ? "Nuevo" : "Atendido"}</Badge>
        <Badge variant={request.emailSentAt ? "ok" : "neutral"}>{request.emailSentAt ? "Email salido" : "Email sin salir"}</Badge>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <Datum label="Nombre">{request.name}</Datum>
        <Datum label="Email">{request.email}</Datum>
        {request.orderReference ? <Datum label="Compra">{request.orderReference}</Datum> : null}
        <Datum label="Llegó">{formatMoment(request.createdAt)}</Datum>
        {request.handledAt ? <Datum label="Atendido">{formatMoment(request.handledAt)}</Datum> : null}
        {request.message ? <Datum label="Mensaje">{request.message}</Datum> : null}
      </dl>
      <div className="mt-5 flex flex-wrap items-start gap-3">
        {isNew ? (
          <form action={markSiteRequestHandledAction.bind(null, request.id)}>
            <Button type="submit" size="sm">
              Marcar atendido
              <span className="sr-only"> el pedido {request.code}</span>
            </Button>
          </form>
        ) : null}
        <DeleteSiteRequest requestId={request.id} code={request.code} />
      </div>
    </li>
  );
}

export default async function SiteRequestsPage(props: PageProps<"/admin/pedidos">) {
  await requireAdmin();
  const [requests, params] = await Promise.all([listSiteRequests(await getDb()), props.searchParams]);
  const handled = firstValue(params.atendido) === "1";
  const deleted = firstValue(params.borrado) === "1";

  return (
    <PanelShell active="siteRequests">
      <PageHeader
        title="Pedidos del sitio"
        description="Arrepentimientos, bajas de servicio y mensajes de contacto, del más nuevo al más viejo. Se borran solos a los 24 meses."
      />
      {handled ? (
        <Notice tone="ok" className="mb-6">
          Pedido marcado como atendido.
        </Notice>
      ) : null}
      {deleted ? (
        <Notice tone="ok" className="mb-6">
          Pedido borrado.
        </Notice>
      ) : null}
      {requests.length === 0 ? (
        <EmptyState
          title="Todavía no hay pedidos"
          description="Cuando alguien use el botón de arrepentimiento, el de baja o el formulario de contacto, aparece acá y te llega un aviso por email."
        />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </ul>
      )}
    </PanelShell>
  );
}
