// Resumen del panel con los datos de ejemplo. Corre con `playwright.demo.config.ts`
// (puerto 3101): la base la siembra `buildDemoData(hoy en Argentina)` antes de
// arrancar y nadie la modifica, así los totales esperados salen de los mismos
// datos con las mismas funciones puras que usa la página. Son tests de solo lectura.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { ITEM_LABELS, PAYMENT_LABELS } from "../../src/admin/catalog";
import { computeKpis } from "../../src/admin/metrics/kpis";
import { monotributoStatus } from "../../src/admin/metrics/monotributo";
import { pendingWork } from "../../src/admin/metrics/pending";
import { PERIODS, PERIOD_LABELS, periodRange, previousPeriodRange, type Period } from "../../src/admin/metrics/period";
import {
  incomeByCountry,
  incomeByItem,
  incomeByPaymentMethod,
  itemsWithoutSales,
  monthlyIncome,
} from "../../src/admin/metrics/series";
import { DEMO_MONOTRIBUTO_SETTINGS } from "../../src/admin/demo-data";
import {
  countryLabel,
  formatPercent,
  formatRangeLabel,
  formatSignedPercent,
  monthLabels,
} from "../../src/admin/overview/labels";
import { PERIOD_SLUGS } from "../../src/admin/overview/period-param";
import { formatMoney } from "../../src/lib/money";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { PHONE } from "../helpers/admin-ui";
import { demoToday } from "../helpers/demo";

const { today, sales } = demoToday();
const TO_MARK_VISIBLE = 5;
const DELTA_LIMIT = 999;

const usd = (minor: number) => formatMoney(minor, "USD");

/** Entra al panel y abre el resumen de un período (el que viene en la dirección). */
async function openOverview(page: Page, period: Period = "thisMonth"): Promise<void> {
  await loginAsAdmin(page);
  if (period !== "thisMonth") await page.goto(`/admin?periodo=${PERIOD_SLUGS[period]}`);
  await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
}

/** Las tarjetas del período en pantalla son las que dan las métricas sobre los datos de ejemplo. */
async function expectKpis(page: Page, period: Period): Promise<void> {
  const now = new Date();
  const kpis = computeKpis(sales, period, now);
  const hasSales = kpis.salesCount > 0;

  await expect(page.getByTestId("kpi-income-usd")).toContainText(usd(kpis.incomeUsdMinor));
  await expect(page.getByTestId("kpi-income-ars")).toContainText(formatMoney(kpis.incomeArsMinor, "ARS"));
  await expect(page.getByTestId("kpi-sales")).toContainText(String(kpis.salesCount));
  await expect(page.getByTestId("kpi-average-ticket")).toContainText(hasSales ? usd(kpis.avgTicketUsdMinor) : "—");
  await expect(page.getByTestId("kpi-new-students")).toContainText(String(kpis.newCustomers));
  await expect(page.getByTestId("kpi-repeat-rate")).toContainText(hasSales ? formatPercent(kpis.repeatRatePct) : "—");

  const delta = kpis.incomeUsdDeltaPct;
  const shownDelta =
    delta === null ? "Sin comparación" : delta > DELTA_LIMIT ? `+${DELTA_LIMIT} % o más` : formatSignedPercent(delta);
  await expect(page.getByTestId("kpi-income-usd")).toContainText(shownDelta);
  await expect(page.getByTestId("kpi-income-usd")).toContainText(
    `vs. ${formatRangeLabel(previousPeriodRange(period, now), today)}`,
  );
  // Los pesos no llevan variación.
  await expect(page.getByTestId("kpi-income-ars")).not.toContainText("%");
}

test("overview shows the KPIs computed from the demo data", async ({ page }) => {
  await openOverview(page);

  await expectKpis(page, "thisMonth");
  await expect(page.getByTestId("kpi-income-usd")).toContainText("Cobrado en dólares");
  await expect(page.getByTestId("kpi-income-ars")).toContainText("Cobrado en pesos");
  await expect(page.getByTestId("kpi-sales")).toContainText("Ventas cobradas");
});

