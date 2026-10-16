// Facturación, configuración del monotributo y exportación CSV. Corre con el
// servidor principal (puerto 3100): la base se comparte con los otros tests en
// paralelo, así que cada test carga alumnos con nombres únicos y mira solo sus
// propias filas. Los totales contra los datos de ejemplo están en
// `admin-billing-demo.spec.ts`.

import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import type { Download, Page } from "@playwright/test";
import {
  ADMIN_COOKIE,
  expect,
  loginAsAdmin,
  signTestToken,
  test,
} from "../helpers/admin";
import {
  PHONE,
  createSale,
  fillSale,
  openNewSale,
  uniqueName,
  whenInteractive,
} from "../helpers/admin-ui";
import { parseCsv } from "../helpers/csv";
import { formatDay } from "../../src/admin/dates";
import { addDays, todayInArgentina } from "../../src/admin/metrics/period";

const BILLING_PATH = "/admin/facturacion";
const SETTINGS_PATH = "/admin/configuracion";
const EXPORT_PATHS = ["/admin/ventas/exportar", "/admin/facturacion/exportar"] as const;
const CSV_HEADER_LINE = [
  "Fecha de cobro",
  "Alumno",
  "País",
  "Servicio",
  "Descripción",
  "Moneda",
  "Monto",
  "Pesos",
  "Dólares",
  "Tipo de cambio",
  "Cotización del dólar",
  "Fuente",
  "Fecha de cotización",
  "Medio de pago",
  "Estado",
  "Factura",
  "Tipo",
  "Número",
  "Fecha de factura",
];

