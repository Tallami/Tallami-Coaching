import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/admin/auth/require-admin";
import { parseStudentsQuery, studentsQueryString } from "@/admin/customers/query";
import { listCustomersWithStats } from "@/admin/customers/repository";
import { StudentsSearch } from "@/admin/customers/students-search";
import { StudentsTable } from "@/admin/customers/students-table";
import { PAGE_SIZE } from "@/admin/limits";
import { ADMIN_ROUTES } from "@/admin/routes";
import { PageHeader } from "@/admin/ui/page-header";
import { Pagination } from "@/admin/ui/pagination";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { PanelShell } from "@/app/admin/panel-shell";

export const metadata: Metadata = { title: "Alumnos" };

export default async function StudentsPage(props: PageProps<"/admin/alumnos">) {
  await requireAdmin();
  const { q, page } = parseStudentsQuery(await props.searchParams);

  // Un solo grupo en la base trae a todos con sus totales; la página se corta acá.
  const students = await listCustomersWithStats(await getDb(), q);
  const total = students.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Una página que ya no existe (cambió la búsqueda o la lista): a la última.
  if (page > pageCount) redirect(`${ADMIN_ROUTES.students}${studentsQueryString(q, pageCount)}`);
  const rows = students.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <PanelShell active="students">
      <PageHeader
        title="Alumnos"
        description="Quiénes te compraron y cuánto gastó cada uno, del que compró hace menos al que compró hace más."
        actions={
          <Button asChild>
            <Link href={ADMIN_ROUTES.newStudent}>Nuevo alumno</Link>
          </Button>
        }
      />
      {/* Sin alumnos ni búsqueda no hay nada que buscar: queda solo la invitación a cargar el primero. */}
      {total > 0 || q ? <StudentsSearch q={q} /> : null}
      <StudentsTable rows={rows} hasSearch={Boolean(q)} />
      {total > 0 ? (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          noun="alumnos"
          singularNoun="alumno"
          hrefFor={(target) => `${ADMIN_ROUTES.students}${studentsQueryString(q, target)}`}
        />
      ) : null}
    </PanelShell>
  );
}
