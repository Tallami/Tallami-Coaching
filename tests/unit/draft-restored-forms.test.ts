import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { INITIAL_INVOICING_FORM_STATE } from "@/admin/billing/form-state";
import { UninvoicedList } from "@/admin/billing/uninvoiced-list";
import { EMPTY_STUDENT_FORM_VALUES, INITIAL_STUDENT_FORM_STATE } from "@/admin/customers/form-state";
import { StudentForm } from "@/admin/customers/student-form";
import { INITIAL_SETTINGS_FORM_STATE } from "@/admin/settings/form-state";
import { SettingsView } from "@/admin/settings/settings-view";

// Los avisos que traen la dirección después de guardar («Alumno guardado.», «Configuración guardada.», «2 ventas
// marcadas como facturadas.») no pueden verse sobre un formulario que recuperó lo escrito en una sesión que se
// cerró: esos datos no se guardaron. Se simula el gancho de los borradores para dibujar los formularios con y
// sin lo recuperado.

const draft = vi.hoisted(() => ({ restored: false }));
vi.mock("@/admin/ui/form-draft", () => ({
  useFormDraft: () => ({ restored: draft.restored, discard: () => {} }),
}));

const RESTORED_NOTICE = "recuperamos lo que habías escrito";

beforeEach(() => {
  draft.restored = false;
});

function studentForm(): string {
  return renderToStaticMarkup(
    createElement(StudentForm, {
      mode: "edit",
      draftKey: "alumno:a1",
      action: async () => INITIAL_STUDENT_FORM_STATE,
      initialValues: EMPTY_STUDENT_FORM_VALUES,
      cancelHref: "/admin/alumnos",
      savedNotice: "Cambios guardados.",
    }),
  );
}

function settingsForm(): string {
  return renderToStaticMarkup(
    createElement(SettingsView, {
      current: null,
      updatedAt: null,
      justSaved: true,
      action: async () => INITIAL_SETTINGS_FORM_STATE,
    }),
  );
}

function uninvoicedList(): string {
  return renderToStaticMarkup(
    createElement(UninvoicedList, {
      groups: [],
      today: "2026-10-21",
      action: async () => INITIAL_INVOICING_FORM_STATE,
      savedNotice: "2 ventas marcadas como facturadas.",
    }),
  );
}

const FORMS = [
  ["the student form", studentForm, "Cambios guardados."],
  ["the settings form", settingsForm, "Configuración guardada."],
  ["the list of sales to invoice", uninvoicedList, "2 ventas marcadas como facturadas."],
] as const;

describe.each(FORMS)("%s", (_label, render, savedNotice) => {
  test("shows the saved notice from the address when nothing was recovered", () => {
    const markup = render();

    expect(markup).toContain(savedNotice);
    expect(markup).not.toContain(RESTORED_NOTICE);
  });

  test("shows only the recovered-data notice once it recovered what was typed", () => {
    draft.restored = true;

    const markup = render();

    expect(markup).toContain(RESTORED_NOTICE);
    expect(markup).not.toContain(savedNotice);
  });
});
