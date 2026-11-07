import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { MOCK_MERCADOPAGO_URL } from "../helpers/checkout-e2e";
import { newStudentBrowser } from "../helpers/portal-e2e";
import en from "../../messages/en.json" with { type: "json" };
import es from "../../messages/es.json" with { type: "json" };
import pt from "../../messages/pt.json" with { type: "json" };

// Arrepentimiento, baja y contacto de punta a punta: los dos botones están en el pie de las tres
// portadas, el pedido muestra su código y manda el email, y el panel lo lista, lo atiende y lo borra.
// Los tests corren en paralelo sobre la misma base: cada uno usa un nombre y un email propios.

const SCRIPT = "<script>document.title='hackeado'</script>";
const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const CATALOGS = { es, pt, en } as const;

/** Los emails que el servidor falso de Resend recibió para `address`. */
async function emailsTo(request: APIRequestContext, address: string): Promise<{ subject: string; text: string }[]> {
  const response = await request.get(`${MOCK_MERCADOPAGO_URL}/test/emails`);
  const emails = (await response.json()) as { to: string | string[]; subject: string; text: string }[];
  return emails.filter(({ to }) => [to].flat().includes(address));
}

async function fillRequest(page: Page, name: string, email: string, message: string): Promise<void> {
  await page.getByLabel(es.SiteRequests.form.name, { exact: true }).fill(name);
  await page.getByLabel(es.SiteRequests.form.email, { exact: true }).fill(email);
  await page.getByLabel(/^Mensaje/).fill(message);
}

for (const locale of ["es", "pt", "en"] as const) {
  test(`the footer of /${locale} has both legal buttons with the exact name, without signing in, and no email`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "BOTÓN DE ARREPENTIMIENTO", exact: true })).toHaveAttribute("href", `/${locale}/arrepentimiento`);
    await expect(footer.getByRole("link", { name: "BOTÓN DE BAJA DE SERVICIO", exact: true })).toHaveAttribute("href", `/${locale}/baja`);
    await expect(footer.getByRole("link", { name: CATALOGS[locale].Footer.contact, exact: true })).toHaveAttribute("href", `/${locale}/contacto`);
    expect(await footer.innerText()).not.toMatch(EMAIL_ADDRESS);
  });
}

test("a withdrawal shows its code, emails the requester, and the panel lists, handles and deletes it", async ({ page, browser, request }) => {
  const name = `Ana ${randomUUID().slice(0, 8)}`;
  const email = `${randomUUID().slice(0, 8)}@example.com`;
  await page.goto("/es/arrepentimiento");
  await fillRequest(page, name, email, SCRIPT);
  await page.getByRole("button", { name: es.SiteRequests.withdrawal.submit }).click();

  const code = (await page.getByTestId("request-code").innerText()).trim();
  expect(code).toMatch(/^ARR-[A-HJ-NP-Z2-9]{6}$/);
  await expect.poll(async () => (await emailsTo(request, email)).length).toBe(1);
  const [receipt] = await emailsTo(request, email);
  expect(receipt.text).toContain(code);
  expect(receipt.text).not.toMatch(/[\w.+-]+@tallami/i);

  const panel = await newStudentBrowser(browser);
  try {
    await loginAsAdmin(panel.page);
    await panel.page.goto("/admin/pedidos");
    const card = panel.page.getByTestId("site-request").filter({ hasText: code });
    await expect(card.getByText("Nuevo")).toBeVisible();
    await expect(card.getByText("Email salido")).toBeVisible();
    await expect(card.getByText(SCRIPT)).toBeVisible();
    expect(await panel.page.title()).not.toBe("hackeado");

    await card.getByRole("button", { name: /Marcar atendido/ }).click();
    await expect(panel.page.getByText("Pedido marcado como atendido.")).toBeVisible();
    await expect(card.getByText("Atendido", { exact: true }).first()).toBeVisible();

    await card.getByRole("button", { name: /^Borrar/ }).click();
    await card.getByRole("button", { name: "Sí, borrarlo" }).click();
    await expect(panel.page.getByText("Pedido borrado.")).toBeVisible();
    await expect(panel.page.getByTestId("site-request").filter({ hasText: code })).toHaveCount(0);
  } finally {
    await panel.context.close();
  }
});

test("a cancellation request returns a BAJ code and a contact message a CON code", async ({ page }) => {
  await page.goto("/es/baja");
  await fillRequest(page, `Beto ${randomUUID().slice(0, 8)}`, `${randomUUID().slice(0, 8)}@example.com`, "");
  await page.getByRole("button", { name: es.SiteRequests.cancellation.submit }).click();
  expect((await page.getByTestId("request-code").innerText()).trim()).toMatch(/^BAJ-[A-HJ-NP-Z2-9]{6}$/);

  await page.goto("/es/contacto");
  await fillRequest(page, `Cami ${randomUUID().slice(0, 8)}`, `${randomUUID().slice(0, 8)}@example.com`, "Una consulta.");
  await page.getByRole("button", { name: es.SiteRequests.contact.submit }).click();
  expect((await page.getByTestId("request-code").innerText()).trim()).toMatch(/^CON-[A-HJ-NP-Z2-9]{6}$/);
});

test("the contact page shows the published hours in each language", async ({ page }) => {
  await page.goto("/es/contacto");
  await expect(page.getByText("lunes a viernes, de 10 a 18, hora de Argentina")).toBeVisible();
  await page.goto("/pt/contacto");
  await expect(page.getByText(pt.SiteRequests.hours)).toBeVisible();
  await page.goto("/en/contacto");
  await expect(page.getByText(en.SiteRequests.hours)).toBeVisible();
});

test("the form reports what is missing and keeps what was typed", async ({ page }) => {
  await page.goto("/es/contacto");
  await page.getByLabel(es.SiteRequests.form.name, { exact: true }).fill("Solo el nombre");
  // Sin validación del navegador para probar la del servidor.
  await page.evaluate(() => document.querySelectorAll("[required]").forEach((node) => node.removeAttribute("required")));
  await page.getByLabel(es.SiteRequests.form.email, { exact: true }).fill("a@b");
  await page.getByRole("button", { name: es.SiteRequests.contact.submit }).click();

  await expect(page.getByRole("alert").filter({ hasText: es.SiteRequests.form.summary })).toBeVisible();
  await expect(page.getByLabel(es.SiteRequests.form.name, { exact: true })).toHaveValue("Solo el nombre");
  await expect(page.getByText(es.SiteRequests.errors.invalid)).toBeVisible();
  await expect(page.getByText(es.SiteRequests.errors.required)).toBeVisible();
});

test("the withdrawal page works without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    javaScriptEnabled: false,
    extraHTTPHeaders: { "x-forwarded-for": `10.${Math.floor(Math.random() * 250) + 1}.8.8` },
  });
  const page = await context.newPage();
  try {
    await page.goto("/es/arrepentimiento");
    await fillRequest(page, `Dani ${randomUUID().slice(0, 8)}`, `${randomUUID().slice(0, 8)}@example.com`, "");
    await page.getByRole("button", { name: es.SiteRequests.withdrawal.submit }).click();
    await expect(page.getByTestId("request-code")).toHaveText(/^ARR-/);
  } finally {
    await context.close();
  }
});
