// Ayudas de los e2e del portal que manejan el panel de Tallami: cargar entregas en la ficha de una
// venta e invitar a un alumno desde su ficha. Las usan los e2e de las entregas del panel
// (`portal-deliveries-admin.spec.ts`) y los de la página del alumno (`portal-page.spec.ts`).

import type { Page } from "@playwright/test";
import { expect } from "./admin";
import { URL_SAFE_32_BYTES } from "./portal-e2e";

/** Bytes que empiezan como un PDF, del tamaño pedido. */
export function pdfFile(name: string, size = 300) {
  const buffer = Buffer.alloc(size);
  buffer.write("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
  return { name, mimeType: "application/pdf", buffer };
}

/** La tarjeta "Entregas" de la ficha de la venta que se ve ahora. */
export function deliveriesCard(page: Page) {
  return page.getByRole("region", { name: "Entregas", exact: true });
}

export function addDeliveryForm(page: Page) {
  return deliveriesCard(page).getByRole("form", { name: "Agregar una entrega" });
}

export function deliveryItems(page: Page) {
  return deliveriesCard(page).getByRole("list", { name: "Entregas de esta venta" }).getByRole("listitem");
}

/**
 * Abre la ficha de la venta del alumno `student` y espera a que la tarjeta esté lista para usarse.
 * Si el alumno tiene más de una venta, `rowText` elige la fila (por ejemplo, el nombre del servicio).
 */
export async function openSale(page: Page, student: string, rowText?: string): Promise<void> {
  await page.goto(`/admin/ventas?q=${encodeURIComponent(student)}`);
  const row = page.getByRole("row").filter({ hasText: student });
  await (rowText ? row.filter({ hasText: rowText }) : row).getByRole("link", { name: student }).click();
  await expect(page.getByRole("heading", { name: "Editar venta" })).toBeVisible();
  await expect(addDeliveryForm(page).getByRole("button", { name: "Agregar entrega" })).toBeEnabled();
}

export interface NewDelivery {
  kind: "youtube" | "pdf" | "link";
  title: string;
  url?: string;
  file?: ReturnType<typeof pdfFile>;
}

/** Llena el formulario y lo envía; no espera el resultado. */
export async function submitDelivery(page: Page, delivery: NewDelivery): Promise<void> {
  const form = addDeliveryForm(page);
  await form.getByLabel("Tipo", { exact: true }).selectOption(delivery.kind);
  await form.getByLabel("Título", { exact: true }).fill(delivery.title);
  if (delivery.kind === "pdf") {
    if (delivery.file) await form.getByLabel("Archivo PDF", { exact: true }).setInputFiles(delivery.file);
  } else {
    await form.getByLabel("Link", { exact: true }).fill(delivery.url ?? "");
  }
  await form.getByRole("button", { name: "Agregar entrega" }).click();
}

/** Agrega una entrega y espera a verla en la lista. */
export async function addDelivery(page: Page, delivery: NewDelivery): Promise<void> {
  const before = await deliveryItems(page).count();
  await submitDelivery(page, delivery);
  await expect(deliveriesCard(page).getByText("Entrega agregada. El alumno la ve en su portal.")).toBeVisible();
  await expect(deliveryItems(page)).toHaveCount(before + 1);
}

/** La dirección donde se abre la entrega `title` de la lista. */
export async function deliveryHref(page: Page, title: string): Promise<string> {
  const href = await deliveryItems(page)
    .filter({ hasText: title })
    .getByRole("link", { name: new RegExp(`^Abrir ${title}`) })
    .getAttribute("href");
  expect(href).not.toBeNull();
  return href ?? "";
}

/** Da de alta un alumno por el formulario (sin ventas) y espera a estar en su ficha. Devuelve su dirección. */
export async function createStudent(page: Page, name: string): Promise<string> {
  await page.goto("/admin/alumnos/nuevo");
  const form = page.getByRole("form", { name: "Datos del alumno" });
  await expect(form).toHaveAttribute("data-hydrated", "true");
  await form.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Guardar alumno" }).click();
  await expect(page).toHaveURL(/\/admin\/alumnos\/[0-9a-f-]{36}\?guardado=creado$/);
  return new URL(page.url()).pathname;
}

/**
 * Desde la ficha del alumno `name` (que ya tiene al menos una venta), genera su invitación al portal
 * y devuelve el token del link, que se ve una sola vez.
 */
export async function inviteStudent(page: Page, name: string): Promise<string> {
  await page.goto(`/admin/alumnos?q=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name }).first().click();
  const portal = page.getByRole("region", { name: "Portal del alumno" });
  await portal.getByRole("button", { name: "Invitar al portal" }).click();
  const link = portal.getByLabel("Link de invitación");
  await expect(link).toBeVisible();
  const token = new URL(await link.inputValue()).searchParams.get("invitacion") ?? "";
  expect(token).toMatch(URL_SAFE_32_BYTES);
  return token;
}