test.describe("period selector changes the KPIs", () => {
  for (const period of PERIODS) {
    test(PERIOD_LABELS[period], async ({ page }) => {
      await openOverview(page);

      if (period !== "thisMonth") {
        await page.getByRole("link", { name: PERIOD_LABELS[period], exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`\\?periodo=${PERIOD_SLUGS[period]}$`));
      }

      await expect(page.getByRole("link", { name: PERIOD_LABELS[period], exact: true })).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(page.getByRole("navigation", { name: "Período del resumen" }).locator("[aria-current]")).toHaveCount(1);
      await expectKpis(page, period);
      const range = periodRange(period, new Date());
      await expect(page.getByTestId("kpi-income-usd")).toContainText(formatRangeLabel(range, today));
    });
  }

  test("the monthly chart does not change with the period", async ({ page }) => {
    await openOverview(page);
    const labels = async () => page.getByTestId("bar").evaluateAll((bars) => bars.map((bar) => bar.getAttribute("aria-label")));
    const before = await labels();

    await page.getByRole("link", { name: PERIOD_LABELS.thisYear, exact: true }).click();
    await expect(page).toHaveURL(/\?periodo=este-ano$/);

    expect(await labels()).toEqual(before);
  });

  test("a period nobody knows falls back to this month instead of failing", async ({ page }) => {
    await loginAsAdmin(page);

    for (const value of ["nada", "__proto__", "constructor", "%00", "este-mes&periodo=este-ano", "A".repeat(3000)]) {
      const response = await page.goto(`/admin?periodo=${value}`);
      expect(response?.status(), value).toBe(200);
      await expect(
        page.getByRole("link", { name: PERIOD_LABELS.thisMonth, exact: true }),
        value,
      ).toHaveAttribute("aria-current", "true");
    }
  });
});

test("monthly chart has 12 bars with accessible labels", async ({ page }) => {
  await openOverview(page);
  const months = monthlyIncome(sales, 12, new Date());

  const bars = page.getByTestId("monthly-income").getByRole("img");
  await expect(bars).toHaveCount(12);
  for (const [index, month] of months.entries()) {
    const partial = index === months.length - 1 ? " (mes en curso, parcial)" : "";
    await expect(bars.nth(index)).toHaveAttribute(
      "aria-label",
      `${monthLabels(month.month).long}: ${usd(month.usdMinor)}${partial}`,
    );
  }
  // El gráfico tiene nombre y descripción, y una tabla con los mismos números.
  const chart = page.getByRole("group", { name: "Ingresos cobrados por mes, en dólares" });
  await expect(chart).toBeVisible();
  await expect(chart).toHaveAccessibleDescription(/El mejor mes fue/);
  await page.getByText("Ver los números como tabla").click();
  const rows = page.getByRole("table", { name: /Ingresos cobrados por mes/ }).getByRole("row");
  await expect(rows).toHaveCount(13);
  await expect(rows.last()).toContainText(usd(months[11].usdMinor));
});

test("items without sales are listed", async ({ page }) => {
  await openOverview(page);
  const missing = itemsWithoutSales(sales, 90, new Date());
  expect(missing).toEqual(["proSeason"]);

  const block = page.getByTestId("items-without-sales");
  await expect(block).toContainText("Sin ventas en los últimos 90 días");
  for (const item of missing) await expect(block.getByText(ITEM_LABELS[item], { exact: true })).toBeVisible();
  await expect(block.getByText(ITEM_LABELS.lesson)).toHaveCount(0);
});

