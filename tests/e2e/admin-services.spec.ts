// Página Servicios del panel, en el servidor principal (puerto 3100). Los tests
// corren en paralelo contra una sola base, así que acá nada supone que esté
// vacía: el recorrido completo usa Temporada Pro, un servicio que ningún otro
// test del servidor principal vende ni cliquea, y compara contra lo que había
// antes de empezar. Los totales exactos con datos de ejemplo están en
// `admin-services-demo.spec.ts` (puerto 3101, de solo lectura).

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { todayInArgentina, formatDay } from "../../src/admin/dates";
import { PERIODS, PERIOD_LABELS, type Period } from "../../src/admin/metrics/period";
import { percent } from "../../src/admin/metrics/math";
import { formatPercent } from "../../src/admin/overview/labels";
import { PERIOD_SLUGS } from "../../src/admin/overview/period-param";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { PHONE, createSale, uniqueName, whenInteractive } from "../helpers/admin-ui";
import { watchBeacons } from "../helpers/beacons";

const SERVICES_PATH = "/admin/servicios";
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const PRO_SEASON_CENTS = 250_000;

function rowFor(page: Page, item: string): Locator {
  return page.locator(`[data-testid="service-row"][data-item="${item}"]`);
}

async function cellText(row: Locator, column: string): Promise<string> {
  return (await row.locator(`[data-col="${column}"]`).innerText()).replace(/\s+/g, " ").trim();
}

/** "USD 2.500,00" → 250000 (siempre trae dos decimales). */
function minorOf(text: string): number {
  return Number(text.replace(/\D/g, ""));
}

interface RowNumbers {
  sales: number;
  clicks: number;
  incomeMinor: number;
  conversion: string;
  last: string;
}

async function readRow(page: Page, item: string, path = SERVICES_PATH): Promise<RowNumbers> {
  await page.goto(path);
  const row = rowFor(page, item);
  await expect(row).toBeVisible();
  return {
    sales: Number(await cellText(row, "sales")),
    clicks: Number(await cellText(row, "clicks")),
    incomeMinor: minorOf(await cellText(row, "income")),
    conversion: await cellText(row, "conversion"),
    last: await cellText(row, "last"),
  };
}

