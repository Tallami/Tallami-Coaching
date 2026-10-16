// Página Servicios con los datos de ejemplo. Corre con `playwright.demo.config.ts`
// (puerto 3101): la base la siembra `buildDemoData(hoy en Argentina)` antes de
// arrancar (ventas y clics) y nadie la modifica, así los números esperados
// salen de los mismos datos con las mismas funciones puras que usa la página.
// Son tests de solo lectura.

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { ITEM_LABELS, INTEREST_ITEMS, SALE_ITEMS, SITE_BOOKING_ITEMS } from "../../src/admin/catalog";
import { dateToArgentinaLocal, formatDay } from "../../src/admin/dates";
import { buildServicesReport, type ServicesReport } from "../../src/admin/services/report";
import { percent } from "../../src/admin/metrics/math";
import { incomeByItem } from "../../src/admin/metrics/series";
import { PERIODS, PERIOD_LABELS, periodRange, type Period } from "../../src/admin/metrics/period";
import { formatPercent, formatRangeLabel, monthLabels } from "../../src/admin/overview/labels";
import { PERIOD_SLUGS } from "../../src/admin/overview/period-param";
import { formatMoney } from "../../src/lib/money";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { PHONE } from "../helpers/admin-ui";
import { demoToday } from "../helpers/demo";

const { today, data, sales } = demoToday();
const usd = (minor: number) => formatMoney(minor, "USD");
const dayOf = (instant: Date) => dateToArgentinaLocal(instant).slice(0, 10);

/** Los clics de ejemplo del rango, contados a mano (sin pasar por `interestByItem`). */
function demoClicks(period: Period, now: Date) {
  const range = periodRange(period, now);
  return INTEREST_ITEMS.map((item) => ({
    item,
    clicks: data.interest.filter((event) => {
      const day = dayOf(event.createdAt as Date);
      return event.item === item && day >= range.from && day <= range.to;
    }).length,
  }));
}

function expectedReport(period: Period): ServicesReport {
  const now = new Date();
  return buildServicesReport(sales, demoClicks(period, now), period, now);
}

async function openServices(page: Page, period: Period = "thisMonth"): Promise<void> {
  await loginAsAdmin(page);
  await page.goto(period === "thisMonth" ? "/admin/servicios" : `/admin/servicios?periodo=${PERIOD_SLUGS[period]}`);
  await expect(page.getByRole("heading", { name: "Servicios", level: 1 })).toBeVisible();
}

function cell(page: Page, item: string, column: string) {
  return page.locator(`[data-testid="service-row"][data-item="${item}"] [data-col="${column}"]`);
}

test.describe("the services table matches the demo data in every period", () => {
  for (const period of PERIODS) {
    test(PERIOD_LABELS[period], async ({ page }) => {
      await openServices(page, period);
      const report = expectedReport(period);

      await expect(page.getByTestId("service-row")).toHaveCount(SALE_ITEMS.length);
      for (const [index, row] of report.rows.entries()) {
        await expect(page.getByTestId("service-row").nth(index), row.item).toHaveAttribute("data-item", row.item);
        await expect(cell(page, row.item, "item")).toHaveText(ITEM_LABELS[row.item]);
        await expect(cell(page, row.item, "sales"), `${row.item} sales`).toHaveText(String(row.sales));
        await expect(cell(page, row.item, "income"), `${row.item} income`).toHaveText(usd(row.incomeUsdMinor));
        await expect(cell(page, row.item, "avg"), `${row.item} avg`).toHaveText(
          row.avgTicketUsdMinor === null ? "—" : usd(row.avgTicketUsdMinor),
        );
        await expect(cell(page, row.item, "share"), `${row.item} share`).toHaveText(formatPercent(row.sharePct));
        await expect(cell(page, row.item, "clicks"), `${row.item} clicks`).toHaveText(
          row.clicks === null ? "—" : String(row.clicks),
        );
        // Clase 1 a 1 aclara cuántas ventas del pack incluye.
        const packNote =
          row.includedPackSales > 0 && row.conversionPct !== null
            ? ` incluye ${row.includedPackSales} ${row.includedPackSales === 1 ? "venta" : "ventas"} del pack`
            : "";
        await expect(cell(page, row.item, "conversion"), `${row.item} conversion`).toHaveText(
          row.conversionPct === null ? "—" : `${formatPercent(row.conversionPct)}${packNote}`,
        );
        await expect(cell(page, row.item, "last"), `${row.item} last`).toContainText(
          row.lastSaleOn === null ? "—" : formatDay(row.lastSaleOn),
        );
      }
      await expect(page.getByRole("navigation", { name: "Período de los servicios" }).locator("[aria-current]")).toHaveCount(1);
      await expect(page.getByTestId("services-summary")).toContainText(
        formatRangeLabel(periodRange(period, new Date()), today),
      );
    });
  }
});

