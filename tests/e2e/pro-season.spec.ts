import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { choosePayment, ensureSharedRate, tickAndPay } from "../helpers/checkout-e2e";
import { newStudentBrowser, signIn, uniqueProviderStudent } from "../helpers/portal-e2e";
import es from "../../messages/es.json" with { type: "json" };

// Temporada Pro de punta a punta: el equipo aplica sin entrar, Tallami lee la aplicación en el panel, cambia su
// estado y genera dos links; dos alumnos pagan uno cada uno, y un link usado ya no sirve. Los tests corren en
// paralelo sobre la misma base: cada uno usa un nombre de equipo propio.

const FORM = es.Pro.form;
const SCRIPT = "<script>document.title='hackeado'</script>";
const SEVERE = new Set(["serious", "critical"]);

test.beforeEach(async ({ browser }) => {
  await ensureSharedRate(browser);
});

async function apply(page: Page, team: string): Promise<void> {
  await page.goto("/es/temporada-pro");
  await page.getByLabel(FORM.name, { exact: true }).fill(team);
  await page.getByLabel(FORM.discord, { exact: true }).fill("equipo#0001");
  await page.getByLabel(FORM.teamMembers, { exact: true }).fill("Ana (ana_fn)\nBeto (beto_fn)");
  await page.getByLabel(FORM.results, { exact: true }).fill("Top 20 en la FNCS");
  await page.getByLabel(/^Mensaje/).fill(SCRIPT);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: FORM.submit }).click();
}

/** Un navegador con la sesión del panel abierta. */
async function openPanel(browser: Browser) {
  const { context, page } = await newStudentBrowser(browser);
  await loginAsAdmin(page);
  return { context, page };
}

/** Genera un link de `dollars` dólares en la ficha abierta y devuelve su ruta (sin el origen del sitio). */
async function generateLink(page: Page, dollars: string): Promise<string> {
  await page.getByLabel("Monto en dólares").fill(dollars);
  await page.getByRole("button", { name: /^Generar (otro )?link$/ }).click();
  const field = page.getByLabel(new RegExp(`^Link de pago por USD ${dollars}`));
  await expect(field).toBeVisible();
  const url = new URL(await field.inputValue());
  return `${url.pathname}${url.search}`;
}

async function payLink(browser: Browser, path: string, usd: string, ars: string): Promise<void> {
  const { context, page } = await newStudentBrowser(browser);
  try {
    await signIn(page, { student: uniqueProviderStudent() });
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: "Temporada Pro" })).toBeVisible();
    await expect(page.getByTestId("price")).toHaveText(usd);
    await expect(page.getByTestId("price-ars")).toHaveText(ars);
    await tickAndPay(page);
    await expect(page.getByTestId("title")).toHaveText("Tallami Coaching: Temporada Pro");
    await choosePayment(page, "Aprobar");
    await expect(page).toHaveURL(/\/es\/portal\?compra=[0-9a-f-]{36}/);
    await expect(page.getByRole("article")).toContainText("Temporada Pro");
  } finally {
    await context.close();
  }
}

test("a team applies, Tallami sends two links, two students pay one each, and a used link is dead", async ({ page, browser }) => {
  const team = `Equipo ${randomUUID().slice(0, 8)}`;

  // El visitante aplica sin entrar y ve la confirmación.
  await apply(page, team);
  await expect(page.getByRole("heading", { name: es.Pro.sent.title })).toBeVisible();

  // Tallami la ve, cambia el estado y genera dos links. El `<script>` del mensaje se ve como texto.
  const panel = await openPanel(browser);
  try {
    await panel.page.goto("/admin/aplicaciones");
    await panel.page.getByRole("link", { name: team }).click();
    await expect(panel.page.getByRole("heading", { level: 1, name: team })).toBeVisible();
    await expect(panel.page.getByText(SCRIPT)).toBeVisible();
    expect(await panel.page.title()).not.toBe("hackeado");

    await panel.page.getByLabel("Estado", { exact: true }).selectOption({ label: "En charla" });
    await panel.page.getByRole("button", { name: "Guardar estado" }).click();
    await expect(panel.page.getByText("Estado guardado.")).toBeVisible();

    const first = await generateLink(panel.page, "1000");
    const second = await generateLink(panel.page, "1500");
    expect(second).not.toBe(first);

    // Un alumno abre el primero, ve su monto y sus pesos, y paga.
    await payLink(browser, first, "USD 1.000", "ARS 1.500.000");

    // La ficha muestra ese link pagado y USD 1.000 cobrados; el estado no cambió solo.
    await panel.page.reload();
    await expect(panel.page.getByTestId("collected")).toContainText("USD 1.000,00");
    await expect(panel.page.getByRole("row").filter({ hasText: "USD 1.000,00" })).toContainText("Pagado el");
    await expect(panel.page.getByRole("row").filter({ hasText: "USD 1.500,00" })).toContainText("Sin pagar");
    await expect(panel.page.getByLabel("Estado", { exact: true })).toHaveValue("talking");

    // El primer link, abierto de nuevo, dice que ya se usó y no muestra ninguna venta.
    const other = await newStudentBrowser(browser);
    try {
      await signIn(other.page, { student: uniqueProviderStudent() });
      await other.page.goto(first);
      await expect(other.page.getByRole("heading", { name: es.Checkout.pro.invalidTitle })).toBeVisible();
      await expect(other.page.getByTestId("price")).toHaveCount(0);
      await expect(other.page.getByRole("checkbox")).toHaveCount(0);
      await expect(other.page.getByRole("link", { name: es.Checkout.pro.apply })).toHaveAttribute("href", "/es/temporada-pro");
    } finally {
      await other.context.close();
    }

    // El segundo sigue funcionando, con otro alumno.
    await payLink(browser, second, "USD 1.500", "ARS 2.250.000");
    await panel.page.reload();
    await expect(panel.page.getByTestId("collected")).toContainText("USD 2.500,00");
  } finally {
    await panel.context.close();
  }
});