/** Un número de factura único por test, con la forma que usa ARCA. */
function uniqueInvoiceNumber(): string {
  return `00003-${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

function rowOf(page: Page, student: string) {
  return page.getByRole("row").filter({ hasText: student });
}

function pickerOf(page: Page, student: string) {
  return page.getByRole("checkbox", { name: new RegExp(`Elegir la venta de ${student}`) });
}

/** Abre Facturación y espera a que la lista esté lista para usarse. */
async function openBilling(page: Page): Promise<void> {
  await page.goto(BILLING_PATH);
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
}

async function readDownload(download: Download): Promise<string> {
  return readFile(await download.path(), "utf8");
}

async function mark(page: Page, label: "Marcar como facturadas" | "No requiere factura"): Promise<void> {
  await page.getByRole("button", { name: label }).click();
}

test.describe("billing", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("marks two sales as invoiced and they leave the pending list", async ({ page }) => {
    const first = uniqueName("Ana facturada");
    const second = uniqueName("Beto facturado");
    const number = uniqueInvoiceNumber();
    await createSale(page, { student: first });
    await createSale(page, { student: second });
    await openBilling(page);
    await expect(rowOf(page, first)).toHaveCount(1);
    await expect(rowOf(page, second)).toHaveCount(1);

    await pickerOf(page, first).check();
    await pickerOf(page, second).check();
    // Dos clases de 40 dólares con el dólar fijo a 1.500.
    await expect(page.getByTestId("selection-summary")).toContainText("2 ventas elegidas: $ 120.000,00 (USD 80,00)");
    await page.getByLabel("Tipo de factura").selectOption("C");
    await page.getByLabel("Número de factura").fill(number);
    await mark(page, "Marcar como facturadas");

    await expect(page).toHaveURL(/\/admin\/facturacion\?guardada=facturadas&cantidad=2$/);
    await expect(page.getByRole("status").filter({ hasText: "2 ventas marcadas como facturadas." })).toBeVisible();
    await expect(rowOf(page, first)).toHaveCount(0);
    await expect(rowOf(page, second)).toHaveCount(0);

    // En Ventas quedan facturadas.
    for (const student of [first, second]) {
      await page.goto(`/admin/ventas?q=${encodeURIComponent(student)}`);
      await expect(rowOf(page, student)).toContainText("Facturada");
    }
  });

  test("marks a sale as not requiring an invoice without asking for invoice data", async ({ page }) => {
    const student = uniqueName("Caro sin factura");
    await createSale(page, { student });
    await openBilling(page);

    await pickerOf(page, student).check();
    await mark(page, "No requiere factura");

    await expect(page).toHaveURL(/\/admin\/facturacion\?guardada=sin-factura&cantidad=1$/);
    await expect(
      page.getByRole("status").filter({ hasText: "1 venta marcada como «No requiere factura»." }),
    ).toBeVisible();
    await expect(rowOf(page, student)).toHaveCount(0);
    await page.goto(`/admin/ventas?q=${encodeURIComponent(student)}`);
    await expect(rowOf(page, student)).toContainText("No requiere");
  });

  test("asks to choose a sale and to fill the invoice, and keeps what was chosen", async ({ page }) => {
    const student = uniqueName("Dani incompleta");
    await createSale(page, { student });
    await openBilling(page);

    await mark(page, "Marcar como facturadas");
    await expect(page.getByText("Elegí al menos una venta.")).toBeVisible();

    await pickerOf(page, student).check();
    // Marcar el "no requiere" sin datos de factura no los pide, pero sí el tipo y el número para facturar.
    await mark(page, "Marcar como facturadas");
    await expect(page.getByText("Escribí el número de la factura.")).toBeVisible();
    await expect(page.getByText("Elegí el tipo de factura, C o E.")).toBeVisible();
    await expect(page.getByLabel("Número de factura")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert").filter({ hasText: "Revisá los campos marcados." })).toBeVisible();
    // La venta sigue elegida y sigue en la lista.
    await expect(pickerOf(page, student)).toBeChecked();
    await expect(rowOf(page, student)).toHaveCount(1);

    await page.getByLabel("Tipo de factura").selectOption("E");
    // El campo no deja escribir más de 30 caracteres (el servidor también lo rechaza: ver los tests unitarios).
    await expect(page.getByLabel("Número de factura")).toHaveAttribute("maxlength", "30");
    await page.getByLabel("Número de factura").fill(uniqueInvoiceNumber());
    await page.getByLabel("Fecha de la factura").fill("");
    await mark(page, "Marcar como facturadas");
    await expect(page.getByText("Cargá la fecha de la factura.")).toBeVisible();

    await page.getByLabel("Fecha de la factura").fill("2026-10-01");
    await mark(page, "Marcar como facturadas");
    await expect(page).toHaveURL(/guardada=facturadas&cantidad=1$/);
    await expect(rowOf(page, student)).toHaveCount(0);
  });

  test("a batch with one sale that can no longer be marked changes nothing", async ({ context, page }) => {
    const stale = uniqueName("Eli ya marcada");
    const fresh = uniqueName("Fede sigue pendiente");
    await createSale(page, { student: stale });
    await createSale(page, { student: fresh });
    await openBilling(page);

    // Desde otra pestaña, alguien marca una de las dos como "no requiere".
    const other = await context.newPage();
    await other.goto(BILLING_PATH);
    await expect(other.locator("form[data-hydrated='true']")).toBeVisible();
    await pickerOf(other, stale).check();
    await mark(other, "No requiere factura");
    await expect(other).toHaveURL(/guardada=sin-factura/);
    await other.close();

    // La lista de la primera pestaña quedó vieja: la intenta facturar junto con la otra.
    await pickerOf(page, stale).check();
    await pickerOf(page, fresh).check();
    await page.getByLabel("Tipo de factura").selectOption("C");
    await page.getByLabel("Número de factura").fill(uniqueInvoiceNumber());
    await mark(page, "Marcar como facturadas");

    await expect(page.getByRole("alert").filter({ hasText: "No se cambió ninguna" })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/facturacion$/);

    // La que estaba bien sigue sin facturar.
    await page.goto(`/admin/ventas?q=${encodeURIComponent(fresh)}`);
    await expect(rowOf(page, fresh)).toContainText("Sin facturar");
  });

  test("picking a month picks its sales, and the sum follows the choice", async ({ page }) => {
    const first = uniqueName("Gabi del mes");
    const second = uniqueName("Hugo del mes");
    await createSale(page, { student: first });
    await createSale(page, { student: second });
    await openBilling(page);

    const month = page.getByTestId("uninvoiced-month").filter({ has: rowOf(page, first) });
    await month.getByRole("checkbox", { name: /Elegir todas las ventas de / }).check();
    await expect(pickerOf(page, first)).toBeChecked();
    await expect(pickerOf(page, second)).toBeChecked();
    await expect(page.getByTestId("selection-summary")).toContainText("ventas elegidas");

    await pickerOf(page, second).uncheck();
    await expect(pickerOf(page, second)).not.toBeChecked();
    // El grupo queda "a medias": ni todo ni nada.
    const monthBox = month.getByRole("checkbox", { name: /Elegir todas las ventas de / });
    await expect(monthBox).not.toBeChecked();
    expect(await monthBox.evaluate((input: HTMLInputElement) => input.indeterminate)).toBe(true);

    // La casilla de arriba elige todo y, tocada de nuevo, lo suelta.
    const everything = page.getByRole("checkbox", { name: "Elegir todas las ventas sin facturar" });
    await everything.check();
    await expect(pickerOf(page, second)).toBeChecked();
    await everything.uncheck();
    await expect(pickerOf(page, first)).not.toBeChecked();
    await expect(pickerOf(page, second)).not.toBeChecked();
    await expect(page.getByTestId("selection-summary")).toContainText("Elegí las ventas que querés marcar.");
  });

  test("a hand-typed address with a strange notice still shows the screen", async ({ page }) => {
    for (const query of [
      "guardada=%3Cscript%3Ealert(1)%3C/script%3E&cantidad=x",
      "guardada=__proto__&cantidad=__proto__",
      "__proto__=1&constructor=2",
      "guardada=%00&cantidad=%00",
    ]) {
      const response = await page.goto(`${BILLING_PATH}?${query}`);

      expect(response?.status(), query).toBe(200);
      await expect(page.getByRole("heading", { name: "Facturación", level: 1 }), query).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "marcada" }), query).toHaveCount(0);
    }

    // Un aviso conocido con una cantidad que no sirve dice lo que pasó sin inventar el número.
    await page.goto(`${BILLING_PATH}?guardada=facturadas&cantidad=99999999999`);
    await expect(page.getByRole("status").filter({ hasText: "Ventas marcadas como facturadas." })).toBeVisible();
  });

  test("the 12-month table, the monotributo card and the export are on the screen", async ({ page }) => {
    await createSale(page, { student: uniqueName("Ines mensual") });

    await page.goto(BILLING_PATH);

    const table = page.getByRole("region", { name: "Cobrado y facturado por mes" });
    await expect(table.getByTestId("billing-month")).toHaveCount(12);
    await expect(table.getByTestId("billing-total")).toContainText("Total de 12 meses");
    await expect(page.getByTestId("monotributo")).toBeVisible();
    await expect(page.getByRole("button", { name: "Descargar CSV" })).toBeVisible();
  });

  test("billing and settings fit a 375px phone without scrolling the page sideways", async ({ page }) => {
    const student = uniqueName("Juli celular");
    await createSale(page, { student });
    await page.setViewportSize(PHONE);

    for (const path of [BILLING_PATH, SETTINGS_PATH]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const viewport = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(viewport.scrollWidth, path).toBeLessThanOrEqual(viewport.innerWidth);
    }

    await page.goto(BILLING_PATH);
    const list = page.getByRole("region", { name: "Ventas sin facturar" });
    await expect(list).toBeVisible();
    const sizes = await list.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));
    expect(sizes.overflowX).toBe("auto");
    expect(sizes.scrollWidth).toBeGreaterThan(sizes.clientWidth);
  });

  test("the billing and settings pages pass the automated accessibility checks", async ({ page }) => {
    const student = uniqueName("Karen accesible");
    await createSale(page, { student });

    const audit = async (label: string) => {
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations.map(({ id, nodes }) => ({ label, id, targets: nodes.map((n) => n.target) })),
      ).toEqual([]);
    };

    await openBilling(page);
    await expect(rowOf(page, student)).toBeVisible();
    await audit("billing");

    // Con errores, con una venta elegida.
    await pickerOf(page, student).check();
    await mark(page, "Marcar como facturadas");
    await expect(page.getByText("Escribí el número de la factura.")).toBeVisible();
    await audit("billing with errors");

    await page.goto(SETTINGS_PATH);
    await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
    await audit("settings");
    await page.getByLabel("Tope anual en pesos").fill("abc");
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await expect(page.getByText(/El monto no es válido/)).toBeVisible();
    await audit("settings with errors");
  });
});

test.describe("exports", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("export downloads the filtered sales as csv", async ({ page }) => {
    const student = uniqueName("Lara exportada");
    const other = uniqueName("Mario no exportado");
    await createSale(page, { student });
    await createSale(page, { student: other });
    await page.goto(`/admin/ventas?q=${encodeURIComponent(student)}`);

    const downloading = page.waitForEvent("download");
    await page.getByRole("link", { name: "Exportar CSV" }).click();
    const download = await downloading;

    expect(download.suggestedFilename()).toMatch(/^ventas_inicio_a_\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await readDownload(download);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(CSV_HEADER_LINE);
    // Solo la venta filtrada, con los números listos para Excel.
    expect(rows).toHaveLength(2);
    // Hasta la fuente de la cotización: en pesos, 40 dólares a 1.500 (Tipo de cambio y Cotización del dólar).
    expect(rows[1].slice(1, 12)).toEqual([
      student,
      "",
      "Clase 1 a 1",
      "",
      "USD",
      "40,00",
      "60000,00",
      "40,00",
      "1500,00",
      "1500,00",
      "valor fijo de prueba",
    ]);
    // Después de la fecha de cotización: medio de pago, estado y la factura (todavía sin datos).
    expect(rows[1].slice(13)).toEqual(["Transferencia", "Cobrada", "Sin facturar", "", "", ""]);
    expect(rows[1][0]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(rows[1][12]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  test("the export link carries the filters of the list and the file respects them", async ({ page }) => {
    const student = uniqueName("Nora filtrada");
    await createSale(page, { student, item: "vodRecorded" });
    await createSale(page, { student, item: "lesson" });
    const query = `q=${encodeURIComponent(student)}&servicio=vodRecorded&estado=paid`;
    await page.goto(`/admin/ventas?${query}`);

    const href = await page.getByRole("link", { name: "Exportar CSV" }).getAttribute("href");
    const url = new URL(href!, "http://localhost");
    expect(url.pathname).toBe("/admin/ventas/exportar");
    expect(url.searchParams.get("q")).toBe(student);
    expect(url.searchParams.get("servicio")).toBe("vodRecorded");
    expect(url.searchParams.get("estado")).toBe("paid");

    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
    const rows = parseCsv(await response.text());
    expect(rows).toHaveLength(2);
    expect(rows[1][3]).toBe("VOD review grabado");
  });

  test("the file name carries the date range of the filter", async ({ page }) => {
    const response = await page.request.get("/admin/ventas/exportar?desde=2026-01-01&hasta=2026-03-31");

    expect(response.status()).toBe(200);
    expect(response.headers()["content-disposition"]).toBe(
      'attachment; filename="ventas_2026-01-01_a_2026-03-31.csv"',
    );
  });

  test("download headers: csv, attachment, not cached and not sniffable", async ({ page }) => {
    for (const path of EXPORT_PATHS) {
      const response = await page.request.get(path);

      expect(response.status(), path).toBe(200);
      const headers = response.headers();
      expect(headers["content-type"], path).toBe("text/csv; charset=utf-8");
      expect(headers["content-disposition"], path).toMatch(/^attachment; filename="[A-Za-z0-9._-]+\.csv"$/);
      expect(headers["cache-control"], path).toBe("no-store");
      expect(headers["x-content-type-options"], path).toBe("nosniff");
      expect(parseCsv(await response.text())[0], path).toEqual(CSV_HEADER_LINE);
    }
  });

  test("text that could run as a formula in Excel is written as plain text", async ({ page }) => {
    const student = uniqueName("=Ojo");
    const formula = '=HYPERLINK("http://malo.example";"clic")';
    await openNewSale(page);
    await fillSale(page, { student, item: "other", amount: "10", paymentMethod: "cash", status: "paid" });
    await page.getByLabel("Descripción", { exact: false }).fill(formula);
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await expect(page).toHaveURL(/\/admin\/ventas\?guardada=creada$/);

    const response = await page.request.get(`/admin/ventas/exportar?q=${encodeURIComponent(student)}`);

    const text = await response.text();
    const rows = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[1][1]).toBe(`'${student}`);
    expect(rows[1][4]).toBe(`'${formula}`);
    expect(text).toContain(`"'=HYPERLINK(""http://malo.example"";""clic"")"`);
  });

  test("the billing export has what was collected, with the invoice data, and leaves out the rest", async ({ page }) => {
    const base = uniqueName("Olga contador");
    const collected = `${base} cobrada`;
    const invoiced = `${base} facturada`;
    const unpaid = `${base} pendiente`;
    const number = uniqueInvoiceNumber();
    await createSale(page, { student: collected });
    await createSale(page, { student: invoiced });
    await createSale(page, { student: unpaid, status: "pending", paidOn: "" });
    await openBilling(page);
    await pickerOf(page, invoiced).check();
    await page.getByLabel("Tipo de factura").selectOption("E");
    await page.getByLabel("Número de factura").fill(number);
    await page.getByLabel("Fecha de la factura").fill("2026-10-02");
    await mark(page, "Marcar como facturadas");
    await expect(page).toHaveURL(/guardada=facturadas/);

    const response = await page.request.get(`/admin/facturacion/exportar?q=${encodeURIComponent(base)}`);

    const rows = parseCsv(await response.text()).slice(1);
    expect(rows.map((cells) => cells[1]).sort()).toEqual([collected, invoiced].sort());
    const invoicedRow = rows.find((cells) => cells[1] === invoiced)!;
    expect(invoicedRow.slice(15)).toEqual(["Facturada", "E", number, "02/10/2026"]);
    expect(response.headers()["content-disposition"]).toMatch(/^attachment; filename="facturacion_inicio_a_/);

    // Con el estado de la factura como filtro.
    const pending = await page.request.get(
      `/admin/facturacion/exportar?q=${encodeURIComponent(base)}&factura=pending`,
    );
    expect(parseCsv(await pending.text()).slice(1).map((cells) => cells[1])).toEqual([collected]);
  });

  test("the export form of Facturación downloads the file", async ({ page }) => {
    await createSale(page, { student: uniqueName("Pablo descarga") });
    await page.goto(BILLING_PATH);

    await page.getByLabel("Desde").fill("2000-01-01");
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Descargar CSV" }).click();
    const download = await downloading;

    expect(download.suggestedFilename()).toMatch(/^facturacion_2000-01-01_a_\d{4}-\d{2}-\d{2}\.csv$/);
    const rows = parseCsv(await readDownload(download));
    expect(rows[0]).toEqual(CSV_HEADER_LINE);
    expect(rows.length).toBeGreaterThan(1);
  });

  test("hand-typed filters that make no sense never break the download", async ({ page }) => {
    for (const path of EXPORT_PATHS) {
      for (const query of [
        "desde=0000-01-01&hasta=9999-12-31",
        "q=%00",
        "q=a%00b&estado=__proto__",
        "__proto__=1&constructor=2&factura=toString",
        "pagina=999999999999",
        `q=${"A".repeat(4000)}`,
      ]) {
        const response = await page.request.get(`${path}?${query.slice(0, 600)}`);

        expect(response.status(), `${path}?${query.slice(0, 40)}`).toBe(200);
        expect(response.headers()["content-type"]).toBe("text/csv; charset=utf-8");
      }
    }
  });
});