test.describe("without a session", () => {
  test("the services page sends you to the login", async ({ request, page }) => {
    const response = await request.get(SERVICES_PATH, { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain(`/admin/login?next=${encodeURIComponent(SERVICES_PATH)}`);
    await page.goto(SERVICES_PATH);
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole("heading", { name: "Servicios", exact: true })).toHaveCount(0);
  });
});

test.describe("services", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("services page shows clicks, sales and conversion", async ({ page, request }) => {
    const today = todayInArgentina();
    const before = await readRow(page, "proSeason");

    // 1) Un clic de verdad en el botón de Temporada Pro del sitio, en portugués.
    const watch = await watchBeacons(page);
    await page.goto("/pt");
    const apply = page.locator("#services .stage").getByRole("link");
    await whenInteractive(apply);
    const answered = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/interest");
    await apply.click();
    expect((await answered).status()).toBe(204);
    await expect.poll(() => watch.bodies()).toEqual([JSON.stringify({ item: "proSeason", locale: "pt" })]);

    // 2) Dos clics directos que valen, uno de un bot y uno inválido, que no valen.
    const post = (data: unknown, headers: Record<string, string> = {}) =>
      request.post("/api/interest", {
        headers: { "user-agent": BROWSER_USER_AGENT, "content-type": "application/json", ...headers },
        data: JSON.stringify(data),
      });
    expect((await post({ item: "proSeason", locale: "es" }, { "x-vercel-ip-country": "AR" })).status()).toBe(204);
    expect((await post({ item: "proSeason", locale: "en" }, { "x-vercel-ip-country": "BR" })).status()).toBe(204);
    expect((await post({ item: "proSeason", locale: "es" }, { "user-agent": "Googlebot/2.1" })).status()).toBe(204);
    expect((await post({ item: "other", locale: "es" })).status()).toBe(400);

    // 3) Una venta cobrada y una pendiente: solo la cobrada suma.
    await createSale(page, { student: uniqueName("Equipo Pro"), item: "proSeason", status: "paid", paidOn: today });
    await createSale(page, { student: uniqueName("Equipo Pro"), item: "proSeason", status: "pending", paidOn: "" });

    const after = await readRow(page, "proSeason");
    expect(after.sales).toBe(before.sales + 1);
    expect(after.clicks).toBe(before.clicks + 3);
    expect(after.incomeMinor).toBe(before.incomeMinor + PRO_SEASON_CENTS);
    expect(after.conversion).toBe(formatPercent(percent(after.sales, after.clicks)));
    expect(after.last).toContain(formatDay(today));
    expect(after.last).toContain("hoy");

    // La conversión se explica en la misma página.
    await expect(page.getByText("conversión: ventas cobradas ÷ clics en Reservar")).toBeVisible();
  });

  test("the period selector changes the period and keeps you on the services page", async ({ page }) => {
    await page.goto(SERVICES_PATH);
    const selector = page.getByRole("navigation", { name: "Período de los servicios" });
    await expect(selector.locator("[aria-current]")).toHaveCount(1);
    await expect(selector.getByRole("link", { name: PERIOD_LABELS.thisMonth, exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );

    for (const period of PERIODS.filter((candidate): candidate is Exclude<Period, "thisMonth"> => candidate !== "thisMonth")) {
      await selector.getByRole("link", { name: PERIOD_LABELS[period], exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`${SERVICES_PATH}\\?periodo=${PERIOD_SLUGS[period]}$`));
      await expect(page.getByRole("heading", { name: "Servicios", level: 1 })).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Período de los servicios" }).getByRole("link", { name: PERIOD_LABELS[period], exact: true }),
      ).toHaveAttribute("aria-current", "true");
    }
  });

  test("a period nobody knows falls back to this month instead of failing", async ({ page }) => {
    for (const value of ["nada", "__proto__", "constructor", "toString", "%00", "este-mes&periodo=este-ano", "A".repeat(3000)]) {
      const response = await page.goto(`${SERVICES_PATH}?periodo=${value}`);

      expect(response?.status(), value).toBe(200);
      await expect(
        page.getByRole("link", { name: PERIOD_LABELS.thisMonth, exact: true }),
        value,
      ).toHaveAttribute("aria-current", "true");
    }
    // Repetido: vale el primero.
    await page.goto(`${SERVICES_PATH}?periodo=este-ano&periodo=12-meses`);
    await expect(page.getByRole("link", { name: PERIOD_LABELS.thisYear, exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("lists every item of the catalog with its label", async ({ page }) => {
    await page.goto(SERVICES_PATH);

    await expect(page.getByRole("heading", { name: "Servicios", level: 1 })).toBeVisible();
    await expect(page.getByTestId("service-row")).toHaveCount(8);
    for (const label of [
      "VOD review grabado",
      "VOD review en vivo",
      "Clase 1 a 1",
      "Pack de 4 clases",
      "Plan de juego personalizado",
      "Coaching de torneo",
      "Temporada Pro",
      "Otro",
    ]) {
      await expect(page.getByRole("rowheader", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Servicios", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("the services page is accessible", async ({ page }) => {
    await page.goto(SERVICES_PATH);
    await expect(page.getByTestId("service-row")).toHaveCount(8);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(
      results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
    ).toEqual([]);
  });

  test.describe("on a phone", () => {
    test.use({ viewport: PHONE });

    test("the page never scrolls sideways: the table scrolls inside its own box", async ({ page }) => {
      await page.goto(SERVICES_PATH);
      await expect(page.getByTestId("service-row")).toHaveCount(8);

      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways).toBe(0);
      const box = page.getByRole("region", { name: "Servicios: ventas, ingresos y clics" });
      const scrolls = await box.evaluate((element) => element.scrollWidth > element.clientWidth);
      expect(scrolls).toBe(true);
      // Se puede llegar con el teclado.
      await box.focus();
      await expect(box).toBeFocused();
    });
  });
});
