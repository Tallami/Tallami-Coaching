import type { Browser, Page } from "@playwright/test";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { SERVICE_CASES, choosePayment, ensureSharedRate, studentName, tickAndPay } from "../helpers/checkout-e2e";
import { newStudentBrowser, signIn, uniqueProviderStudent } from "../helpers/portal-e2e";
import es from "../../messages/es.json" with { type: "json" };

// Los códigos de replay: el alumno compra un VOD review, pega sus códigos en el portal y Tallami los ve en
// el panel. El servidor es compartido y los tests corren en paralelo: cada test mira solo lo de su alumno.

const [VOD, , LIVE] = SERVICE_CASES;
const XSS = "<script>alert(1)</script>";

test.beforeEach(async ({ browser }) => {
  await ensureSharedRate(browser);
});

/** Compra `slug` con un alumno nuevo y deja el portal abierto con la compra. Devuelve el alumno y el id de la venta. */
async function buy(page: Page, slug: string): Promise<{ student: string; saleId: string }> {
  const student = uniqueProviderStudent();
  await signIn(page, { student });
  await page.goto(`/es/comprar/${slug}`);
  await tickAndPay(page);
  await choosePayment(page, "Aprobar");
  await expect(page).toHaveURL(/\/es\/portal\?compra=/);
  return { student, saleId: await saleIdOf(page) };
}

/** El id de la venta de la única compra de la página (la tarjeta se rotula con `purchase-<id>`). */
async function saleIdOf(page: Page): Promise<string> {
  const article = page.getByRole("article");
  await expect(article).toHaveCount(1);
  return ((await article.getAttribute("aria-labelledby")) ?? "").replace("purchase-", "");
}

async function sendCodes(page: Page, codes: string): Promise<void> {
  await page.getByLabel(es.Portal.replay.label).fill(codes);
  await page.getByRole("button", { name: es.Portal.replay.submit }).click();
}

/** Abre el panel en otro navegador, ya con la sesión del administrador, y corre `check`. */
async function inPanel(browser: Browser, check: (panel: Page) => Promise<void>): Promise<void> {
  const { context, page } = await newStudentBrowser(browser);
  try {
    await loginAsAdmin(page);
    await check(page);
  } finally {
    await context.close();
  }
}

test("the student pastes the codes, sees until when the delivery is, and the panel lists the sale with the date and the codes", async ({
  page,
  browser,
}) => {
  const { student, saleId } = await buy(page, VOD.slug);
  const name = studentName(student);
  await expect(page.getByTestId("replay-codes")).toContainText(es.Portal.replay.openHint.slice(0, 20));

  await sendCodes(page, "ABC-123");

  const block = page.getByTestId("replay-codes");
  await expect(block.getByText(/Tu entrega llega hasta el/)).toBeVisible();
  await expect(block.locator("pre")).toHaveText("ABC-123");

  await inPanel(browser, async (panel) => {
    await panel.goto("/admin");
    const deliveries = panel.getByTestId("pending-deliveries");
    const link = deliveries.locator(`a[href="/admin/ventas/${saleId}"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toContainText(name);
    // Con códigos tiene fecha de entrega: ya no dice que faltan.
    const row = deliveries.locator("li").filter({ has: panel.locator(`a[href="/admin/ventas/${saleId}"]`) });
    await expect(row).not.toContainText("faltan los códigos del alumno");
    await expect(row).toContainText("vence el");

    await panel.goto(`/admin/ventas/${saleId}`);
    await expect(panel.getByTestId("replay-codes")).toHaveText("ABC-123");
  });
});

test("before the codes arrive, the panel says they are missing", async ({ page, browser }) => {
  const { saleId } = await buy(page, VOD.slug);

  await inPanel(browser, async (panel) => {
    await panel.goto("/admin");
    const row = panel.getByTestId("pending-deliveries").locator("li", { has: panel.locator(`a[href="/admin/ventas/${saleId}"]`) });
    await expect(row).toContainText("faltan los códigos del alumno");
  });
});

test("a script pasted as codes is shown as text in the portal and in the panel, and never runs", async ({ page, browser }) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const { saleId } = await buy(page, VOD.slug);

  await sendCodes(page, XSS);

  await expect(page.getByTestId("replay-codes").locator("pre")).toHaveText(XSS);
  await page.reload();
  await expect(page.getByTestId("replay-codes").locator("pre")).toHaveText(XSS);

  await inPanel(browser, async (panel) => {
    const panelDialogs: string[] = [];
    panel.on("dialog", (dialog) => {
      panelDialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await panel.goto(`/admin/ventas/${saleId}`);
    await expect(panel.getByTestId("replay-codes")).toHaveText(XSS);
    expect(panelDialogs).toEqual([]);
  });
  expect(dialogs).toEqual([]);
});

test("the student can correct the codes and the delivery date does not move", async ({ page }) => {
  await buy(page, VOD.slug);
  await sendCodes(page, "ABC-123");
  const due = await page.getByTestId("replay-codes").getByText(/Tu entrega llega hasta el/).innerText();

  await page.getByLabel(es.Portal.replay.label).fill("XYZ-999");
  await page.getByRole("button", { name: es.Portal.replay.correct }).click();

  await expect(page.getByTestId("replay-codes").locator("pre")).toHaveText("XYZ-999");
  await expect(page.getByTestId("replay-codes").getByText(/Tu entrega llega hasta el/)).toHaveText(due);
});

test("another student cannot send codes to that sale: the action answers as if it did not exist", async ({ page, browser }) => {
  const { saleId: victimSale } = await buy(page, VOD.slug);

  const { context, page: attacker } = await newStudentBrowser(browser);
  try {
    await buy(attacker, VOD.slug);
    // El formulario del atacante apunta a la venta de la víctima.
    await attacker.locator('input[name="saleId"]').evaluate((field: HTMLInputElement, id) => {
      field.value = id;
    }, victimSale);
    await sendCodes(attacker, "CODIGOS-AJENOS");

    await expect(attacker.getByRole("alert").filter({ hasText: es.Portal.replay.errors.notFound })).toBeVisible();
  } finally {
    await context.close();
  }

  await page.reload();
  await expect(page.getByTestId("replay-codes").locator("pre")).toHaveCount(0);
  await expect(page.getByLabel(es.Portal.replay.label)).toHaveValue("");
});

test("a live VOD review shows up in 'Por coordinar', and it asks for no codes", async ({ page, browser }) => {
  const { student, saleId } = await buy(page, LIVE.slug);
  await expect(page.getByTestId("replay-codes")).toHaveCount(0);

  await inPanel(browser, async (panel) => {
    await panel.goto("/admin");
    const block = panel.getByTestId("pending-coordinate");
    await expect(block.getByRole("heading", { name: /Por coordinar/ })).toBeVisible();
    const link = block.locator(`a[href="/admin/ventas/${saleId}"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toContainText(studentName(student));
    await expect(panel.getByTestId("pending-sessions").locator(`a[href="/admin/ventas/${saleId}"]`)).toHaveCount(0);
  });
});