test.describe("exports without a session", () => {
  for (const path of EXPORT_PATHS) {
    test(`export endpoints require a session: ${path}`, async ({ request }) => {
      const anonymous = await request.get(path, { maxRedirects: 0 });

      expect(anonymous.status()).toBe(307);
      expect(anonymous.headers().location).toContain("/admin/login");
      expect(anonymous.headers()["content-disposition"]).toBeUndefined();
      expect(await anonymous.text()).not.toContain("Fecha de cobro");

      const forged = {
        "free text": "una-cookie-inventada",
        "signed with another secret": await signTestToken({
          secret: "otro-secreto-que-no-es-el-del-panel-0123456789",
        }),
        "expired": await signTestToken({ expiresInSeconds: -60 }),
      };
      for (const [label, value] of Object.entries(forged)) {
        const response = await request.get(`${path}?q=a`, {
          maxRedirects: 0,
          headers: { cookie: `${ADMIN_COOKIE}=${value}` },
        });
        expect(response.status(), label).toBe(307);
        expect(response.headers().location, label).toContain("/admin/login");
        expect(await response.text(), label).not.toContain("Fecha de cobro");
      }

      // Con una sesión de verdad, las mismas direcciones sí entregan el archivo.
      const valid = await request.get(path, {
        maxRedirects: 0,
        headers: { cookie: `${ADMIN_COOKIE}=${await signTestToken()}` },
      });
      expect(valid.status()).toBe(200);
      expect(valid.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    });
  }

  for (const path of [BILLING_PATH, SETTINGS_PATH]) {
    test(`the page redirects to the login without a session: ${path}`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });

      expect(response.status()).toBe(307);
      expect(response.headers().location).toContain(`/admin/login?next=${encodeURIComponent(path)}`);
    });
  }
});

