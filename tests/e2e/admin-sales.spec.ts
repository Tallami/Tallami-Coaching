import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, loginAsAdmin, test } from "../helpers/admin";

const PHONE = { width: 375, height: 812 } as const;

/** Nombre único por test: los tests corren en paralelo contra una sola base, cada uno mira solo sus filas. */
function uniqueName(prefix: string): string {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`;
}

interface SaleDraft {
  student: string;
  item?: string;
  currency?: string;
  amount?: string;
  paymentMethod?: string;
  status?: string;
  paidOn?: string;
}

/**
 * Espera a que React haya tomado el elemento (la página ya reacciona a los clics).
 * Un botón que se toca antes de la hidratación no hace nada y el test se quedaría esperando.
 */
async function whenInteractive(locator: Locator): Promise<void> {
  await expect
    .poll(() => locator.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactProps"))))
    .toBe(true);
}

/** Abre el formulario de alta y espera a que esté listo para usarse. */
async function openNewSale(page: Page): Promise<void> {
  await page.goto("/admin/ventas/nueva");
  await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
}

/** Completa el formulario con un alumno nuevo; deja sin tocar lo que el borrador no define. */
async function fillSale(page: Page, draft: SaleDraft): Promise<void> {
  await page.getByRole("radio", { name: "Alumno nuevo" }).check();
  await page.getByLabel("Nombre", { exact: true }).fill(draft.student);
  if (draft.item) await page.getByLabel("Servicio", { exact: true }).selectOption(draft.item);
  if (draft.currency) await page.getByLabel("Moneda", { exact: true }).selectOption(draft.currency);
  if (draft.amount !== undefined) await page.getByLabel("Monto", { exact: true }).fill(draft.amount);
  if (draft.paymentMethod) {
    await page.getByLabel("Medio de pago", { exact: true }).selectOption(draft.paymentMethod);
  }
  if (draft.status) await page.getByLabel("Estado", { exact: true }).selectOption(draft.status);
  if (draft.paidOn !== undefined) {
    await page.getByLabel("Fecha de cobro", { exact: true }).fill(draft.paidOn);
  }
}

/** Carga una venta completa por el formulario y espera a volver a la lista. */
async function createSale(page: Page, draft: SaleDraft): Promise<void> {
  await openNewSale(page);
  await fillSale(page, { item: "lesson", paymentMethod: "transfer", status: "paid", ...draft });
  await page.getByRole("button", { name: "Guardar venta" }).click();
  await expect(page).toHaveURL(/\/admin\/ventas\?guardada=creada$/);
}

/** La lista filtrada por el nombre del alumno. */
async function openListFor(page: Page, student: string): Promise<void> {
  await page.goto(`/admin/ventas?q=${encodeURIComponent(student)}`);
}

function rowOf(page: Page, student: string) {
  return page.getByRole("row").filter({ hasText: student });
}

test.describe("sales", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("adds a sale with a new student and sees it in the list", async ({ page }) => {
    const student = uniqueName("Ana nueva");
    await openNewSale(page);

    await page.getByRole("radio", { name: "Alumno nuevo" }).check();
    await page.getByLabel("Nombre", { exact: true }).fill(student);
    await page.getByLabel("Discord", { exact: false }).fill("ana.e2e");
    await page.getByLabel("País", { exact: false }).fill(" ar ");
    await page.getByLabel("Servicio", { exact: true }).selectOption("vodLive");
    await page.getByLabel("Medio de pago", { exact: true }).selectOption("paypal");
    await page.getByLabel("Estado", { exact: true }).selectOption("paid");
    await page.getByRole("button", { name: "Guardar venta" }).click();

    await expect(page).toHaveURL(/\/admin\/ventas\?guardada=creada$/);
    await expect(page.getByRole("status").filter({ hasText: "Venta guardada" })).toBeVisible();

    await openListFor(page, student);
    const row = rowOf(page, student);
    await expect(row).toHaveCount(1);
    // El precio sugerido del VOD en vivo (45) y su valor en pesos con el dólar fijo (1500).
    await expect(row).toContainText("ana.e2e");
    await expect(row).toContainText("VOD review en vivo");
    await expect(row).toContainText("PayPal");
    await expect(row).toContainText("Cobrada");
    await expect(row).toContainText("USD 45,00");
    await expect(row).toContainText("$ 67.500,00");
  });

  test("suggested price fills when picking a service", async ({ page }) => {
    await openNewSale(page);
    const amount = page.getByLabel("Monto", { exact: true });
    const item = page.getByLabel("Servicio", { exact: true });

    await expect(amount).toHaveValue("");
    await item.selectOption("gamePlan");
    await expect(amount).toHaveValue("120");

    // Mientras el monto sea el sugerido, cambiar de servicio lo cambia.
    await item.selectOption("tournament");
    await expect(amount).toHaveValue("150");

    // Lo que se escribe a mano no se pisa.
    await amount.fill("99");
    await item.selectOption("lesson");
    await expect(amount).toHaveValue("99");
  });

  test("shows the list price instead of filling it when the sale is not in dollars", async ({ page }) => {
    await openNewSale(page);

    await page.getByLabel("Moneda", { exact: true }).selectOption("ARS");
    await page.getByLabel("Servicio", { exact: true }).selectOption("gamePlan");

    await expect(page.getByLabel("Monto", { exact: true })).toHaveValue("");
    await expect(page.getByText("Precio de lista: USD 120")).toBeVisible();
  });

  test("manual rate is required when the automatic one is unavailable", async ({ page }) => {
    const student = uniqueName("Beto manual");
    await openNewSale(page);
    // La fuente fija no tiene cotización antes de 2020: con esa fecha de cobro no hay dólar automático.
    await fillSale(page, {
      student,
      item: "lesson",
      paymentMethod: "transfer",
      status: "paid",
      paidOn: "2019-12-31",
    });
    await page.getByRole("button", { name: "Guardar venta" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "No pudimos traer el dólar oficial; cargalo a mano" })).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/ventas\/nueva$/);
    await expect(page.getByRole("radio", { name: /Manual/ })).toBeChecked();
    const rate = page.getByLabel("Pesos por dólar", { exact: true });
    await expect(rate).toBeVisible();
    // Lo cargado no se pierde.
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(student);
    await expect(page.getByLabel("Fecha de cobro", { exact: true })).toHaveValue("2019-12-31");

    // Sin el valor a mano, la venta no se guarda.
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await expect(page.getByText("Cargá los pesos por dólar.")).toBeVisible();

    // "1.400" puede ser 1400 o 1,4: no se adivina.
    await rate.fill("1.400");
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await expect(page.getByText(/ambiguo/)).toBeVisible();

    await rate.fill("1400,50");
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await expect(page).toHaveURL(/\/admin\/ventas\?guardada=creada$/);

    await openListFor(page, student);
    const row = rowOf(page, student);
    await expect(row).toHaveCount(1);
    // USD 40 a 1400,50 = $ 56.020,00
    await expect(row).toContainText("$ 56.020,00");
    await expect(row).toContainText("31/12/2019");
  });

  test("edits a sale status to delivered", async ({ page }) => {
    const student = uniqueName("Caro editada");
    await createSale(page, { student, item: "vodRecorded", status: "paid" });
    await openListFor(page, student);
    await expect(rowOf(page, student)).toContainText("Cobrada");

    await rowOf(page, student).getByRole("link", { name: student }).click();
    await expect(page.getByRole("heading", { name: "Editar venta" })).toBeVisible();
    // Al navegar sin recargar, Next conserva la lista oculta: los campos se buscan dentro del formulario de la venta.
    const form = page.locator("form[data-hydrated='true']");
    await expect(form).toBeVisible();
    // El alumno y los valores guardados llegan cargados.
    await expect(form.getByRole("radio", { name: "Alumno existente" })).toBeChecked();
    await expect(form.getByText(student, { exact: false })).toBeVisible();
    await expect(form.getByLabel("Monto", { exact: true })).toHaveValue("30");
    const saved = page.getByRole("region", { name: "Valores guardados" });
    await expect(saved).toContainText("$ 45.000,00");
    await expect(saved).toContainText("USD 30,00");

    await form.getByLabel("Estado", { exact: true }).selectOption("delivered");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await expect(page).toHaveURL(/\/admin\/ventas\?guardada=editada$/);
    await openListFor(page, student);
    await expect(rowOf(page, student)).toContainText("Entregada");
    await expect(rowOf(page, student)).not.toContainText("Cobrada");

    // La entrega queda con fecha y hora aunque no se haya escrito.
    await rowOf(page, student).getByRole("link", { name: student }).click();
    await expect(
      page.locator("form[data-hydrated='true']").getByLabel("Entregada el"),
    ).not.toHaveValue("");
  });

  test("picks an existing student from the search", async ({ page }) => {
    const student = uniqueName("Dani recurrente");
    await createSale(page, { student });
    await openNewSale(page);

    await page.getByRole("radio", { name: "Alumno existente" }).check();
    const search = page.getByRole("combobox", { name: "Buscar alumno" });
    await search.fill(student.slice(0, -2).toUpperCase());
    const option = page.getByRole("option", { name: new RegExp(student.slice(0, -2), "i") });
    await expect(option).toBeVisible();
    await option.click();
    await expect(page.getByRole("button", { name: "Cambiar alumno" })).toBeVisible();

    await page.getByLabel("Servicio", { exact: true }).selectOption("lesson");
    await page.getByLabel("Medio de pago", { exact: true }).selectOption("cash");
    await page.getByLabel("Estado", { exact: true }).selectOption("paid");
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await expect(page).toHaveURL(/\/admin\/ventas\?guardada=creada$/);

    // Dos ventas del mismo alumno, un solo alumno.
    await openListFor(page, student);
    await expect(rowOf(page, student)).toHaveCount(2);
    await openNewSale(page);
    await page.getByRole("radio", { name: "Alumno existente" }).check();
    await page.getByRole("combobox", { name: "Buscar alumno" }).fill(student);
    await expect(page.getByRole("option", { name: new RegExp(student) })).toHaveCount(1);
  });

  test("rejects invalid input with spanish messages", async ({ page }) => {
    const student = uniqueName("Eli inválida");
    await openNewSale(page);
    await fillSale(page, { student, item: "other", amount: "abc", paymentMethod: "cash", status: "paid" });

    await page.getByRole("button", { name: "Guardar venta" }).click();

    await expect(page).toHaveURL(/\/admin\/ventas\/nueva$/);
    await expect(page.getByText(/El monto no es válido/)).toBeVisible();
    await expect(
      page.getByText("Contanos qué se vendió: la descripción es obligatoria para «Otro»."),
    ).toBeVisible();
    await expect(page.getByLabel("Monto", { exact: true })).toHaveAttribute("aria-invalid", "true");
    // Lo cargado queda en el formulario.
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(student);
    await expect(page.getByLabel("Servicio", { exact: true })).toHaveValue("other");

    // Sin nombre de alumno tampoco se guarda.
    await page.getByLabel("Nombre", { exact: true }).fill("");
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await expect(page.getByText("Escribí el nombre del alumno.")).toBeVisible();

    await openListFor(page, student);
    await expect(rowOf(page, student)).toHaveCount(0);
  });

  test("filters the list by status and clears the filters", async ({ page }) => {
    const student = uniqueName("Fede filtrado");
    await createSale(page, { student, status: "paid" });
    await createSale(page, { student, status: "pending", paidOn: "" });

    await page.goto("/admin/ventas");
    await page.getByLabel("Buscar alumno", { exact: true }).fill(student);
    await page.getByLabel("Estado", { exact: true }).selectOption("pending");
    await page.getByRole("button", { name: "Filtrar" }).click();

    await expect(page).toHaveURL(/estado=pending/);
    await expect(rowOf(page, student)).toHaveCount(1);
    await expect(rowOf(page, student)).toContainText("Pendiente");

    await page.getByRole("link", { name: "Limpiar filtros" }).click();
    await expect(page).toHaveURL(/\/admin\/ventas$/);
    await expect(page.getByLabel("Estado", { exact: true })).toHaveValue("");
  });

  test("a hand-typed address with absurd dates or a NUL character still shows the list", async ({ page }) => {
    for (const query of ["desde=0000-01-01", "hasta=9999-12-31", "q=%00", "desde=0000-01-01&hasta=9999-12-31&q=a%00b"]) {
      const response = await page.goto(`/admin/ventas?${query}`);

      expect(response?.status(), query).toBe(200);
      await expect(page.getByRole("heading", { name: "Ventas", level: 1 }), query).toBeVisible();
      await expect(page.getByLabel("Buscar alumno", { exact: true }), query).toBeVisible();
    }
  });

  test("a sale that does not exist says so inside the panel", async ({ page }) => {
    for (const id of ["00000000-0000-4000-8000-000000000000", "no-es-un-id"]) {
      await page.goto(`/admin/ventas/${id}`);
      await expect(page.getByRole("heading", { name: "No encontramos esa venta" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Volver a ventas" })).toBeVisible();
    }
  });

  test("sales list scrolls inside its container on a 375px phone", async ({ page }) => {
    const student = uniqueName("Gabi celular");
    await createSale(page, { student });
    await page.setViewportSize(PHONE);

    await openListFor(page, student);

    const region = page.getByRole("region", { name: "Ventas" });
    await expect(region).toBeVisible();
    const sizes = await region.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      overflowX: getComputedStyle(element).overflowX,
    }));
    expect(sizes.overflowX).toBe("auto");
    expect(sizes.scrollWidth).toBeGreaterThan(sizes.clientWidth);
    // La página en sí no se desplaza hacia los costados.
    const viewport = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.innerWidth);
  });

  test("the sidebar becomes a menu on a phone", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto("/admin/ventas");

    const menu = page.getByRole("button", { name: "Menú" });
    const nav = page.getByRole("navigation", { name: "Secciones del panel" });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(nav).toBeHidden();
    await whenInteractive(menu);

    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    for (const section of ["Resumen", "Ventas", "Servicios", "Alumnos", "Facturación", "Configuración"]) {
      await expect(nav.getByRole("link", { name: section })).toBeVisible();
    }
    await expect(nav.getByRole("link", { name: "Ventas" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: "Salir" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test("the filters fold behind a button on a phone, and are always open on a computer", async ({ page }) => {
    await page.goto("/admin/ventas?estado=paid");
    // En la compu no hay botón y los campos están a la vista.
    await expect(page.getByRole("button", { name: /Filtros/ })).toBeHidden();
    await expect(page.getByLabel("Buscar alumno", { exact: true })).toBeVisible();

    await page.setViewportSize(PHONE);
    const toggle = page.getByRole("button", { name: /Filtros/ });
    // Con un filtro puesto arranca desplegado y el botón lo cuenta.
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toContainText("1 activo");
    await whenInteractive(toggle);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Buscar alumno", { exact: true })).toBeHidden();
    await toggle.click();
    await expect(page.getByLabel("Buscar alumno", { exact: true })).toBeVisible();
  });

  test("keyboard focus is visible: a blue ring on the fields and a gold one in the sidebar", async ({ page }) => {
    await openNewSale(page);
    const ringOf = (locator: ReturnType<Page["locator"]>) =>
      locator.evaluate((element) => {
        const style = getComputedStyle(element);
        return `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`;
      });
    const amount = page.getByLabel("Monto", { exact: true });
    const services = page
      .getByRole("navigation", { name: "Secciones del panel" })
      .getByRole("link", { name: "Servicios" });

    await amount.focus();
    // El foco por teclado se dibuja con el azul de zona, sin pasar por otro color al aparecer.
    await expect(amount).toBeFocused();
    await expect.poll(() => ringOf(amount)).toBe("3px solid rgb(36, 87, 197)");

    await services.focus();
    await expect(services).toBeFocused();
    // Sobre el azul escenario el foco es dorado.
    await expect.poll(() => ringOf(services)).toBe("3px solid rgb(255, 201, 60)");
  });

  test("the sidebar is always there on a computer, with the current section marked", async ({ page }) => {
    await page.goto("/admin/ventas/nueva");

    const nav = page.getByRole("navigation", { name: "Secciones del panel" });
    await expect(nav).toBeVisible();
    await expect(page.getByRole("button", { name: "Menú" })).toBeHidden();
    await expect(nav.getByRole("link", { name: "Ventas" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Resumen" })).not.toHaveAttribute("aria-current", "page");
  });

  test("the sales pages pass the automated accessibility checks", async ({ page }) => {
    const student = uniqueName("Hugo accesible");
    await createSale(page, { student });

    const audit = async (label: string) => {
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations.map(({ id, nodes }) => ({ label, id, targets: nodes.map((n) => n.target) })),
      ).toEqual([]);
    };

    await openListFor(page, student);
    await expect(rowOf(page, student)).toBeVisible();
    await audit("list");

    await rowOf(page, student).getByRole("link", { name: student }).click();
    await expect(page.getByRole("heading", { name: "Editar venta" })).toBeVisible();
    await audit("edit");

    await openNewSale(page);
    await page.getByLabel("Servicio", { exact: true }).selectOption("other");
    await page.getByLabel("Monto", { exact: true }).fill("abc");
    await page.getByRole("button", { name: "Guardar venta" }).click();
    await expect(page.getByText(/El monto no es válido/)).toBeVisible();
    await audit("new with errors");
  });
});