test("the purchase screen of Temporada Pro without a link, or with a made-up one, sends to the application", async ({ page }) => {
  for (const path of ["/es/comprar/temporada-pro", `/es/comprar/temporada-pro?link=${"a".repeat(43)}`]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: es.Checkout.pro.invalidTitle })).toBeVisible();
    await expect(page.getByTestId("price")).toHaveCount(0);
  }

  await page.getByRole("link", { name: es.Checkout.pro.apply }).click();
  await expect(page).toHaveURL(/\/es\/temporada-pro$/);
  await expect(page.getByRole("heading", { level: 1, name: es.Pro.title })).toBeVisible();
});

test("the language switcher of the purchase screen keeps the link", async ({ page, browser }) => {
  const team = `Equipo ${randomUUID().slice(0, 8)}`;
  await apply(page, team);
  await expect(page.getByRole("heading", { name: es.Pro.sent.title })).toBeVisible();
  const panel = await openPanel(browser);
  try {
    await panel.page.goto("/admin/aplicaciones");
    await panel.page.getByRole("link", { name: team }).click();
    const path = await generateLink(panel.page, "2500");
    const token = new URL(path, "http://x").searchParams.get("link");

    await page.goto(path);
    await expect(page.getByTestId("price")).toBeVisible();
    await expect(page.getByRole("link", { name: "EN", exact: true })).toHaveAttribute("href", new RegExp(`/en/comprar/temporada-pro\\?link=${token}$`));
    await page.getByRole("link", { name: "PT", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/pt/comprar/temporada-pro\\?link=${token}$`));
    await expect(page.getByTestId("price")).toHaveText("USD 2.500");
  } finally {
    await panel.context.close();
  }
});

test("the application form reports what is missing, keeps what was typed, and has no serious accessibility problems", async ({ page }) => {
  await page.goto("/es/temporada-pro");
  await page.getByLabel(FORM.name, { exact: true }).fill("Solo el nombre");
  // Sin `required` del navegador para probar la validación del servidor.
  await page.evaluate(() => document.querySelectorAll("[required]").forEach((node) => node.removeAttribute("required")));
  await page.getByRole("button", { name: FORM.submit }).click();

  await expect(page.getByRole("alert").filter({ hasText: FORM.summary })).toBeVisible();
  await expect(page.getByLabel(FORM.name, { exact: true })).toHaveValue("Solo el nombre");
  await expect(page.getByText(es.Pro.errors.required).first()).toBeVisible();
  await expect(page.getByText(es.Pro.errors.privacy)).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.filter(({ impact }) => SEVERE.has(impact ?? "")).map(({ id }) => id)).toEqual([]);
});

test("the application page works without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    javaScriptEnabled: false,
    extraHTTPHeaders: { "x-forwarded-for": `10.${Math.floor(Math.random() * 250) + 1}.9.9` },
  });
  const page = await context.newPage();
  try {
    await apply(page, `Equipo ${randomUUID().slice(0, 8)}`);
    await expect(page.getByRole("heading", { name: es.Pro.sent.title })).toBeVisible();
  } finally {
    await context.close();
  }
});
