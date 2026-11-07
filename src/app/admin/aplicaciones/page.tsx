import type { Metadata } from "next";
import Link from "next/link";
import { APPLICATION_STATUS_BADGES, APPLICATION_STATUS_LABELS } from "@/admin/applications/labels";
import { requireAdmin } from "@/admin/auth/require-admin";
import { formatMoment } from "@/admin/dates";
import { applicationHref } from "@/admin/routes";
import { EmptyState } from "@/admin/ui/empty-state";
import { Notice } from "@/admin/ui/notice";
import { PageHeader } from "@/admin/ui/page-header";
import { firstValue } from "@/admin/ui/search-params";
import { PanelShell } from "@/app/admin/panel-shell";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db/client";
import type { ProApplicationStatus } from "@/payments/policy";
import { listProApplications } from "@/pro/applications";

export const metadata: Metadata = { title: "Aplicaciones" };

export default async function ApplicationsPage(props: PageProps<"/admin/aplicaciones">) {
  await requireAdmin();
  const [applications, params] = await Promise.all([listProApplications(await getDb()), props.searchParams]);
  const deleted = firstValue(params.borrada) === "1";

  return (
    <PanelShell active="applications">
      <PageHeader
        title="Aplicaciones"
        description="Los equipos que aplicaron a la Temporada Pro, de la más nueva a la más vieja. Abrí una para hablar con ellos y generar su link de pago."
      />
      {deleted ? (
        <Notice tone="ok" className="mb-6">
          Aplicación borrada.
        </Notice>
      ) : null}
      {applications.length === 0 ? (
        <EmptyState
          title="Todavía no hay aplicaciones"
          description="Cuando un equipo complete el formulario de Temporada Pro, aparece acá y te llega un aviso por email."
        />
      ) : (
        <div className="border-2 border-ink bg-white">
          <Table className="min-w-[40rem]" containerProps={{ role: "region", "aria-label": "Aplicaciones", tabIndex: 0 }}>
            <TableHeader>
              <TableRow className="border-b-0 hover:bg-transparent focus-within:bg-transparent">
                <TableHead scope="col">Nombre</TableHead>
                <TableHead scope="col">Discord</TableHead>
                <TableHead scope="col">Estado</TableHead>
                <TableHead scope="col">Llegó</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map((application) => {
                const status = application.status as ProApplicationStatus;
                return (
                  <TableRow key={application.id}>
                    <TableCell className="max-w-[16rem] break-words">
                      <Link
                        href={applicationHref(application.id)}
                        prefetch={false}
                        className="rounded-[2px] font-bold underline decoration-ink-2/50 underline-offset-4 hover:decoration-ink"
                      >
                        {application.name}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[14rem] break-words">{application.discord}</TableCell>
                    <TableCell>
                      <Badge variant={APPLICATION_STATUS_BADGES[status]}>{APPLICATION_STATUS_LABELS[status]}</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatMoment(application.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </PanelShell>
  );
}
