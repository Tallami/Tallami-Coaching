import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { PHONE, createSale, createSaleForExisting, uniqueName } from "../helpers/admin-ui";

const STUDENT_URL = /\/admin\/alumnos\/[0-9a-f-]{36}\?guardado=creado$/;

/** La lista de alumnos filtrada por el texto: así cada test mira solo sus filas. */
async function openListFor(page: Page, text: string): Promise<void> {
  await page.goto(`/admin/alumnos?q=${encodeURIComponent(text)}`);
}

function rowOf(page: Page, student: string) {
  return page.getByRole("row").filter({ hasText: student });
}

/** El formulario de datos del alumno que se ve ahora (al navegar, Next deja la página anterior oculta). */
function studentForm(page: Page) {
  return page.getByRole("form", { name: "Datos del alumno" });
}

/** Da de alta un alumno por el formulario y espera a estar en su ficha. */
async function createStudent(
  page: Page,
  fields: { name: string; discord?: string; country?: string; notes?: string },
): Promise<string> {
  await page.goto("/admin/alumnos/nuevo");
  const form = studentForm(page);
  await expect(form).toHaveAttribute("data-hydrated", "true");
  await form.getByLabel("Nombre", { exact: true }).fill(fields.name);
  if (fields.discord) await form.getByLabel("Discord").fill(fields.discord);
  if (fields.country) await form.getByLabel("País").fill(fields.country);
  if (fields.notes) await form.getByLabel("Notas").fill(fields.notes);
  await page.getByRole("button", { name: "Guardar alumno" }).click();
  await expect(page).toHaveURL(STUDENT_URL);
  return new URL(page.url()).pathname;
}

