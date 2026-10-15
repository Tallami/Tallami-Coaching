import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/admin/auth/require-admin";
import type { StudentFormValues } from "@/admin/customers/form-state";
import { getCustomer, type CustomerDetail } from "@/admin/customers/repository";
import { StudentForm } from "@/admin/customers/student-form";
import { StudentHistory } from "@/admin/customers/student-history";
import { StudentSummary } from "@/admin/customers/student-summary";
import { AdminShell } from "@/admin/ui/admin-shell";
import { EmptyState } from "@/admin/ui/empty-state";
import { Notice } from "@/admin/ui/notice";
import { PageHeader } from "@/admin/ui/page-header";
import { firstValue } from "@/admin/ui/search-params";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { updateStudentAction } from "../actions";

export const metadata: Metadata = { title: "Alumno" };

const STUDENTS_PATH = "/admin/alumnos";

/** Avisos que deja `?guardado=` después de guardar. Un `Map`: lo que escriba la dirección no puede caer en `Object.prototype`. */
const SAVED_MESSAGES = new Map([
  ["creado", "Alumno guardado."],
  ["editado", "Cambios guardados."],
]);

function toFormValues(student: CustomerDetail): StudentFormValues {
  return {
    name: student.name,
    discord: student.discord ?? "",
    country: student.country ?? "",
    notes: student.notes ?? "",
  };
}

export default async function StudentPage(props: PageProps<"/admin/alumnos/[id]">) {
  await requireAdmin();
  const { id } = await props.params;
  const student = await getCustomer(await getDb(), id);

  if (!student) {
    return (
      <AdminShell active="students">
        <PageHeader title="Alumno" />
        <EmptyState
          title="No encontramos a ese alumno"
          description="Puede que el enlace esté mal escrito. Volvé a la lista para elegirlo de nuevo."
          action={
            <Button asChild variant="ink-outline">
              <Link href={STUDENTS_PATH}>Volver a alumnos</Link>
            </Button>
          }
        />
      </AdminShell>
    );
  }

  const savedMessage = SAVED_MESSAGES.get(firstValue((await props.searchParams).guardado) ?? "");
  const formValues = toFormValues(student);

  return (
    <AdminShell active="students">
      <PageHeader
        title={student.name}
        description="Lo que compró, todas sus ventas y sus datos."
        actions={
          <Button asChild variant="ink-outline">
            <Link href={STUDENTS_PATH}>Volver a alumnos</Link>
          </Button>
        }
      />
      {savedMessage ? (
        <Notice tone="ok" className="mb-5">
          {savedMessage}
        </Notice>
      ) : null}
      <StudentSummary student={student} />
      <div className="grid grid-cols-1 items-start gap-x-8 gap-y-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <StudentHistory sales={student.sales} />
        {/* Con otros datos guardados (el país pasa a mayúsculas) el formulario se arma de nuevo. */}
        <StudentForm
          key={JSON.stringify(formValues)}
          mode="edit"
          action={updateStudentAction.bind(null, student.id)}
          initialValues={formValues}
          cancelHref={STUDENTS_PATH}
        />
      </div>
    </AdminShell>
  );
}
