// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { readFormFields, writeFormFields } from "@/admin/ui/draft-fields";

// Qué se guarda de un formulario y cómo se vuelve a poner. Se lee y se escribe sobre el
// DOM (con eventos, para que React se entere en los formularios del panel): texto, número,
// fecha, lista, opciones y casillas. Contraseñas, archivos y códigos nunca se guardan.

function formFrom(html: string): HTMLFormElement {
  document.body.innerHTML = `<form>${html}</form>`;
  return document.querySelector("form") as HTMLFormElement;
}

const FULL_FORM = `
  <input name="customerName" type="text" value="">
  <input name="amount" inputmode="decimal" value="">
  <input name="quantity" type="number" value="">
  <input name="paidOn" type="date" value="">
  <input name="dueAt" type="datetime-local" value="">
  <textarea name="notes"></textarea>
  <select name="item">
    <option value="">Elegí</option>
    <option value="lesson">Clase</option>
    <option value="vod">VOD</option>
  </select>
  <input type="radio" name="rateMode" value="auto" checked>
  <input type="radio" name="rateMode" value="manual">
  <input type="checkbox" name="ids" value="s1">
  <input type="checkbox" name="ids" value="s2">
  <input type="checkbox" name="ids" value="s3">
`;

function type(form: HTMLFormElement, name: string, value: string): void {
  (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value = value;
}

function check(form: HTMLFormElement, name: string, value: string): void {
  const control = Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)).find(
    (input) => input.value === value,
  );
  if (!control) throw new Error(`No hay ${name}=${value}`);
  control.checked = true;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("readFormFields", () => {
  test("reads text, number, date, date and time, long text, a list, a radio group and checkboxes", () => {
    const form = formFrom(FULL_FORM);
    type(form, "customerName", "Ana Pérez");
    type(form, "amount", "1.234,56");
    type(form, "quantity", "3");
    type(form, "paidOn", "2026-10-20");
    type(form, "dueAt", "2026-10-21T15:30");
    type(form, "notes", "Dos líneas\nde notas");
    type(form, "item", "lesson");
    check(form, "rateMode", "manual");
    check(form, "ids", "s1");
    check(form, "ids", "s3");

    expect(readFormFields(form)).toEqual([
      ["customerName", "Ana Pérez"],
      ["amount", "1.234,56"],
      ["quantity", "3"],
      ["paidOn", "2026-10-20"],
      ["dueAt", "2026-10-21T15:30"],
      ["notes", "Dos líneas\nde notas"],
      ["item", "lesson"],
      ["rateMode", "manual"],
      ["ids", "s1"],
      ["ids", "s3"],
    ]);
  });

  test("keeps an empty text field and leaves out the unchecked boxes", () => {
    const form = formFrom(FULL_FORM);

    const fields = readFormFields(form);

    expect(fields).toContainEqual(["amount", ""]);
    expect(fields.filter(([name]) => name === "ids")).toEqual([]);
  });

  test("never keeps passwords, files or fields whose name has `code`", () => {
    const form = formFrom(`
      <input name="name" value="Ana">
      <input name="password" type="password" value="secreta">
      <input name="newPassword" type="password" value="otra">
      <input name="proof" type="file">
      <input name="code" value="ABCD234567">
      <input name="enrollmentCode" value="ABCD234567">
      <input name="otp_CODE" value="123456">
      <input name="pin" autocomplete="one-time-code" value="123456">
    `);

    expect(readFormFields(form)).toEqual([["name", "Ana"]]);
  });

  test("leaves out what the form would not send: no name, disabled, buttons and hidden fields", () => {
    const form = formFrom(`
      <input name="kept" value="sí">
      <input value="sin nombre">
      <input name="off" value="no" disabled>
      <input type="hidden" name="next" value="/admin">
      <input type="submit" name="intent" value="invoiced">
      <button type="submit" name="other" value="x">Enviar</button>
      <input type="search" value="buscador">
    `);

    expect(readFormFields(form)).toEqual([["kept", "sí"]]);
  });

  test("keeps a hidden field only when the form marks it as part of the draft", () => {
    const form = formFrom(`
      <input type="hidden" name="customerId" value="c-1" data-draft>
      <input type="hidden" name="next" value="/admin">
    `);

    expect(readFormFields(form)).toEqual([["customerId", "c-1"]]);
  });
});

