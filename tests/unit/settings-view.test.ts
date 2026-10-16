import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  INITIAL_SETTINGS_FORM_STATE,
  settingsToFormValues,
} from "@/admin/settings/form-state";
import { saveSettingsForm } from "@/admin/settings/save-settings";
import { getMonotributoSettings } from "@/admin/settings/read";
import { ARCA_MONOTRIBUTO_URL, SettingsView } from "@/admin/settings/settings-view";
import { createTestDb } from "../helpers/db";

async function noop() {
  return INITIAL_SETTINGS_FORM_STATE;
}

function render(props: Partial<Parameters<typeof SettingsView>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(SettingsView, {
      current: null,
      updatedAt: null,
      justSaved: false,
      action: noop,
      ...props,
    }),
  );
}

const CURRENT = { category: "D", annualCapArsMinor: 2_600_000_050, validFrom: "2026-08-01" };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("settingsToFormValues", () => {
  test("shows what was saved as the person would type it", () => {
    expect(settingsToFormValues(CURRENT)).toEqual({
      category: "D",
      annualCapArs: "26000000,50",
      validFrom: "2026-08-01",
    });
  });

  test("starts empty without a saved configuration", () => {
    expect(settingsToFormValues(null)).toEqual({ category: "", annualCapArs: "", validFrom: "" });
  });
});

describe("SettingsView", () => {
  test("offers the three fields with a category from A to K", () => {
    const markup = render();

    expect(markup).toContain('name="category"');
    expect(markup).toContain('name="annualCapArs"');
    expect(markup).toContain('name="validFrom"');
    for (const letter of ["A", "C", "K"]) expect(markup).toContain(`>Categoría ${letter}</option>`);
    expect(markup).not.toContain(">Categoría L</option>");
    expect(markup).toContain("Guardar configuración");
  });

  test("loads what was saved into the fields", () => {
    const markup = render({ current: CURRENT, updatedAt: new Date("2026-10-15T17:30:00.000Z") });

    expect(markup).toContain('value="26000000,50"');
    expect(markup).toContain('value="2026-08-01"');
    expect(markup).toMatch(/<option[^>]*value="D"[^>]*selected/);
  });

  test("says when it was last updated, in Argentine time", () => {
    const markup = render({ current: CURRENT, updatedAt: new Date("2026-10-15T17:30:00.000Z") });

    expect(markup).toContain("Última actualización: 15/10/2026, 14:30");
  });

  test("an update just after midnight UTC is still the day before in Argentina", () => {
    const markup = render({ current: CURRENT, updatedAt: new Date("2026-10-16T01:15:00.000Z") });

    expect(markup).toContain("Última actualización: 15/10/2026, 22:15");
  });

  test("without anything saved, says so", () => {
    expect(render()).toContain("Todavía no cargaste nada");
    expect(render()).not.toContain("Última actualización");
  });

  test("links to the table at ARCA in a new tab, safely, and never presents the cap as official", () => {
    const markup = render();

    expect(ARCA_MONOTRIBUTO_URL).toBe("https://www.arca.gob.ar/monotributo/categorias.asp");
    expect(markup).toContain(`href="${ARCA_MONOTRIBUTO_URL}"`);
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain("Ver la tabla vigente en ARCA");
    expect(markup).toContain("Estos datos los cargás vos");
    expect(markup).toContain("no los consulta en ARCA");
    expect(markup).toContain("Confirmá con él");
  });

  test("the saved notice points to the meter in Facturación", () => {
    const markup = render({ justSaved: true });

    expect(markup).toContain("Configuración guardada.");
    expect(markup).toContain('href="/admin/facturacion"');
    expect(render()).not.toContain("Configuración guardada.");
  });
});

describe("saveSettingsForm", () => {
  test("saves the form and the monotributo is there to read", async () => {
    const db = await createTestDb();

    const outcome = await saveSettingsForm(
      db,
      form({ category: "B", annualCapArs: "10.000.000,00", validFrom: "2026-02-01" }),
    );

    expect(outcome).toEqual({ saved: true });
    expect(await getMonotributoSettings(db)).toEqual({
      category: "B",
      annualCapArsMinor: 1_000_000_000,
      validFrom: "2026-02-01",
    });
  });

  test("gives a message per wrong field and writes nothing", async () => {
    const db = await createTestDb();

    const outcome = await saveSettingsForm(db, form({ category: "", annualCapArs: "x", validFrom: "" }));

    expect(outcome.saved).toBe(false);
    if (outcome.saved) return;
    expect(Object.keys(outcome.state.fieldErrors).sort()).toEqual(["annualCapArs", "category", "validFrom"]);
    expect(outcome.state.formError).toBe("Revisá los campos marcados.");
    expect(await getMonotributoSettings(db)).toBeNull();
  });

  test("fields that are missing or are files are refused", async () => {
    const db = await createTestDb();
    const data = form({ category: "C", validFrom: "2026-08-01" });
    data.set("annualCapArs", new File(["1"], "tope.txt"));

    const outcome = await saveSettingsForm(db, data);

    expect(outcome.saved).toBe(false);
    expect(await getMonotributoSettings(db)).toBeNull();
  });
});
