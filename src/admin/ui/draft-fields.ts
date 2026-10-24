// Leer y volver a poner los campos de un formulario, sobre el DOM. Los formularios del panel son
// controlados por React (los valores viven en su estado), así que "volver a poner" un campo no es
// asignarle el valor: hay que avisar como lo haría una persona al escribir, para que React se
// entere y no lo pise en el próximo render.
//
// Qué se guarda: lo que el formulario mandaría (campos con nombre, no desactivados, casillas y
// opciones solo si están marcadas), salvo contraseñas, archivos y todo lo que parezca un código
// (nombre con `code`, o `autocomplete` de código de un solo uso o de contraseña). Los campos
// ocultos no se guardan, salvo los que el formulario marca con `data-draft` (por ejemplo el alumno
// elegido de una venta, que vive en el estado y no en un campo de texto).

import type { DraftField } from "./draft-store";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const NEVER_STORED_INPUT_TYPES = new Set(["password", "file", "submit", "button", "reset", "image"]);
const CODE_NAME = /code/i;
const SECRET_AUTOCOMPLETE = /one-time-code|password/i;

function isControl(element: Element): element is Control {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  );
}

function isToggle(control: Control): control is HTMLInputElement {
  return control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio");
}

function isDraftable(control: Control): boolean {
  if (!control.name || control.disabled) return false;
  if (CODE_NAME.test(control.name) || SECRET_AUTOCOMPLETE.test(control.autocomplete)) return false;
  if (control instanceof HTMLInputElement) {
    if (NEVER_STORED_INPUT_TYPES.has(control.type)) return false;
    if (control.type === "hidden") return control.hasAttribute("data-draft");
  }
  return true;
}

function draftableControls(form: HTMLFormElement): Control[] {
  return Array.from(form.elements).filter(isControl).filter(isDraftable);
}

/** Lo que tiene el formulario ahora, en el orden de la página. */
export function readFormFields(form: HTMLFormElement): DraftField[] {
  return draftableControls(form)
    .filter((control) => !isToggle(control) || control.checked)
    .map((control): DraftField => [control.name, control.value]);
}

/**
 * Cambia el valor como lo haría el navegador al escribir: con el asignador original del tipo de
 * campo (el de la instancia lo vigila React y no vería el cambio) y avisando con `input`
 * (`change` en las listas).
 */
function setValue(control: Control, value: string): boolean {
  const before = control.value;
  if (control instanceof HTMLSelectElement && !Array.from(control.options).some((option) => option.value === value)) {
    return false;
  }
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")?.set;
  if (setter) setter.call(control, value);
  else control.value = value;
  // Un valor que el campo no acepta (una fecha mal escrita) queda como estaba: no es un cambio.
  if (control.value === before) return false;
  const eventType = control instanceof HTMLSelectElement ? "change" : "input";
  control.dispatchEvent(new Event(eventType, { bubbles: true }));
  return true;
}

/**
 * Marca o desmarca con un clic de verdad, que es lo que React escucha en las casillas y las
 * opciones. Una opción no se desmarca sola: solo se marca la que corresponde.
 */
function setChecked(control: HTMLInputElement, wanted: boolean): boolean {
  if (control.checked === wanted) return false;
  if (control.type === "radio" && !wanted) return false;
  control.click();
  return control.checked === wanted;
}

/**
 * Vuelve a poner `fields` en el formulario y dice cuántos campos cambió (cero si todo ya estaba).
 * Lo que el borrador no menciona queda como está, salvo las casillas y opciones, donde no estar es
 * estar desmarcado. Un valor que ya no existe (una opción que se quitó) se ignora.
 */
export function writeFormFields(form: HTMLFormElement, fields: readonly DraftField[]): number {
  const valuesByName = new Map<string, string[]>();
  for (const [name, value] of fields) valuesByName.set(name, [...(valuesByName.get(name) ?? []), value]);

  // Dos campos con el mismo nombre toman los valores guardados en orden.
  const seen = new Map<string, number>();
  let changed = 0;
  for (const control of draftableControls(form)) {
    const values = valuesByName.get(control.name);
    if (isToggle(control)) {
      if (setChecked(control, values?.includes(control.value) ?? false)) changed += 1;
      continue;
    }
    if (values === undefined) continue;
    const position = seen.get(control.name) ?? 0;
    seen.set(control.name, position + 1);
    const value = values[position];
    if (value !== undefined && setValue(control, value)) changed += 1;
  }
  return changed;
}
