import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { INITIAL_INVOICING_FORM_STATE } from "@/admin/billing/form-state";
import { MAX_INVOICE_NUMBER_LENGTH } from "@/admin/billing/limits";
import { BillingView } from "@/admin/billing/billing-view";
import { buildBilling } from "@/admin/billing/billing-data";
import { markInvoicedSchema } from "@/admin/billing/schema";
import { EMPTY_STUDENT_FORM_VALUES, INITIAL_STUDENT_FORM_STATE } from "@/admin/customers/form-state";
import {
  COUNTRY_CODE_LENGTH,
  MAX_DISCORD_LENGTH,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
} from "@/admin/customers/limits";
import { customerInputSchema } from "@/admin/customers/schema";
import { StudentForm } from "@/admin/customers/student-form";
import { MAX_SEARCH_LENGTH } from "@/admin/limits";
import { emptySaleFormValues } from "@/admin/sales/form-values";
import { MAX_DESCRIPTION_LENGTH, MAX_SALE_NOTES_LENGTH } from "@/admin/sales/limits";
import { SaleForm } from "@/admin/sales/sale-form";
import { saleInputSchema } from "@/admin/sales/schema";
import { SettingsView } from "@/admin/settings/settings-view";
import { INITIAL_SETTINGS_FORM_STATE } from "@/admin/settings/form-state";
import { NOW } from "../helpers/metric-sales";
import { saleRow } from "../helpers/sale-rows";

const NO_JAVASCRIPT_NOTE = "Activá JavaScript para guardar";

async function noopSale() {
  return { fieldErrors: {}, needsManualRate: false };
}
async function noopStudent() {
  return INITIAL_STUDENT_FORM_STATE;
}
async function noopSettings() {
  return INITIAL_SETTINGS_FORM_STATE;
}
async function noopInvoicing() {
  return INITIAL_INVOICING_FORM_STATE;
}

function saleForm(overrides: Partial<ReturnType<typeof emptySaleFormValues>> = {}): string {
  return renderToStaticMarkup(
    createElement(SaleForm, {
      mode: "create",
      action: noopSale,
      initialValues: { ...emptySaleFormValues("2026-10-16", false), item: "other", ...overrides },
      priceListUsd: {},
    }),
  );
}

function studentForm(savedNotice?: string): string {
  return renderToStaticMarkup(
    createElement(StudentForm, {
      mode: "edit",
      action: noopStudent,
      initialValues: EMPTY_STUDENT_FORM_VALUES,
      cancelHref: "/admin/alumnos",
      ...(savedNotice === undefined ? {} : { savedNotice }),
    }),
  );
}

function settingsView(justSaved: boolean): string {
  return renderToStaticMarkup(
    createElement(SettingsView, { current: null, updatedAt: null, justSaved, action: noopSettings }),
  );
}

function billingView(): string {
  const data = buildBilling({
    uninvoiced: { rows: [saleRow()], truncated: false },
    sales: [],
    settings: null,
    now: NOW,
  });
  return renderToStaticMarkup(createElement(BillingView, { data, invoiceAction: noopInvoicing }));
}

/** El `maxLength` del campo `name` (un `input` o un `textarea`), o `null` si no tiene. */
function maxLengthOf(markup: string, name: string): number | null {
  const tag = new RegExp(String.raw`<(?:input|textarea)[^>]*\sname="${name}"[^>]*>`).exec(markup)?.[0];
  if (!tag) throw new Error(`No hay un campo ${name} en el formulario.`);
  const value = /maxlength="(\d+)"/i.exec(tag)?.[1];
  return value === undefined ? null : Number(value);
}

describe("forms whose button waits for the page to be ready", () => {
  test.each([
    ["the sale form", saleForm],
    ["the student form", () => studentForm()],
    ["the settings form", () => settingsView(false)],
    ["the list of sales to invoice", billingView],
  ])("%s says what to do when JavaScript is off", (_label, render) => {
    const markup = render();

    expect(markup).toMatch(new RegExp(`<noscript>[\\s\\S]*${NO_JAVASCRIPT_NOTE}[\\s\\S]*</noscript>`));
  });

  test("the note is short and sits next to the button it explains", () => {
    const markup = saleForm();
    const note = markup.indexOf(NO_JAVASCRIPT_NOTE);
    const button = markup.indexOf("Guardar venta");

    expect(markup.match(/<noscript>/g)).toHaveLength(1);
    expect(Math.abs(button - note)).toBeLessThan(600);
  });
});

