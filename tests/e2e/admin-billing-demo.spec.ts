// Facturación, configuración y exportación con los datos de ejemplo. Corre con
// `playwright.demo.config.ts` (puerto 3101): la base la siembra
// `buildDemoData(hoy en Argentina)` antes de arrancar y nadie la modifica, así
// los números esperados salen de los mismos datos con las mismas funciones
// puras que usa la página. Son tests de solo lectura.

import AxeBuilder from "@axe-core/playwright";
import { monthlyBilling, sumBilling } from "../../src/admin/billing/summary";
import { STATUS_LABELS, type SaleStatus } from "../../src/admin/catalog";
import { DEMO_MONOTRIBUTO_SETTINGS } from "../../src/admin/demo-data";
import { sumMinor } from "../../src/admin/metrics/math";
import { isIncome } from "../../src/admin/metrics/metric-sale";
import { monotributoStatus } from "../../src/admin/metrics/monotributo";
import { pendingWork } from "../../src/admin/metrics/pending";
import { monthOf } from "../../src/admin/metrics/period";
import { formatMoney, formatPlainAmount } from "../../src/lib/money";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { PHONE } from "../helpers/admin-ui";
import { parseCsv } from "../helpers/csv";
import { demoToday } from "../helpers/demo";

const { today, data, sales } = demoToday();

/** "1234,56" → 123456: los centavos de un número del CSV. */
function minorOf(csvNumber: string): number {
  return Number(csvNumber.replace(",", ""));
}

/** Las ventas que cuentan como cobradas hasta hoy: las mismas que suma el resumen. */
const collectedSales = sales.filter(isIncome).filter((sale) => sale.paidOn <= today);
const pendingSales = collectedSales.filter((sale) => sale.invoiceStatus === "pending");

