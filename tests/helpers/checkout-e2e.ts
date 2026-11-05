// Ayudas de los e2e de la compra: dejar cargado el valor de pesos por dólar, manejar la pantalla de
// confirmación y la de pago del servidor falso (`mock-mercadopago-server.mjs`), y mirar lo que quedó
// en el panel y en el servidor falso. Los tests corren en paralelo sobre la misma base y el mismo
// servidor falso: cada uno mira solo lo de su propio alumno.

import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { expect, loginAsAdmin, test, uniqueTestIp } from "./admin";
import { E2E_PORTS, e2eBaseUrl } from "./admin-server";
import { newStudentBrowser } from "./portal-e2e";
import es from "../../messages/es.json" with { type: "json" };

/** El servidor es compartido y los tests corren en paralelo: nadie carga otro valor que este. */
const SHARED_RATE = "1500";

export const MOCK_MERCADOPAGO_URL = e2eBaseUrl(E2E_PORTS.mercadopago);

/** Los cuatro servicios en el orden de la portada, con lo que valen a 1500 pesos por dólar. */
export const SERVICE_CASES = [
  {
    index: 0,
    slug: "vod-3-partidas",
    name: "VOD review de 3 partidas",
    usd: "USD 30",
    ars: "ARS 45.000",
    unitPrice: "45000",
    panelUsd: "USD 30,00",
    panelArs: "$ 45.000,00",
  },
  {
    index: 1,
    slug: "vod-torneo",
    name: "VOD review de torneo completo",
    usd: "USD 60",
    ars: "ARS 90.000",
    unitPrice: "90000",
    panelUsd: "USD 60,00",
    panelArs: "$ 90.000,00",
  },
  {
    index: 2,
    slug: "vod-en-vivo",
    name: "VOD review en vivo",
    usd: "USD 45",
    ars: "ARS 67.500",
    unitPrice: "67500",
    panelUsd: "USD 45,00",
    panelArs: "$ 67.500,00",
  },
  {
    index: 3,
    slug: "plan-de-juego",
    name: "Plan de juego personalizado",
    usd: "USD 120",
    ars: "ARS 180.000",
    unitPrice: "180000",
    panelUsd: "USD 120,00",
    panelArs: "$ 180.000,00",
  },
] as const;

/** El botón de cada opción de la pantalla de pago del servidor falso. */
export type PaymentChoice = "Aprobar" | "Rechazar" | "Aprobar sin aviso";

/** Guarda los 1500 en el panel, si todavía no hay valor: la pantalla de confirmación lo lee directo de la base. */
export async function ensureSharedRate(browser: Browser): Promise<void> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() },
    // Aunque el test que lo pide navegue sin JavaScript: esto es preparación, y el panel lo necesita.
    javaScriptEnabled: true,
  });
  const page = await context.newPage();
  try {
    await page.goto(`/es/comprar/${SERVICE_CASES[0].slug}`);
    await expect(page.getByTestId("price")).toBeVisible();
    if ((await page.getByTestId("price-ars").count()) > 0) return;

    await loginAsAdmin(page);
    await page.goto("/admin/configuracion");
    await page.getByLabel("Valor en pesos").fill(SHARED_RATE);
    await page.getByRole("button", { name: "Guardar pesos por dólar" }).click();
    await expect(page).toHaveURL(/pesos=guardado/);
  } finally {
    await context.close();
  }
}

export function payButton(page: Page) {
  return page.getByRole("button", { name: es.Checkout.form.pay });
}

/** En la pantalla de confirmación: marca la casilla, toca pagar y espera estar en la pantalla de pago. */
export async function tickAndPay(page: Page, payLabel: string = es.Checkout.form.pay): Promise<void> {
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: payLabel }).click();
  await expect(page).toHaveURL(new RegExp(`^${MOCK_MERCADOPAGO_URL}/pay/`));
}

/** En la pantalla de pago del servidor falso: elige qué pasa con el pago. */
export async function choosePayment(page: Page, choice: PaymentChoice): Promise<void> {
  await page.getByRole("button", { name: choice, exact: true }).click();
}

/**
 * En la pantalla de pago: aprueba sin aviso y sin que el navegador vuelva al sitio, como quien paga y
 * cierra la pestaña. El pedido sigue sin confirmar. Devuelve el id del pago.
 */
export async function approveAndNeverComeBack(page: Page): Promise<string> {
  const response = await page.request.post(`${page.url()}/approve-silent`, { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  return new URL(response.headers().location).searchParams.get("payment_id") ?? "";
}

/** De la dirección de vuelta, el pedido y el pago que dijo Mercado Pago. */
export function returnedOrder(page: Page): { orderId: string; paymentId: string } {
  const { searchParams } = new URL(page.url());
  return { orderId: searchParams.get("compra") ?? "", paymentId: searchParams.get("payment_id") ?? "" };
}

/** El email con el que el servidor OAuth falso hace entrar a este alumno. */
export function studentEmail(student: string): string {
  return `${student}@example.com`;
}

/** El nombre con el que el servidor OAuth falso hace entrar a este alumno. */
export function studentName(student: string): string {
  return `Alumno ${student}`;
}

/** Cuántas preferencias recibió el servidor falso para este comprador: cuántas veces se salió a pagar. */
export async function preferencesOf(request: APIRequestContext, student: string): Promise<number> {
  const response = await request.get(`${MOCK_MERCADOPAGO_URL}/test/preferences`);
  const preferences = (await response.json()) as { payer?: { email?: string } }[];
  return preferences.filter(({ payer }) => payer?.email === studentEmail(student)).length;
}

/** Los emails que Resend (el servidor falso) recibió para este alumno. */
export async function emailsOf(request: APIRequestContext, student: string): Promise<{ subject: string; text: string }[]> {
  const response = await request.get(`${MOCK_MERCADOPAGO_URL}/test/emails`);
  const emails = (await response.json()) as { to: string | string[]; subject: string; text: string }[];
  return emails.filter(({ to }) => [to].flat().includes(studentEmail(student)));
}

/** Lo que Mercado Pago cuenta de un pago: cambia su estado y manda el aviso firmado. Devuelve cómo le contestó el sitio. */
export async function changePayment(request: APIRequestContext, paymentId: string, status: string): Promise<number> {
  const response = await request.post(`${MOCK_MERCADOPAGO_URL}/test/payments/${paymentId}`, { data: { status } });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { noticeStatus: number }).noticeStatus;
}

/** Abre el panel en otro navegador y devuelve el texto de cada venta del alumno. */
export async function salesInPanel(browser: Browser, student: string): Promise<string[]> {
  const { context, page } = await newStudentBrowser(browser);
  try {
    await loginAsAdmin(page);
    const name = studentName(student);
    await page.goto(`/admin/ventas?q=${encodeURIComponent(name)}`);
    await expect(page.getByRole("heading", { name: "Ventas", level: 1 })).toBeVisible();
    return await page.getByRole("row").filter({ hasText: name }).allInnerTexts();
  } finally {
    await context.close();
  }
}