describe("maxLength in the forms is what the server accepts", () => {
  test("a new student in the sale form: name, Discord and country", () => {
    const markup = saleForm({ customerMode: "new" });

    expect(maxLengthOf(markup, "customerName")).toBe(MAX_NAME_LENGTH);
    expect(maxLengthOf(markup, "customerDiscord")).toBe(MAX_DISCORD_LENGTH);
    expect(maxLengthOf(markup, "customerCountry")).toBe(COUNTRY_CODE_LENGTH);
    expect([MAX_NAME_LENGTH, MAX_DISCORD_LENGTH, COUNTRY_CODE_LENGTH]).toEqual([120, 64, 2]);
  });

  test("the description and the notes of the sale", () => {
    const markup = saleForm();

    expect(maxLengthOf(markup, "description")).toBe(MAX_DESCRIPTION_LENGTH);
    expect(maxLengthOf(markup, "notes")).toBe(MAX_SALE_NOTES_LENGTH);
    expect([MAX_DESCRIPTION_LENGTH, MAX_SALE_NOTES_LENGTH]).toEqual([200, 2000]);
  });

  test("the student form", () => {
    const markup = studentForm();

    expect(maxLengthOf(markup, "name")).toBe(MAX_NAME_LENGTH);
    expect(maxLengthOf(markup, "discord")).toBe(MAX_DISCORD_LENGTH);
    expect(maxLengthOf(markup, "country")).toBe(COUNTRY_CODE_LENGTH);
    expect(maxLengthOf(markup, "notes")).toBe(MAX_NOTES_LENGTH);
  });

  test("the invoice number", () => {
    expect(maxLengthOf(billingView(), "number")).toBe(MAX_INVOICE_NUMBER_LENGTH);
  });

  test("the student search of the sale form", () => {
    const markup = saleForm({ customerMode: "existing" });

    expect(markup).toMatch(new RegExp(`role="combobox"[^>]*maxLength="${MAX_SEARCH_LENGTH}"`, "i"));
  });

  test("the server accepts exactly those lengths and refuses one more", () => {
    const sale = (customer: Record<string, unknown>, rest: Record<string, unknown> = {}) =>
      saleInputSchema.safeParse({
        customer: { mode: "new", name: "Ana", ...customer },
        item: "other",
        description: "Algo",
        currency: "USD",
        amount: "40",
        paymentMethod: "transfer",
        status: "paid",
        paidOn: "2026-10-12",
        rateMode: "auto",
        ...rest,
      }).success;

    expect(sale({ name: "n".repeat(MAX_NAME_LENGTH) })).toBe(true);
    expect(sale({ name: "n".repeat(MAX_NAME_LENGTH + 1) })).toBe(false);
    expect(sale({ discord: "d".repeat(MAX_DISCORD_LENGTH) })).toBe(true);
    expect(sale({ discord: "d".repeat(MAX_DISCORD_LENGTH + 1) })).toBe(false);
    expect(sale({ country: "AR" })).toBe(true);
    expect(sale({ country: "ARG" })).toBe(false);
    expect(sale({}, { description: "d".repeat(MAX_DESCRIPTION_LENGTH) })).toBe(true);
    expect(sale({}, { description: "d".repeat(MAX_DESCRIPTION_LENGTH + 1) })).toBe(false);
    expect(sale({}, { notes: "n".repeat(MAX_SALE_NOTES_LENGTH) })).toBe(true);
    expect(sale({}, { notes: "n".repeat(MAX_SALE_NOTES_LENGTH + 1) })).toBe(false);

    const student = (fields: Record<string, unknown>) => customerInputSchema.safeParse({ name: "Ana", ...fields }).success;
    expect(student({ notes: "n".repeat(MAX_NOTES_LENGTH) })).toBe(true);
    expect(student({ notes: "n".repeat(MAX_NOTES_LENGTH + 1) })).toBe(false);

    const invoice = (number: string) =>
      markInvoicedSchema.safeParse({
        ids: ["8f4f3f64-7c5c-4a43-9d4c-3f6a3a2f1b10"],
        type: "C",
        number,
        issuedOn: "2026-10-12",
      }).success;
    expect(invoice("1".repeat(MAX_INVOICE_NUMBER_LENGTH))).toBe(true);
    expect(invoice("1".repeat(MAX_INVOICE_NUMBER_LENGTH + 1))).toBe(false);
  });
});

describe("the notice of a save that went well lives inside the form", () => {
  test("the student form shows it when it is given one, as a status", () => {
    const markup = studentForm("Cambios guardados.");

    expect(markup).toMatch(/role="status"[^>]*>Cambios guardados\./);
    expect(markup.indexOf("Cambios guardados.")).toBeLessThan(markup.indexOf("Datos del alumno"));
  });

  test("and says nothing without one", () => {
    expect(studentForm()).not.toContain("Cambios guardados.");
  });

  test("the settings form shows its notice with the link to the meter, and nothing otherwise", () => {
    const markup = settingsView(true);

    expect(markup).toMatch(/role="status"[^>]*>Configuración guardada\./);
    expect(markup).toContain('href="/admin/facturacion"');
    expect(markup.indexOf("Configuración guardada.")).toBeGreaterThan(markup.indexOf("<form"));
    expect(settingsView(false)).not.toContain("Configuración guardada.");
  });
});
