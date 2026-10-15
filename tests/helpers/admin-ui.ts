// Ayudas de los e2e del panel para manejar la interfaz: esperar a que una página
// esté lista y cargar ventas por el formulario. Las usan los e2e de ventas y de
// alumnos. Los tests corren en paralelo contra una sola base: cada uno usa
// nombres únicos y mira solo sus propias filas.

import type { Locator, Page } from "@playwright/test";
import { expect } from "./admin";

export const PHONE = { width: 375, height: 812 } as const;

/** Nombre único por test, para mirar solo las filas propias. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Espera a que React haya tomado el elemento (la página ya reacciona a los clics).
 * Un botón que se toca antes de la hidratación no hace nada y el test se quedaría esperando.
 */
export async function whenInteractive(locator: Locator): Promise<void> {
  await expect
    .poll(() => locator.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps"))))
    .toBe(true);
}

export interface SaleDraft {
  student: string;
  item?: string;
  currency?: string;
  amount?: string;
  paymentMethod?: string;
  status?: string;
  paidOn?: string;
}

/** Abre el formulario de alta de una venta y espera a que esté listo para usarse. */
export async function openNewSale(page: Page): Promise<void> {
  await page.goto("/admin/ventas/nueva");
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
}

/** Completa el formulario con un alumno nuevo; deja sin tocar lo que el borrador no define. */
export async function fillSale(page: Page, draft: SaleDraft): Promise<void> {
  await page.getByRole("radio", { name: "Alumno nuevo" }).check();
  await page.getByLabel("Nombre", { exact: true }).fill(draft.student);
  await fillSaleDetails(page, draft);
}

/** Completa los datos de la venta (todo menos el alumno). */
async function fillSaleDetails(page: Page, draft: Omit<SaleDraft, "student">): Promise<void> {
  if (draft.item) await page.getByLabel("Servicio", { exact: true }).selectOption(draft.item);
  if (draft.currency) await page.getByLabel("Moneda", { exact: true }).selectOption(draft.currency);
  if (draft.amount !== undefined) await page.getByLabel("Monto", { exact: true }).fill(draft.amount);
  if (draft.paymentMethod) {
    await page.getByLabel("Medio de pago", { exact: true }).selectOption(draft.paymentMethod);
  }
  if (draft.status) await page.getByLabel("Estado", { exact: true }).selectOption(draft.status);
  if (draft.paidOn !== undefined) {
    await page.getByLabel("Fecha de cobro", { exact: true }).fill(draft.paidOn);
  }
}

/** Carga una venta completa de un alumno nuevo y espera a volver a la lista. */
export async function createSale(page: Page, draft: SaleDraft): Promise<void> {
  await openNewSale(page);
  await fillSale(page, { item: "lesson", paymentMethod: "transfer", status: "paid", ...draft });
  await page.getByRole("button", { name: "Guardar venta" }).click();
  await expect(page).toHaveURL(/\/admin\/ventas\?guardada=creada$/);
}

/** Carga una venta para un alumno que ya existe (lo elige con el buscador) y espera a volver a la lista. */
export async function createSaleForExisting(page: Page, draft: SaleDraft): Promise<void> {
  await openNewSale(page);
  await page.getByRole("radio", { name: "Alumno existente" }).check();
  await page.getByRole("combobox", { name: "Buscar alumno" }).fill(draft.student);
  await page.getByRole("option", { name: new RegExp(draft.student) }).click();
  await expect(page.getByRole("button", { name: "Cambiar alumno" })).toBeVisible();
  await fillSaleDetails(page, { item: "lesson", paymentMethod: "transfer", status: "paid", ...draft });
  await page.getByRole("button", { name: "Guardar venta" }).click();
  await expect(page).toHaveURL(/\/admin\/ventas\?guardada=creada$/);
}