test.describe("settings", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("monotributo meter appears after saving settings", async ({ page }) => {
    // Con ventas cobradas la pantalla de Facturación muestra el medidor.
    await createSale(page, { student: uniqueName("Rita medidor") });
    await page.goto(SETTINGS_PATH);
    const form = page.locator("form[data-hydrated='true']");
    await expect(form).toBeVisible();

    await page.getByLabel("Categoría", { exact: true }).selectOption("D");
    await page.getByLabel("Tope anual en pesos").fill("26.000.000,00");
    await page.getByLabel("Vigente desde").fill("2026-08-01");
    await page.getByRole("button", { name: "Guardar configuración" }).click();

    await expect(page).toHaveURL(/\/admin\/configuracion\?guardada=1$/);
    await expect(page.getByRole("status").filter({ hasText: "Configuración guardada." })).toBeVisible();
    // Lo guardado vuelve al formulario, con sus centavos.
    await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue("D");
    await expect(page.getByLabel("Tope anual en pesos")).toHaveValue("26000000,00");
    await expect(page.getByLabel("Vigente desde")).toHaveValue("2026-08-01");
    await expect(page.getByText(/Última actualización: \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}/)).toBeVisible();

    await page.getByRole("link", { name: "Ver el medidor en Facturación" }).click();

    await expect(page).toHaveURL(/\/admin\/facturacion$/);
    const card = page.getByTestId("monotributo");
    await expect(card.getByRole("meter", { name: "Tope anual del monotributo usado" })).toBeVisible();
    await expect(card).toContainText("Tope, categoría D");
    await expect(card).toContainText("$ 26.000.000,00");
    await expect(card).toContainText("vigente desde el 01/08/2026");
  });

  test("shows a message for each field that is wrong and saves nothing", async ({ page }) => {
    await page.goto(SETTINGS_PATH);
    await expect(page.locator("form[data-hydrated='true']")).toBeVisible();

    await page.getByLabel("Categoría", { exact: true }).selectOption("");
    await page.getByLabel("Tope anual en pesos").fill("1.500");
    await page.getByLabel("Vigente desde").fill("");
    await page.getByRole("button", { name: "Guardar configuración" }).click();

    await expect(page).toHaveURL(/\/admin\/configuracion$/);
    await expect(page.getByText("Elegí la categoría, de la A a la K.")).toBeVisible();
    await expect(page.getByText(/es ambiguo/)).toBeVisible();
    await expect(page.getByText("Cargá desde qué fecha rige el tope.")).toBeVisible();
    await expect(page.getByLabel("Tope anual en pesos")).toHaveAttribute("aria-invalid", "true");
    // Lo escrito no se pierde.
    await expect(page.getByLabel("Tope anual en pesos")).toHaveValue("1.500");
    await expect(page.getByRole("status").filter({ hasText: "Configuración guardada." })).toHaveCount(0);

    // Corregir un campo borra su error y deja los otros.
    await page.getByLabel("Tope anual en pesos").fill("1500000");
    await expect(page.getByText(/es ambiguo/)).toHaveCount(0);
    await expect(page.getByText("Cargá desde qué fecha rige el tope.")).toBeVisible();
  });

  test("links to the ARCA table in a new tab and does not present the cap as official", async ({ page }) => {
    await page.goto(SETTINGS_PATH);

    const link = page.getByRole("link", { name: /Ver la tabla vigente en ARCA/ });
    await expect(link).toHaveAttribute("href", "https://www.arca.gob.ar/monotributo/categorias.asp");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page.getByText(/no los consulta en ARCA ni los verifica/)).toBeVisible();
    await expect(page.getByText(/Confirmá con él qué categoría y qué tope te corresponden/)).toBeVisible();
  });

  test("the sidebar leads to both pages", async ({ page }) => {
    await page.goto("/admin/ventas");
    const nav = page.getByRole("navigation", { name: "Secciones del panel" });

    await nav.getByRole("link", { name: "Facturación" }).click();
    await expect(page).toHaveURL(/\/admin\/facturacion$/);
    await expect(page.getByRole("heading", { name: "Facturación", level: 1 })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Facturación" })).toHaveAttribute("aria-current", "page");

    await nav.getByRole("link", { name: "Configuración" }).click();
    await expect(page).toHaveURL(/\/admin\/configuracion$/);
    await expect(page.getByRole("heading", { name: "Configuración", level: 1 })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Configuración" })).toHaveAttribute("aria-current", "page");
  });

  test("the save button waits for the page to be ready", async ({ page }) => {
    await page.goto(SETTINGS_PATH);

    const button = page.getByRole("button", { name: "Guardar configuración" });
    await whenInteractive(button);
    await expect(button).toBeEnabled();
  });
});