describe("writeFormFields", () => {
  test("puts back text, number, date, date and time, long text, a list, a radio group and checkboxes", () => {
    const form = formFrom(FULL_FORM);
    const fields = [
      ["customerName", "Ana Pérez"],
      ["amount", "1.234,56"],
      ["quantity", "3"],
      ["paidOn", "2026-10-20"],
      ["dueAt", "2026-10-21T15:30"],
      ["notes", "Dos líneas\nde notas"],
      ["item", "vod"],
      ["rateMode", "manual"],
      ["ids", "s1"],
      ["ids", "s3"],
    ] as const;

    writeFormFields(form, fields);

    expect(readFormFields(form)).toEqual(fields);
    expect((form.querySelector('input[name="ids"][value="s2"]') as HTMLInputElement).checked).toBe(false);
    expect((form.querySelector('input[name="rateMode"][value="auto"]') as HTMLInputElement).checked).toBe(false);
  });

  test("unchecks the boxes the draft does not have", () => {
    const form = formFrom(FULL_FORM);
    check(form, "ids", "s1");
    check(form, "ids", "s2");

    writeFormFields(form, [["ids", "s2"]]);

    expect(readFormFields(form).filter(([name]) => name === "ids")).toEqual([["ids", "s2"]]);
  });

  test("tells how many controls it changed, and zero when everything was already there", () => {
    const form = formFrom(FULL_FORM);
    const fields = [
      ["customerName", "Ana"],
      ["item", "lesson"],
      ["ids", "s2"],
    ] as const;

    expect(writeFormFields(form, fields)).toBe(3);
    expect(writeFormFields(form, fields)).toBe(0);
  });

  test("leaves alone the fields the draft knows nothing about", () => {
    const form = formFrom(FULL_FORM);
    type(form, "notes", "lo que había");

    writeFormFields(form, [["customerName", "Ana"]]);

    expect((form.elements.namedItem("notes") as HTMLTextAreaElement).value).toBe("lo que había");
  });

  test("ignores a list value that is not an option any more, and a box or radio that is gone", () => {
    const form = formFrom(FULL_FORM);
    type(form, "item", "vod");

    const changed = writeFormFields(form, [
      ["item", "servicio-viejo"],
      ["ids", "s-que-ya-no-esta"],
      ["rateMode", "otro-modo"],
    ]);

    expect(changed).toBe(0);
    expect((form.elements.namedItem("item") as HTMLSelectElement).value).toBe("vod");
  });

  test("never writes into passwords, files, codes or fields it does not save", () => {
    const form = formFrom(`
      <input name="password" type="password" value="">
      <input name="code" value="">
      <input name="next" type="hidden" value="/admin">
    `);

    const changed = writeFormFields(form, [
      ["password", "secreta"],
      ["code", "ABCD234567"],
      ["next", "/otro-lado"],
    ]);

    expect(changed).toBe(0);
    expect((form.elements.namedItem("password") as HTMLInputElement).value).toBe("");
    expect((form.elements.namedItem("code") as HTMLInputElement).value).toBe("");
    expect((form.elements.namedItem("next") as HTMLInputElement).value).toBe("/admin");
  });

  test("announces each change the way a person's typing would, so React hears it", () => {
    const form = formFrom(FULL_FORM);
    const heard: string[] = [];
    for (const eventType of ["input", "change", "click"] as const) {
      form.addEventListener(eventType, (event) => {
        const target = event.target as HTMLInputElement;
        heard.push(`${eventType}:${target.name}`);
      });
    }

    writeFormFields(form, [
      ["customerName", "Ana"],
      ["item", "lesson"],
      ["ids", "s1"],
    ]);

    expect(heard).toContain("input:customerName");
    expect(heard).toContain("change:item");
    expect(heard).toContain("click:ids");
  });

  test("a hidden field of the draft is announced with an `input` event", () => {
    const form = formFrom(`<input type="hidden" name="customerId" value="" data-draft>`);
    const heard: string[] = [];
    form.addEventListener("input", (event) => heard.push((event.target as HTMLInputElement).value));

    writeFormFields(form, [["customerId", "c-9"]]);

    expect(heard).toEqual(["c-9"]);
  });

  test("a value the control refuses (a date that is not a date) does not count as a change forever", () => {
    const form = formFrom(`<input name="paidOn" type="date" value="">`);

    expect(writeFormFields(form, [["paidOn", "ayer"]])).toBe(0);
  });
});