test("income by service, payment method and country matches the demo data", async ({ page }) => {
  await openOverview(page, "last12");
  const range = periodRange("last12", new Date());

  const rowsOf = (testId: string) => page.getByTestId(testId).getByTestId("hbar-row");
  const items = incomeByItem(sales, range);
  await expect(rowsOf("items-income")).toHaveCount(items.length);
  for (const [index, item] of items.entries()) {
    const row = rowsOf("items-income").nth(index);
    await expect(row).toContainText(ITEM_LABELS[item.item]);
    await expect(row).toContainText(usd(item.usdMinor));
    await expect(row).toContainText(formatPercent(item.sharePct));
  }

  const payments = incomeByPaymentMethod(sales, range);
  await expect(rowsOf("payments-income")).toHaveCount(payments.length);
  for (const [index, payment] of payments.entries()) {
    await expect(rowsOf("payments-income").nth(index)).toContainText(PAYMENT_LABELS[payment.paymentMethod]);
    await expect(rowsOf("payments-income").nth(index)).toContainText(usd(payment.usdMinor));
  }

  const countries = incomeByCountry(sales, range);
  await expect(rowsOf("countries-income")).toHaveCount(countries.length);
  for (const [index, country] of countries.entries()) {
    await expect(rowsOf("countries-income").nth(index)).toContainText(countryLabel(country.country));
  }
  // Nombres de país, no códigos.
  await expect(page.getByTestId("countries-income")).toContainText("Argentina");
  await expect(page.getByTestId("countries-income")).toContainText("Brasil");
  await expect(page.getByTestId("items-income")).toContainText("redondeados");
});