/** Marca una venta como facturada desde Facturación y espera a volver. */
async function invoiceOne(
  page: Page,
  student: string,
  invoice: { type: "C" | "E"; number: string; issuedOn?: string },
): Promise<void> {
  await openBilling(page);
  await pickerOf(page, student).check();
  await page.getByLabel("Tipo de factura").selectOption(invoice.type);
  await page.getByLabel("Número de factura").fill(invoice.number);
  if (invoice.issuedOn) await page.getByLabel("Fecha de la factura").fill(invoice.issuedOn);
  await mark(page, "Marcar como facturadas");
  await expect(page).toHaveURL(/guardada=facturadas&cantidad=1$/);
}

/** La dirección de la ficha de una venta, buscándola en la lista de Ventas por el nombre del alumno. */
async function saleHref(page: Page, student: string): Promise<string> {
  await page.goto(`/admin/ventas?q=${encodeURIComponent(student)}`);
  const href = await rowOf(page, student).getByRole("link", { name: student }).getAttribute("href");
  expect(href).toMatch(/^\/admin\/ventas\/[0-9a-f-]{36}$/);
  return href!;
}

test.describe("undoing an invoice", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("an invoiced sale shows its invoice on its page and goes back to pending", async ({ page }) => {
    const student = uniqueName("Rosa deshace");
    const wrong = uniqueInvoiceNumber();
    const right = uniqueInvoiceNumber();
    await createSale(page, { student });
    await invoiceOne(page, student, { type: "C", number: wrong, issuedOn: "2026-10-02" });
    await expect(rowOf(page, student)).toHaveCount(0);

    // La ficha muestra la factura, solo para leer.
    await page.goto(await saleHref(page, student));
    const panel = page.getByTestId("invoice-panel");
    await expect(panel).toContainText("Facturada");
    await expect(panel).toContainText("Factura C");
    await expect(panel).toContainText(wrong);
    await expect(panel).toContainText("02/10/2026");

    await panel.getByRole("button", { name: "Volver a pendiente" }).click();

    await expect(page).toHaveURL(/\/admin\/ventas\/[0-9a-f-]{36}\?factura=pendiente$/);
    await expect(page.getByRole("status").filter({ hasText: "La venta volvió a pendiente" })).toBeVisible();
    await expect(panel).toContainText("Sin facturar");
    await expect(panel).not.toContainText(wrong);
    await expect(panel.getByRole("button", { name: "Volver a pendiente" })).toHaveCount(0);

    // Vuelve a estar en Facturación, y se corrige: deshacer y marcar de nuevo.
    await invoiceOne(page, student, { type: "E", number: right });
    await page.goto(await saleHref(page, student));
    await expect(page.getByTestId("invoice-panel")).toContainText(right);
    await expect(page.getByTestId("invoice-panel")).not.toContainText(wrong);
    await expect(page.getByTestId("invoice-panel")).toContainText("Factura E");
  });

  test("an invoiced sale that was cancelled keeps its invoice on screen, without the undo button, and points to ARCA", async ({
    page,
  }) => {
    const student = uniqueName("Lola cancelada");
    const number = uniqueInvoiceNumber();
    await createSale(page, { student });
    await invoiceOne(page, student, { type: "C", number, issuedOn: "2026-10-02" });
    await page.goto(await saleHref(page, student));
    // Con la factura emitida, el formulario avisa que hay que revisarla si cambia el monto, la moneda o la fecha.
    const form = page.locator("form[data-hydrated='true']");
    await expect(
      form.getByText("Esta venta ya tiene factura; si cambiás el monto, la moneda o la fecha, revisá la factura."),
    ).toBeVisible();
    await expect(page.getByTestId("invoice-panel").getByRole("button", { name: "Volver a pendiente" })).toBeVisible();

    await form.getByLabel("Estado", { exact: true }).selectOption("cancelled");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page).toHaveURL(/\/admin\/ventas\?guardada=editada$/);

    await page.goto(await saleHref(page, student));
    const panel = page.getByTestId("invoice-panel");
    await expect(panel).toContainText("Factura C");
    await expect(panel).toContainText(number);
    await expect(panel).toContainText("02/10/2026");
    await expect(panel).toContainText("la venta está cancelada");
    await expect(panel).toContainText("nota de crédito");
    await expect(panel).toContainText("ARCA");
    await expect(panel.getByRole("button")).toHaveCount(0);
  });

  test("a sale without an invoice does not show the invoice warning in its form", async ({ page }) => {
    const student = uniqueName("Nora sin aviso");
    await createSale(page, { student });

    await page.goto(await saleHref(page, student));

    await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
    await expect(page.getByText("Esta venta ya tiene factura")).toHaveCount(0);
  });

  test("a sale collected on a future day says from which day it can be invoiced", async ({ page }) => {
    const student = uniqueName("Mora futura");
    const payDay = addDays(todayInArgentina(), 10);
    await createSale(page, { student, paidOn: payDay });

    await page.goto(await saleHref(page, student));

    const panel = page.getByTestId("invoice-panel");
    await expect(panel).toContainText(`La vas a poder facturar desde el ${formatDay(payDay)}.`);
    await expect(panel.getByRole("link")).toHaveCount(0);
    await expect(panel.getByRole("button")).toHaveCount(0);
    // Y todavía no está en la lista de Facturación.
    await openBilling(page);
    await expect(rowOf(page, student)).toHaveCount(0);
  });

  test("a sale marked as not requiring an invoice can go back to pending and is listed again", async ({ page }) => {
    const student = uniqueName("Silvia deshace");
    await createSale(page, { student });
    await openBilling(page);
    await pickerOf(page, student).check();
    await mark(page, "No requiere factura");
    await expect(page).toHaveURL(/guardada=sin-factura/);
    await expect(rowOf(page, student)).toHaveCount(0);

    await page.goto(await saleHref(page, student));
    const panel = page.getByTestId("invoice-panel");
    await expect(panel).toContainText("No requiere");
    await panel.getByRole("button", { name: "Volver a pendiente" }).click();
    await expect(page).toHaveURL(/\?factura=pendiente$/);

    await openBilling(page);
    await expect(rowOf(page, student)).toHaveCount(1);
  });

  test("the panel of a sale that is not invoiced has nothing to undo, and the sale page keeps working", async ({
    page,
  }) => {
    const student = uniqueName("Tomas sin factura");
    await createSale(page, { student });
    const href = await saleHref(page, student);

    await page.goto(href);

    const panel = page.getByTestId("invoice-panel");
    await expect(panel).toContainText("Sin facturar");
    await expect(panel.getByRole("link", { name: "Facturación" })).toHaveAttribute("href", "/admin/facturacion");
    await expect(panel.getByRole("button")).toHaveCount(0);
    // El formulario de la venta sigue ahí.
    await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeVisible();
  });

  test("undoing from a stale page says there was no invoice to remove and changes nothing else", async ({
    context,
    page,
  }) => {
    const student = uniqueName("Ursula vieja");
    await createSale(page, { student });
    await invoiceOne(page, student, { type: "C", number: uniqueInvoiceNumber() });
    const href = await saleHref(page, student);
    await page.goto(href);
    await expect(page.getByTestId("invoice-panel")).toContainText("Facturada");

    // Desde otra pestaña, alguien ya la devolvió a pendiente.
    const other = await context.newPage();
    await other.goto(href);
    await other.getByTestId("invoice-panel").getByRole("button", { name: "Volver a pendiente" }).click();
    await expect(other).toHaveURL(/\?factura=pendiente$/);
    await other.close();

    await page.getByTestId("invoice-panel").getByRole("button", { name: "Volver a pendiente" }).click();

    await expect(page).toHaveURL(/\?factura=no-se-pudo$/);
    await expect(page.getByRole("alert").filter({ hasText: "no tenía factura para quitar" })).toBeVisible();
    await expect(page.getByTestId("invoice-panel")).toContainText("Sin facturar");
  });

  test("a hand-typed notice on the sale page shows nothing strange", async ({ page }) => {
    const student = uniqueName("Vera aviso");
    await createSale(page, { student });
    const href = await saleHref(page, student);

    for (const query of [
      "factura=__proto__",
      "factura=constructor",
      "factura=%00",
      "factura=%3Cscript%3E",
      "__proto__=1",
    ]) {
      const response = await page.goto(`${href}?${query}`);

      expect(response?.status(), query).toBe(200);
      await expect(page.getByRole("heading", { name: "Editar venta" }), query).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "volvió a pendiente" }), query).toHaveCount(0);
    }
  });

  test("the sale page with the invoice panel passes the automated accessibility checks", async ({ page }) => {
    const student = uniqueName("Wanda accesible");
    await createSale(page, { student });
    await invoiceOne(page, student, { type: "C", number: uniqueInvoiceNumber() });
    await page.goto(await saleHref(page, student));
    await expect(page.getByTestId("invoice-panel")).toContainText("Facturada");

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual([]);
  });
});

