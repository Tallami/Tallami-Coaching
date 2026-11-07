import type { Metadata } from "next";
import Link from "next/link";
import { DeleteApplication } from "@/admin/applications/delete-application";
import { APPLICATION_STATUS_LABELS } from "@/admin/applications/labels";
import { ProLinkCard } from "@/admin/applications/pro-link-card";
import { requireAdmin } from "@/admin/auth/require-admin";
import { formatMoment } from "@/admin/dates";
import { ADMIN_ROUTES } from "@/admin/routes";
import { EmptyState } from "@/admin/ui/empty-state";
import { Notice } from "@/admin/ui/notice";
import { PageHeader } from "@/admin/ui/page-header";
import { firstValue } from "@/admin/ui/search-params";
import { PanelShell } from "@/app/admin/panel-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { PRO_APPLICATION_STATUSES } from "@/payments/policy";
import { getProApplication } from "@/pro/applications";
import { listProPaymentLinks, type ProPaymentLink } from "@/pro/payment-links";
import { setApplicationStatusAction } from "../actions";

export const metadata: Metadata = { title: "Aplicación" };

function Datum({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <dt className="text-[0.875rem] font-bold text-ink-2">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words">{children}</dd>
    </div>
  );
}

function LinkState({ link, now }: { link: ProPaymentLink; now: Date }) {
  if (link.paidAt) return <Badge variant="ok">Pagado el {formatMoment(link.paidAt)}</Badge>;
  if (link.expiresAt <= now) return <Badge variant="neutral">Vencido</Badge>;
  return <Badge variant="warn">Sin pagar</Badge>;
}

export default async function ApplicationPage(props: PageProps<"/admin/aplicaciones/[id]">) {
  await requireAdmin();
  const { id } = await props.params;
  const now = new Date();
  const db = await getDb();
  const application = await getProApplication(db, id);

  if (!application) {
    return (
      <PanelShell active="applications">
        <PageHeader title="Aplicación" />
        <EmptyState
          title="No encontramos esa aplicación"
          description="Puede que el enlace esté mal escrito o que la hayas borrado. Volvé a la lista."
          action={
            <Button asChild variant="ink-outline">
              <Link href={ADMIN_ROUTES.applications}>Volver a aplicaciones</Link>
            </Button>
          }
        />
      </PanelShell>
    );
  }

  const links = await listProPaymentLinks(db, application.id);
  const collected = links.reduce((sum, link) => (link.paidAt ? sum + link.amountUsdMinor : sum), 0);
  const saved = firstValue((await props.searchParams).guardado) === "estado";

  return (
    <PanelShell active="applications">
      <PageHeader
        title={application.name}
        description={`Llegó el ${formatMoment(application.createdAt)}.`}
        actions={
          <Button asChild variant="ink-outline">
            <Link href={ADMIN_ROUTES.applications}>Volver a aplicaciones</Link>
          </Button>
        }
      />
      {saved ? (
        <Notice tone="ok" className="mb-6">
          Estado guardado.
        </Notice>
      ) : null}
      <section aria-labelledby="application-data" className="mb-6 border-2 border-ink border-l-[6px] border-l-zone bg-white px-5 py-4">
        <h2 id="application-data" className="text-[1.25rem] leading-tight font-extrabold [font-stretch:75%]">
          Datos
        </h2>
        <dl className="mt-3 grid gap-4 md:grid-cols-2">
          <Datum label="Discord">{application.discord}</Datum>
          <Datum label="Idioma">{application.locale.toUpperCase()}</Datum>
          <Datum label="Integrantes">{application.teamMembers}</Datum>
          <Datum label="Mejores resultados">{application.results}</Datum>
          {application.message ? <Datum label="Mensaje">{application.message}</Datum> : null}
        </dl>
        <form action={setApplicationStatusAction.bind(null, application.id)} className="mt-5 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="application-status" className="text-[0.9375rem] font-bold">
              Estado
            </label>
            <NativeSelect id="application-status" name="status" defaultValue={application.status}>
              {PRO_APPLICATION_STATUSES.map((status) => (
                <NativeSelectOption key={status} value={status}>
                  {APPLICATION_STATUS_LABELS[status]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" size="sm" variant="ink-outline">
            Guardar estado
          </Button>
        </form>
        <p className="mt-2 text-[0.875rem] text-ink-2">
          El estado lo cambiás vos: el sitio no sabe cuánto acordaron en total, así que un pago no lo mueve solo.
        </p>
      </section>

      <ProLinkCard applicationId={application.id} />

      <section aria-labelledby="application-links" className="mb-6 border-2 border-ink bg-white px-5 py-4">
        <h2 id="application-links" className="text-[1.25rem] leading-tight font-extrabold [font-stretch:75%]">
          Links de pago
        </h2>
        <p className="mt-2" data-testid="collected">
          Cobrado: <strong>{formatMoney(collected, "USD")}</strong>
        </p>
        {links.length === 0 ? (
          <p className="mt-2 text-ink-2">Todavía no generaste ningún link para esta aplicación.</p>
        ) : (
          <Table className="mt-3 min-w-[34rem]" containerProps={{ role: "region", "aria-label": "Links de pago", tabIndex: 0 }}>
            <TableHeader>
              <TableRow className="border-b-0 hover:bg-transparent focus-within:bg-transparent">
                <TableHead scope="col" className="text-right">
                  Monto
                </TableHead>
                <TableHead scope="col">Generado</TableHead>
                <TableHead scope="col">Vence</TableHead>
                <TableHead scope="col">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => (
                <TableRow key={link.id}>
                  <TableCell className="text-right whitespace-nowrap tabular-nums">{formatMoney(link.amountUsdMinor, "USD")}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatMoment(link.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatMoment(link.expiresAt)}</TableCell>
                  <TableCell>
                    <LinkState link={link} now={now} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <DeleteApplication applicationId={application.id} />
    </PanelShell>
  );
}