test.describe("students", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("lists students with totals and opens a student's history", async ({ page }) => {
    const student = uniqueName("Ale alumna");
    // Dos ventas de ingreso (USD 40 y USD 30) y una cancelada (USD 120) que no suma.
    await createSale(page, { student, item: "lesson", status: "paid", paidOn: "2026-08-10" });
    await createSaleForExisting(page, {
      student,
      item: "vodRecorded",
      status: "delivered",
      paidOn: "2026-09-05",
    });
    await createSaleForExisting(page, {
      student,
      item: "gamePlan",
      status: "cancelled",
      paidOn: "2026-09-20",
    });

    await openListFor(page, student);
    const row = rowOf(page, student);
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("cell").nth(2)).toHaveText("2");
    await expect(row).toContainText("USD 70,00");
    await expect(row).not.toContainText("USD 190,00");
    await expect(row).toContainText("10/08/2026");
    await expect(row).toContainText("05/09/2026");
    await expect(row).toContainText("VOD review grabado");
    await expect(row).toContainText("Clase 1 a 1");
    await expect(row).not.toContainText("Plan de juego personalizado");
    await expect(
      page.getByRole("navigation", { name: "Secciones del panel" }).getByRole("link", { name: "Alumnos" }),
    ).toHaveAttribute("aria-current", "page");

    await row.getByRole("link", { name: student }).click();
    await expect(page).toHaveURL(/\/admin\/alumnos\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: student, level: 1 })).toBeVisible();
    const summary = page.getByRole("region", { name: "Lo que compró" });
    await expect(summary).toContainText("USD 70,00");
    await expect(summary).toContainText("10/08/2026");
    await expect(summary).toContainText("05/09/2026");

    // El historial muestra todas las ventas con su estado, también la que no suma.
    const history = page.getByRole("region", { name: "Ventas del alumno" });
    await expect(history.getByRole("row")).toHaveCount(4);
    const cancelled = history.getByRole("row").filter({ hasText: "Plan de juego personalizado" });
    await expect(cancelled).toContainText("Cancelada");
    await expect(cancelled).toContainText("USD 120,00");
    await expect(history.getByRole("row").filter({ hasText: "VOD review grabado" })).toContainText(
      "Entregada",
    );
    await expect(history.getByRole("row").filter({ hasText: "Clase 1 a 1" })).toContainText("Cobrada");

    // Cada venta del historial abre su edición.
    await cancelled.getByRole("link", { name: "Plan de juego personalizado" }).click();
    await expect(page).toHaveURL(/\/admin\/ventas\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Editar venta" })).toBeVisible();
  });

  test("edits a student's discord and country", async ({ page }) => {
    const student = uniqueName("Beto editable");
    await createStudent(page, { name: student, discord: "viejo.e2e", country: "br" });

    await expect(page.getByRole("status").filter({ hasText: "Alumno guardado." })).toBeVisible();
    await expect(page.getByRole("heading", { name: student, level: 1 })).toBeVisible();
    // Sin compras todavía: lo dicen el resumen y el historial.
    await expect(page.getByRole("region", { name: "Lo que compró" })).toContainText("Todavía no compró");
    await expect(page.getByRole("heading", { name: "Todavía no tiene ventas" })).toBeVisible();
    const form = studentForm(page);
    await expect(form).toHaveAttribute("data-hydrated", "true");
    await expect(form.getByLabel("Discord")).toHaveValue("viejo.e2e");
    // El país se guardó en mayúsculas.
    await expect(form.getByLabel("País")).toHaveValue("BR");

    await form.getByLabel("Discord").fill("nuevo.e2e");
    await form.getByLabel("País").fill("ar");
    await form.getByLabel("Notas").fill("Paga su papá");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await expect(page).toHaveURL(/\/admin\/alumnos\/[0-9a-f-]{36}\?guardado=editado$/);
    await expect(page.getByRole("status").filter({ hasText: "Cambios guardados." })).toBeVisible();
    await expect(form.getByLabel("Discord")).toHaveValue("nuevo.e2e");
    await expect(form.getByLabel("País")).toHaveValue("AR");
    await expect(form.getByLabel("Notas")).toHaveValue("Paga su papá");

    await openListFor(page, student);
    const row = rowOf(page, student);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("nuevo.e2e");
    await expect(row).toContainText("AR");
    await expect(row).not.toContainText("viejo.e2e");
    await expect(row).toContainText("Sin compras");
  });

  test("the saved notice goes away when a later save fails", async ({ page }) => {
    await createStudent(page, { name: uniqueName("Dani aviso") });
    const notice = page.getByRole("status").filter({ hasText: "Alumno guardado." });
    await expect(notice).toBeVisible();
    const form = studentForm(page);
    await expect(form).toHaveAttribute("data-hydrated", "true");

    // Un país que no es de dos letras: el guardado falla y el aviso de antes ya no es cierto.
    await form.getByLabel("País").fill("12");
    await page.getByRole("button", { name: "Guardar cambios" }).click();

    await expect(page.getByText("El país va con 2 letras, como AR, BR o MX.")).toBeVisible();
    await expect(notice).toHaveCount(0);
  });

  test("a new student needs a name, and the messages are in spanish", async ({ page }) => {
    await page.goto("/admin/alumnos/nuevo");
    const form = studentForm(page);
    await expect(form).toHaveAttribute("data-hydrated", "true");

    await page.getByRole("button", { name: "Guardar alumno" }).click();

    await expect(page).toHaveURL(/\/admin\/alumnos\/nuevo$/);
    await expect(page.getByRole("alert").filter({ hasText: "Revisá los campos marcados." })).toBeVisible();
    const name = form.getByLabel("Nombre", { exact: true });
    await expect(page.getByText("Escribí el nombre del alumno.")).toBeVisible();
    await expect(name).toHaveAttribute("aria-invalid", "true");
    // El foco va al primer campo con problema.
    await expect(name).toBeFocused();

    // Un nombre de solo espacios tampoco vale, y lo ya escrito queda en el formulario.
    await name.fill("    ");
    await form.getByLabel("Discord").fill("sin.nombre");
    await page.getByRole("button", { name: "Guardar alumno" }).click();
    await expect(page.getByText("Escribí el nombre del alumno.")).toBeVisible();
    await expect(form.getByLabel("Discord")).toHaveValue("sin.nombre");
  });

  test("an invalid country is rejected without losing what was typed", async ({ page }) => {
    const student = uniqueName("Cami país");
    await page.goto("/admin/alumnos/nuevo");
    const form = studentForm(page);
    await expect(form).toHaveAttribute("data-hydrated", "true");

    await form.getByLabel("Nombre", { exact: true }).fill(student);
    // Dos símbolos no son dos letras (el campo deja escribir solo 2 caracteres).
    await form.getByLabel("País").fill("1!");
    await page.getByRole("button", { name: "Guardar alumno" }).click();

    await expect(page.getByText("El país va con 2 letras, como AR, BR o MX.")).toBeVisible();
    await expect(form.getByLabel("País")).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByLabel("Nombre", { exact: true })).toHaveValue(student);
    await openListFor(page, student);
    await expect(rowOf(page, student)).toHaveCount(0);
  });

  test("the search narrows the list and says when nobody matches", async ({ page }) => {
    const student = uniqueName("Dani buscable");
    await createStudent(page, { name: student, discord: "dani.busca" });

    await page.goto("/admin/alumnos");
    await page.getByLabel("Buscar alumno", { exact: true }).fill(student.toUpperCase());
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page).toHaveURL(/\/admin\/alumnos\?q=/);
    await expect(rowOf(page, student)).toHaveCount(1);

    // También se busca por Discord.
    await openListFor(page, "dani.busca");
    await expect(rowOf(page, student)).toHaveCount(1);

    await openListFor(page, uniqueName("nadie se llama así"));
    await expect(page.getByRole("heading", { name: "Ningún alumno coincide con la búsqueda" })).toBeVisible();
    await page.getByRole("link", { name: "Limpiar búsqueda" }).click();
    await expect(page).toHaveURL(/\/admin\/alumnos$/);
    await expect(page.getByLabel("Buscar alumno", { exact: true })).toHaveValue("");
  });

  test("a hand-typed address with odd values still shows the page", async ({ page }) => {
    const student = uniqueName("Eli rara");
    const studentPath = await createStudent(page, { name: student });

    for (const query of ["q=%00", "q=a%00b", "pagina=0", "pagina=999999999", "pagina=-3", "q=__proto__", "q=%25"]) {
      const response = await page.goto(`/admin/alumnos?${query}`);

      expect(response?.status(), query).toBe(200);
      await expect(page.getByRole("heading", { name: "Alumnos", level: 1 }), query).toBeVisible();
    }

    // El aviso de guardado sale de una lista cerrada: un nombre de propiedad de objeto no rompe nada ni muestra un aviso.
    for (const saved of ["__proto__", "constructor", "toString", "desconocido"]) {
      const response = await page.goto(`${studentPath}?guardado=${saved}`);

      expect(response?.status(), saved).toBe(200);
      await expect(page.getByRole("heading", { name: student, level: 1 }), saved).toBeVisible();
      await expect(page.getByRole("status")).toHaveCount(0);
    }
  });

  test("a student that does not exist says so inside the panel", async ({ page }) => {
    for (const id of ["00000000-0000-4000-8000-000000000000", "no-es-un-id"]) {
      await page.goto(`/admin/alumnos/${id}`);
      await expect(page.getByRole("heading", { name: "No encontramos a ese alumno" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Volver a alumnos" })).toBeVisible();
    }
  });

  test("the list and a student's page scroll inside their tables on a 375px phone", async ({ page }) => {
    const student = uniqueName("Fran celular");
    await createSale(page, { student });
    await page.setViewportSize(PHONE);
    await openListFor(page, student);

    const scrollsInside = async (name: string) => {
      const region = page.getByRole("region", { name });
      await expect(region).toBeVisible();
      const sizes = await region.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        overflowX: getComputedStyle(element).overflowX,
      }));
      expect(sizes.overflowX, name).toBe("auto");
      expect(sizes.scrollWidth, name).toBeGreaterThan(sizes.clientWidth);
    };
    const pageDoesNotScroll = async (label: string) => {
      const viewport = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(viewport.scrollWidth, label).toBeLessThanOrEqual(viewport.innerWidth);
    };

    await scrollsInside("Alumnos");
    await pageDoesNotScroll("list");

    await rowOf(page, student).getByRole("link", { name: student }).click();
    await expect(page.getByRole("heading", { name: student, level: 1 })).toBeVisible();
    await scrollsInside("Ventas del alumno");
    await pageDoesNotScroll("student");
    await expect(studentForm(page)).toBeVisible();
  });

  test("the student pages pass the automated accessibility checks", async ({ page }) => {
    const student = uniqueName("Gigi accesible");
    await createSale(page, { student });
    await createSaleForExisting(page, { student, status: "cancelled", paidOn: "2026-09-20" });

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
    await expect(page.getByRole("heading", { name: student, level: 1 })).toBeVisible();
    await expect(studentForm(page)).toHaveAttribute("data-hydrated", "true");
    await audit("student");

    await page.goto("/admin/alumnos/nuevo");
    await expect(studentForm(page)).toHaveAttribute("data-hydrated", "true");
    await page.getByRole("button", { name: "Guardar alumno" }).click();
    await expect(page.getByText("Escribí el nombre del alumno.")).toBeVisible();
    await audit("new with errors");
  });
});

test.describe("students without a session", () => {
  test("every student page and the list send you to the login", async ({ page }) => {
    for (const path of [
      "/admin/alumnos",
      "/admin/alumnos/nuevo",
      "/admin/alumnos/00000000-0000-4000-8000-000000000000",
    ]) {
      await page.goto(path);

      await expect(page, path).toHaveURL(`/admin/login?next=${encodeURIComponent(path)}`);
      await expect(page.getByRole("heading", { name: "Alumnos", level: 1 }), path).toHaveCount(0);
    }
  });
});