test.describe("billing with the demo data", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("what is left to invoice is what the overview says, grouped by month", async ({ page }) => {
    const now = new Date();
    const expected = pendingWork(sales, now).uninvoiced;
    expect(expected.count).toBeGreaterThan(0);
    expect(expected.count).toBe(pendingSales.length);

    await page.goto("/admin/facturacion");

    const section = page.getByTestId("uninvoiced");
    await expect(page.getByTestId("uninvoiced-count")).toHaveText(
      `${expected.count} ${expected.count === 1 ? "venta" : "ventas"} sin facturar`,
    );
    await expect(section).toContainText(formatMoney(expected.arsMinor, "ARS"));
    await expect(section).toContainText(formatMoney(expected.usdMinor, "USD"));
    await expect(section.getByRole("checkbox", { name: /Elegir la venta de/ })).toHaveCount(expected.count);

    // Un grupo por mes de cobro, el más nuevo primero, cada uno con su cantidad y su total.
    const byMonth = new Map<string, typeof pendingSales>();
    for (const sale of pendingSales) {
      const month = monthOf(sale.paidOn);
      byMonth.set(month, [...(byMonth.get(month) ?? []), sale]);
    }
    const months = [...byMonth.keys()].sort().reverse();
    const groups = page.getByTestId("uninvoiced-month");
    await expect(groups).toHaveCount(months.length);
    expect(await groups.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-month")))).toEqual(months);
    for (const month of months) {
      const group = page.locator(`[data-testid="uninvoiced-month"][data-month="${month}"]`);
      const inMonth = byMonth.get(month) ?? [];
      await expect(group.getByRole("checkbox", { name: /Elegir la venta de/ })).toHaveCount(inMonth.length);
      await expect(group).toContainText(formatMoney(sumMinor(inMonth.map((sale) => sale.amountArsMinor)), "ARS"));
      await expect(group).toContainText(formatMoney(sumMinor(inMonth.map((sale) => sale.amountUsdMinor)), "USD"));
    }
  });

  test("the overview links to billing and the numbers match", async ({ page }) => {
    const expected = pendingWork(sales, new Date()).uninvoiced;
    await page.goto("/admin");

    const pending = page.getByTestId("pending-uninvoiced");
    await expect(pending).toContainText(formatMoney(expected.arsMinor, "ARS"));
    await pending.getByRole("link", { name: /Ir a facturación/ }).click();

    await expect(page).toHaveURL(/\/admin\/facturacion$/);
    await expect(page.getByRole("heading", { name: "Facturación", level: 1 })).toBeVisible();
    await expect(page.getByTestId("uninvoiced")).toContainText(formatMoney(expected.arsMinor, "ARS"));
  });

  test("settings shows the monotributo loaded in the demo data", async ({ page }) => {
    await page.goto("/admin/configuracion");

    await expect(page.getByRole("heading", { name: "Configuración", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue(DEMO_MONOTRIBUTO_SETTINGS.category);
    await expect(page.getByLabel("Tope anual en pesos")).toHaveValue(
      formatPlainAmount(DEMO_MONOTRIBUTO_SETTINGS.annualCapArsMinor),
    );
    await expect(page.getByLabel("Vigente desde")).toHaveValue(DEMO_MONOTRIBUTO_SETTINGS.validFrom);
    await expect(page.getByText(/Última actualización: \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}/)).toBeVisible();
  });

  test("the 12-month table adds up to what was collected, month by month", async ({ page }) => {
    const months = monthlyBilling(sales, 12, new Date());
    const total = sumBilling(months);
    await page.goto("/admin/facturacion");

    const table = page.getByRole("region", { name: "Cobrado y facturado por mes" });
    await expect(table.getByTestId("billing-month")).toHaveCount(12);
    for (const month of months) {
      const row = table.locator(`[data-testid="billing-month"][data-month="${month.month}"]`);
      const cells = row.getByRole("cell");
      const pesos = (amounts: { count: number; arsMinor: number }) =>
        amounts.count === 0 ? "—" : formatMoney(amounts.arsMinor, "ARS");
      await expect(cells.nth(0), month.month).toHaveText(month.collected.count === 0 ? "—" : String(month.collected.count));
      await expect(cells.nth(1), month.month).toContainText(pesos(month.collected));
      if (month.collected.count > 0) {
        await expect(cells.nth(1), month.month).toContainText(formatMoney(month.collected.usdMinor, "USD"));
      }
      await expect(cells.nth(2), month.month).toContainText(pesos(month.invoiced));
      await expect(cells.nth(3), month.month).toContainText(pesos(month.notRequired));
      await expect(cells.nth(4), month.month).toContainText(pesos(month.pending));
    }

    const totalRow = table.getByTestId("billing-total").getByRole("cell");
    await expect(totalRow.nth(0)).toHaveText(String(total.collected.count));
    await expect(totalRow.nth(1)).toContainText(formatMoney(total.collected.arsMinor, "ARS"));
    await expect(totalRow.nth(2)).toContainText(formatMoney(total.invoiced.arsMinor, "ARS"));
    await expect(totalRow.nth(3)).toContainText(formatMoney(total.notRequired.arsMinor, "ARS"));
    await expect(totalRow.nth(4)).toContainText(formatMoney(total.pending.arsMinor, "ARS"));
    // Lo cobrado de los 12 meses es lo facturado, más lo que no requiere, más lo que falta.
    expect(total.collected.arsMinor).toBe(
      total.invoiced.arsMinor + total.notRequired.arsMinor + total.pending.arsMinor,
    );
  });

  test("the monotributo card on billing is the one of the overview", async ({ page }) => {
    const status = monotributoStatus(sales, DEMO_MONOTRIBUTO_SETTINGS, new Date());
    await page.goto("/admin");
    const overview = await page.getByTestId("monotributo").innerText();

    await page.goto("/admin/facturacion");
    const billing = page.getByTestId("monotributo");

    expect(await billing.innerText()).toBe(overview);
    await expect(billing.getByRole("meter", { name: "Tope anual del monotributo usado" })).toBeVisible();
    await expect(billing).toContainText(formatMoney(status.last12ArsMinor, "ARS"));
    await expect(billing).toContainText(`Tope, categoría ${DEMO_MONOTRIBUTO_SETTINGS.category}`);
  });

  test("the billing export has exactly what was collected, with the same totals as the screens", async ({ page }) => {
    const response = await page.request.get("/admin/facturacion/exportar");

    expect(response.status()).toBe(200);
    const rows = parseCsv(await response.text()).slice(1);
    expect(rows).toHaveLength(collectedSales.length);
    expect(sumMinor(rows.map((cells) => minorOf(cells[7])))).toBe(
      sumMinor(collectedSales.map((sale) => sale.amountArsMinor)),
    );
    expect(sumMinor(rows.map((cells) => minorOf(cells[8])))).toBe(
      sumMinor(collectedSales.map((sale) => sale.amountUsdMinor)),
    );
    // Solo lo cobrado, y de la más vieja a la más nueva.
    expect(new Set(rows.map((cells) => cells[14]))).toEqual(new Set(["Cobrada", "Entregada"]));
    const dates = rows.map((cells) => cells[0].split("/").reverse().join("-"));
    expect([...dates].sort()).toEqual(dates);

    // Lo que queda por facturar en el archivo es lo que dice la pantalla.
    const pending = await page.request.get("/admin/facturacion/exportar?factura=pending");
    const pendingRows = parseCsv(await pending.text()).slice(1);
    expect(pendingRows).toHaveLength(pendingSales.length);
    expect(sumMinor(pendingRows.map((cells) => minorOf(cells[7])))).toBe(
      sumMinor(pendingSales.map((sale) => sale.amountArsMinor)),
    );
    // Las facturadas traen tipo, número y fecha.
    const issued = await page.request.get("/admin/facturacion/exportar?factura=issued");
    const issuedRows = parseCsv(await issued.text()).slice(1);
    expect(issuedRows.length).toBeGreaterThan(0);
    for (const cells of issuedRows) {
      expect(cells[15]).toBe("Facturada");
      expect(["C", "E"]).toContain(cells[16]);
      expect(cells[17]).toMatch(/^\d{4}-\d{8}$/);
      expect(cells[18]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    }
  });

  test("the sales export has every sale, whatever its status, and filters like the list", async ({ page }) => {
    const all = parseCsv(await (await page.request.get("/admin/ventas/exportar")).text()).slice(1);
    expect(all).toHaveLength(data.sales.length);
    expect(new Set(all.map((cells) => cells[14]))).toEqual(
      new Set(data.sales.map((sale) => STATUS_LABELS[sale.status as SaleStatus])),
    );

    const cancelled = parseCsv(await (await page.request.get("/admin/ventas/exportar?estado=cancelled")).text()).slice(1);
    expect(cancelled).toHaveLength(data.sales.filter((sale) => sale.status === "cancelled").length);
    expect(new Set(cancelled.map((cells) => cells[14]))).toEqual(new Set(["Cancelada"]));
  });

  test("the sale page shows the invoice of an invoiced sale and offers to undo it (read only: nothing is clicked)", async ({
    page,
  }) => {
    const issued = data.sales.find((sale) => sale.invoiceStatus === "issued");
    const notRequired = data.sales.find((sale) => sale.invoiceStatus === "not_required" && sale.status !== "cancelled");
    expect(issued?.invoiceNumber).toBeTruthy();
    expect(notRequired).toBeDefined();

    await page.goto(`/admin/ventas/${issued!.id}`);
    const panel = page.getByTestId("invoice-panel");
    await expect(panel).toContainText("Facturada");
    await expect(panel).toContainText(`Factura ${issued!.invoiceType}`);
    await expect(panel).toContainText(issued!.invoiceNumber!);
    await expect(panel).toContainText(issued!.invoicedOn!.split("-").reverse().join("/"));
    await expect(panel.getByRole("button", { name: "Volver a pendiente" })).toBeVisible();

    await page.goto(`/admin/ventas/${notRequired!.id}`);
    await expect(page.getByTestId("invoice-panel")).toContainText("No requiere");
    await expect(page.getByTestId("invoice-panel").getByRole("button", { name: "Volver a pendiente" })).toBeVisible();
  });

  test("the sales list offers the export with the filter that is on", async ({ page }) => {
    await page.goto("/admin/ventas?estado=paid");

    const href = await page.getByRole("link", { name: "Exportar CSV" }).getAttribute("href");
    expect(href).toBe("/admin/ventas/exportar?estado=paid");
  });

  test("billing and settings pass the automated accessibility checks and fit a phone", async ({ page }) => {
    const audit = async (label: string) => {
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations.map(({ id, nodes }) => ({ label, id, targets: nodes.map((n) => n.target) })),
      ).toEqual([]);
    };

    await page.goto("/admin/facturacion");
    await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
    await audit("billing");
    await page.goto("/admin/configuracion");
    await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
    await audit("settings");

    await page.setViewportSize(PHONE);
    for (const path of ["/admin/facturacion", "/admin/configuracion"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const viewport = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(viewport.scrollWidth, path).toBeLessThanOrEqual(viewport.innerWidth);
    }
  });
});