test.describe("confirming a big batch of not-required invoices", () => {
  const BATCH = 6;

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  /** Carga `BATCH` ventas de alumnos con nombre único, abre Facturación y las elige todas. */
  async function pickBatch(page: Page, prefix: string): Promise<string[]> {
    const students = Array.from({ length: BATCH }, () => uniqueName(prefix));
    for (const student of students) await createSale(page, { student });
    await openBilling(page);
    for (const student of students) await pickerOf(page, student).check();
    return students;
  }

  test("asks first when more than 5 are chosen: Escape cancels, and 5 or fewer go straight through", async ({
    page,
  }) => {
    const students = await pickBatch(page, "Lote cancelado");
    const notRequired = page.getByRole("button", { name: "No requiere factura", exact: true });

    await notRequired.click();

    const dialog = page.getByRole("dialog", { name: `¿Marcar ${BATCH} ventas como «No requiere factura»?` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Salen de la lista de pendientes");
    // Nada cambió ni se fue de la página, y el foco arranca en lo que no hace nada.
    await expect(page).toHaveURL(/\/admin\/facturacion$/);
    await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(notRequired).toBeFocused();
    for (const student of students) await expect(rowOf(page, student)).toHaveCount(1);

    // Con 5 elegidas ya no pregunta.
    await pickerOf(page, students[0]).uncheck();
    await notRequired.click();
    await expect(page).toHaveURL(/guardada=sin-factura&cantidad=\d+$/);
    await expect(rowOf(page, students[1])).toHaveCount(0);
    await expect(rowOf(page, students[0])).toHaveCount(1);
  });

  test("confirming from the dialog marks every chosen sale, and the dialog is keyboard and screen reader friendly", async ({
    page,
  }) => {
    const students = await pickBatch(page, "Lote confirmado");
    await page.getByRole("button", { name: "No requiere factura", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /¿Marcar \d+ ventas como «No requiere factura»\?/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-describedby", "bulk-confirm-description");

    // Con Tab el foco da vueltas por el diálogo (o sale al navegador): nunca cae en la página de atrás.
    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press("Tab");
      const inDialogOrBrowser = await dialog.evaluate(
        (element) => document.activeElement === document.body || element.contains(document.activeElement),
      );
      expect(inDialogOrBrowser).toBe(true);
    }
    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(audit.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual([]);

    await dialog.getByRole("button", { name: /^Sí, marcar \d+ ventas$/ }).click();

    await expect(page).toHaveURL(/guardada=sin-factura&cantidad=\d+$/);
    for (const student of students) await expect(rowOf(page, student)).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
