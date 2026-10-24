import type { Metadata } from "next";
import { requireAdmin } from "@/admin/auth/require-admin";
import { EMPTY_STUDENT_FORM_VALUES } from "@/admin/customers/form-state";
import { StudentForm } from "@/admin/customers/student-form";
import { ADMIN_ROUTES } from "@/admin/routes";
import { DRAFT_KEYS } from "@/admin/ui/draft-keys";
import { PageHeader } from "@/admin/ui/page-header";
import { PanelShell } from "@/app/admin/panel-shell";
import { createStudentAction } from "../actions";

export const metadata: Metadata = { title: "Nuevo alumno" };

export default async function NewStudentPage() {
  await requireAdmin();

  return (
    <PanelShell active="students">
      <PageHeader
        title="Nuevo alumno"
        description="Solo el nombre es obligatorio. También se crea un alumno al cargar la venta de alguien nuevo."
      />
      <div className="max-w-[40rem]">
        <StudentForm
          mode="create"
          draftKey={DRAFT_KEYS.newStudent}
          action={createStudentAction}
          initialValues={EMPTY_STUDENT_FORM_VALUES}
          cancelHref={ADMIN_ROUTES.students}
        />
      </div>
    </PanelShell>
  );
}
