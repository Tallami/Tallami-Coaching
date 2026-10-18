"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/admin/auth/require-admin";
import type { StudentFormState } from "@/admin/customers/form-state";
import { saveStudent } from "@/admin/customers/save-student";
import { studentHref } from "@/admin/routes";
import { getDb } from "@/db/client";

/** Después de guardar se vuelve a la ficha del alumno; ella muestra el aviso según `guardado`. */
function studentPath(id: string, saved: "creado" | "editado"): string {
  return `${studentHref(id)}?guardado=${saved}`;
}

/** Alta de un alumno. Las acciones del panel verifican la sesión antes de todo. */
export async function createStudentAction(
  _previous: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  await requireAdmin();
  const outcome = await saveStudent(await getDb(), formData);
  if (!outcome.saved) return outcome.state;
  redirect(studentPath(outcome.id, "creado"));
}

/** Edición del alumno `studentId` (se pasa con `.bind(null, id)`). */
export async function updateStudentAction(
  studentId: string,
  _previous: StudentFormState,
  formData: FormData,
): Promise<StudentFormState> {
  await requireAdmin();
  const outcome = await saveStudent(await getDb(), formData, studentId);
  if (!outcome.saved) return outcome.state;
  redirect(studentPath(outcome.id, "editado"));
}