test("clicks and sales are consistent with the overview and with the raw demo events", async ({ page }) => {
  await openServices(page, "last12");
  const now = new Date();
  const range = periodRange("last12", now);

  // Ventas e ingresos por servicio: los mismos que el Resumen (`incomeByItem`).
  for (const entry of incomeByItem(sales, range)) {
    await expect(cell(page, entry.item, "sales")).toHaveText(String(entry.count));
    await expect(cell(page, entry.item, "income")).toHaveText(usd(entry.usdMinor));
    await expect(cell(page, entry.item, "share")).toHaveText(formatPercent(entry.sharePct));
  }

  // Los clics, contados directamente sobre los eventos de ejemplo.
  const inRange = data.interest.filter((event) => {
    const day = dayOf(event.createdAt as Date);
    return day >= range.from && day <= range.to;
  });
  expect(inRange.length).toBeGreaterThan(100);
  const summary = page.getByTestId("services-summary");
  await expect(summary).toContainText(`${inRange.length} clics en Reservar`);
  for (const item of SITE_BOOKING_ITEMS) {
    await expect(cell(page, item, "clicks")).toHaveText(String(inRange.filter((event) => event.item === item).length));
  }
});

test("Clase 1 a 1 converts its own sales plus the pack's, because the pack is requested from that button", async ({ page }) => {
  await openServices(page, "last12");
  const range = periodRange("last12", new Date());
  const counts = new Map(incomeByItem(sales, range).map((entry) => [entry.item, entry.count]));
  const lessonSales = counts.get("lesson") ?? 0;
  const packSales = counts.get("lessonPack") ?? 0;
  const lessonClicks = data.interest.filter((event) => {
    const day = dayOf(event.createdAt as Date);
    return event.item === "lesson" && day >= range.from && day <= range.to;
  }).length;
  expect(packSales).toBeGreaterThan(0);
  expect(lessonClicks).toBeGreaterThan(0);

  // Las columnas propias quedan como estaban: la fila de Clase 1 a 1 no suma las ventas del pack.
  await expect(cell(page, "lesson", "sales")).toHaveText(String(lessonSales));
  await expect(cell(page, "lessonPack", "sales")).toHaveText(String(packSales));
  await expect(cell(page, "lesson", "conversion")).toContainText(
    formatPercent(percent(lessonSales + packSales, lessonClicks)),
  );
  await expect(cell(page, "lesson", "conversion")).toContainText(
    `incluye ${packSales} ${packSales === 1 ? "venta" : "ventas"} del pack`,
  );
  await expect(page.getByText("la conversión de Clase 1 a 1 cuenta también las ventas del pack")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Últimos 6 meses (escala propia)" })).toBeVisible();
});

test("a button nobody clicked this month shows 0 clicks and a dash for conversion; the pack and 'other' show dashes", async ({ page }) => {
  await openServices(page, "thisMonth");

  await expect(cell(page, "proSeason", "clicks")).toHaveText("0");
  await expect(cell(page, "proSeason", "conversion")).toHaveText("—");
  for (const item of ["lessonPack", "other"] as const) {
    await expect(cell(page, item, "clicks"), item).toHaveText("—");
    await expect(cell(page, item, "conversion"), item).toHaveText("—");
  }
  await expect(page.getByText("no tienen botón propio en el sitio")).toBeVisible();
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/NaN|Infinity|undefined/);
});

test("each row draws six months of income with a text alternative", async ({ page }) => {
  await openServices(page, "thisMonth");
  const report = expectedReport("thisMonth");

  for (const row of report.rows) {
    const chart = page.locator(`[data-testid="service-row"][data-item="${row.item}"] [data-col="trend"]`).getByRole("img");
    await expect(chart).toHaveCount(1);
    await expect(chart.locator('[data-testid="mini-bar"]')).toHaveCount(6);
    const label = (await chart.getAttribute("aria-label")) ?? "";
    for (const month of row.trend) {
      expect(label, row.item).toContain(`${monthLabels(month.month).long} ${usd(month.usdMinor)}`);
    }
    expect(label).toContain("mes en curso");
  }
});

test("the services page with data is accessible", async ({ page }) => {
  await openServices(page, "last12");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();

  expect(
    results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) })),
  ).toEqual([]);
});

test.describe("layout", () => {
  for (const width of [PHONE.width, 768, 920, 1024, 1280, 1440]) {
    test(`the page never scrolls sideways at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openServices(page, "last12");
      await expect(page.getByTestId("service-row")).toHaveCount(SALE_ITEMS.length);

      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(sideways).toBe(0);
    });
  }
});