test("pending deliveries link to their sale", async ({ page }) => {
  await openOverview(page);
  const { deliveries } = pendingWork(sales, new Date());
  expect(deliveries.length).toBeGreaterThanOrEqual(3);

  const block = page.getByTestId("pending-deliveries");
  await expect(block).toContainText(String(deliveries.length));
  for (const delivery of deliveries) {
    const link = block.locator(`a[href="/admin/ventas/${delivery.id}"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toContainText(delivery.customerName);
  }
  await expect(block.getByText("Vencida", { exact: true })).toHaveCount(deliveries.filter((delivery) => delivery.overdue).length);

  const first = deliveries[0];
  await block.locator(`a[href="/admin/ventas/${first.id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/admin/ventas/${first.id}$`));
  await expect(page.getByRole("heading", { name: "Editar venta" })).toBeVisible();
});

test("upcoming sessions are listed with the unpaid ones flagged", async ({ page }) => {
  await openOverview(page);
  const { sessions } = pendingWork(sales, new Date());
  expect(sessions.some((session) => session.unpaid)).toBe(true);

  const block = page.getByTestId("pending-sessions");
  for (const session of sessions) {
    await expect(block.locator(`a[href="/admin/ventas/${session.id}"]`)).toHaveCount(1);
  }
  await expect(block.getByText("Sin cobrar", { exact: true })).toHaveCount(sessions.filter((session) => session.unpaid).length);
});

test("sessions to mark show the count, the first five and the rest on request", async ({ page }) => {
  await openOverview(page);
  const { toMark } = pendingWork(sales, new Date());
  expect(toMark.length).toBeGreaterThan(TO_MARK_VISIBLE);
  const block = page.getByTestId("pending-to-mark");

  await expect(block.getByRole("heading", { name: /Sesiones por marcar/ })).toContainText(String(toMark.length));
  const rest = toMark.slice(TO_MARK_VISIBLE);
  const summary = block.getByText(`Ver las ${rest.length} restantes`);
  await expect(summary).toBeVisible();
  for (const session of toMark.slice(0, TO_MARK_VISIBLE)) {
    await expect(block.locator(`a[href="/admin/ventas/${session.id}"]`)).toBeVisible();
  }
  for (const session of rest) {
    await expect(block.locator(`a[href="/admin/ventas/${session.id}"]`)).toBeHidden();
  }

  await summary.click();
  for (const session of rest) {
    await expect(block.locator(`a[href="/admin/ventas/${session.id}"]`)).toBeVisible();
  }
  // Las que nunca se cobraron se ven marcadas, y el pack de clases no pide marcarse.
  await expect(block.getByText("Sin cobrar", { exact: true })).toHaveCount(toMark.filter((session) => session.unpaid).length);
  expect(toMark.some((session) => session.item === "lessonPack")).toBe(false);
});

test("sales still to be invoiced show their count and total in pesos", async ({ page }) => {
  await openOverview(page);
  const { uninvoiced } = pendingWork(sales, new Date());
  expect(uninvoiced.count).toBeGreaterThan(0);

  const block = page.getByTestId("pending-uninvoiced");
  await expect(block).toContainText(String(uninvoiced.count));
  await expect(block).toContainText(formatMoney(uninvoiced.arsMinor, "ARS"));
  await expect(block.getByRole("link", { name: /Ir a facturación/ })).toHaveAttribute("href", "/admin/facturacion");
});

test("monotributo shows the rolling window, the cap and how much is left", async ({ page }) => {
  await openOverview(page);
  const status = monotributoStatus(sales, DEMO_MONOTRIBUTO_SETTINGS, new Date());
  expect(status.usedPct).not.toBeNull();

  const card = page.getByTestId("monotributo");
  await expect(card).toContainText("por fecha de cobro");
  await expect(card).toContainText(formatMoney(status.last12ArsMinor, "ARS"));
  await expect(card).toContainText(formatMoney(status.capArsMinor ?? 0, "ARS"));
  await expect(card).toContainText(formatPercent(status.usedPct ?? 0));
  await expect(card).toContainText(`categoría ${DEMO_MONOTRIBUTO_SETTINGS.category}`);
  await expect(card).toContainText("lo que cargaste");
  const meter = card.getByRole("meter", { name: "Tope anual del monotributo usado" });
  await expect(meter).toHaveAttribute("aria-valuenow", String(Math.min(100, status.usedPct ?? 0)));
});

test("the overview is accessible", async ({ page }) => {
  await openOverview(page);
  await expect(page.getByTestId("bar")).toHaveCount(12);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(
    results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
  ).toEqual([]);
});

/**
 * Cada tarjeta de indicadores (las dos de arriba y las cuatro de abajo) con lo
 * que se sale de su caja: el contenido que pasa su borde o llega a tocarlo
 * (las tarjetas tienen 16 px de relleno, así que a menos de 12 px del borde ya
 * se ve pegado).
 */
async function cardsSpilling(page: Page): Promise<string[]> {
  return page.evaluate((margin) => {
    const spilling: string[] = [];
    for (const card of document.querySelectorAll<HTMLElement>('[data-testid^="kpi-"]')) {
      const name = card.dataset.testid;
      const edge = card.getBoundingClientRect().right - margin;
      if (card.scrollWidth > card.clientWidth) spilling.push(`${name}: scrollWidth ${card.scrollWidth} > ${card.clientWidth}`);
      for (const element of card.querySelectorAll<HTMLElement>("*")) {
        const right = element.getBoundingClientRect().right;
        if (right > edge) spilling.push(`${name} > ${element.tagName.toLowerCase()}: right ${Math.round(right)} > ${Math.round(edge)}`);
        // (El texto solo para lectores de pantalla mide 1 px de ancho y está recortado a propósito.)
        if (element.clientWidth > 1 && element.scrollWidth > element.clientWidth + 1) {
          spilling.push(`${name} > ${element.tagName.toLowerCase()}: scrollWidth ${element.scrollWidth} > ${element.clientWidth}`);
        }
      }
    }
    return spilling;
  }, 12);
}

test.describe("on medium screens, where the sidebar is visible and the page is still narrow", () => {
  for (const width of [920, 1024, 1100, 1280]) {
    for (const period of ["thisMonth", "last12"] as const) {
      test(`the indicator cards hold their numbers at ${width}px (${PERIOD_LABELS[period]})`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await openOverview(page, period);
        await expect(page.getByTestId("kpi-average-ticket")).toBeVisible();

        expect(await cardsSpilling(page)).toEqual([]);
        const sideways = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(sideways).toBe(0);
      });
    }
  }
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE });

  test("the overview fits the screen without sideways scrolling", async ({ page }) => {
    await openOverview(page, "last12");
    await expect(page.getByTestId("bar")).toHaveCount(12);

    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wide: [...document.querySelectorAll<HTMLElement>("main *")]
        .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)}`)
        .slice(0, 5),
    }));
    expect(overflow).toEqual({ page: 0, wide: [] });
    expect(await cardsSpilling(page)).toEqual([]);
  });

  test("the overview is accessible on a phone", async ({ page }) => {
    await openOverview(page);
    await expect(page.getByTestId("bar")).toHaveCount(12);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(
      results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
    ).toEqual([]);
  });
});
