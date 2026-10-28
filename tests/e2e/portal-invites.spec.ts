import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, loginAsAdmin, test, uniqueTestIp } from "../helpers/admin";
import { PHONE, uniqueName } from "../helpers/admin-ui";

// Las invitaciones al portal, de punta a punta: Tallami invita desde la ficha del alumno,
// el alumno abre el link en su navegador y entra con el proveedor de prueba (el servidor
// OAuth falso de `tests/helpers/mock-oauth-server.mjs`), y la ficha muestra "Vinculado".
// La página del portal todavía no existe (la arma la Tarea 5): los tests miran a dónde
// vuelve el ingreso (`/es/portal?invitacion=…`) y la ficha del panel, no lo que muestra el portal.
//
// El link de la invitación sale con la dirección pública del sitio (`NEXT_PUBLIC_SITE_URL`,
// `http://localhost:3000` si falta), que en los e2e es el servidor de desarrollo de Tallami:
// nunca se abre. Los tests toman solo el token del link y arman la dirección con `baseURL`.

const URL_SAFE_32_BYTES = /^[A-Za-z0-9_-]{43}$/;
/** Lo que manda el navegador cuando el ingreso empieza con un clic dentro del propio sitio. */
const FROM_THE_SITE = { "sec-fetch-site": "same-origin" };

/** Un alumno del proveedor de prueba por test: los tests corren en paralelo sobre la misma base. */
function uniqueProviderStudent(): string {
  return `alumno-${randomUUID().slice(0, 8)}`;
}

/** Da de alta un alumno por el formulario y espera a estar en su ficha. Devuelve su dirección. */
async function createStudent(page: Page, name: string): Promise<string> {
  await page.goto("/admin/alumnos/nuevo");
  const form = page.getByRole("form", { name: "Datos del alumno" });
  await expect(form).toHaveAttribute("data-hydrated", "true");
  await form.getByLabel("Nombre", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Guardar alumno" }).click();
  await expect(page).toHaveURL(/\/admin\/alumnos\/[0-9a-f-]{36}\?guardado=creado$/);
  return new URL(page.url()).pathname;
}

/** La tarjeta "Portal del alumno" de la ficha que se ve ahora. */
function portalCard(page: Page) {
  return page.getByRole("region", { name: "Portal del alumno" });
}

/** Genera la invitación desde la tarjeta y devuelve su token (el link se ve una sola vez). */
async function generateInvite(page: Page): Promise<string> {
  const link = portalCard(page).getByLabel("Link de invitación");
  // Si ya hay un link a la vista, el nuevo es el que lo reemplaza.
  const previous = (await link.isVisible()) ? await link.inputValue() : null;
  await portalCard(page).getByRole("button", { name: /^(Invitar al portal|Generar otro link)$/ }).click();
  await expect(link).toBeVisible();
  if (previous) await expect(link).not.toHaveValue(previous);
  const url = new URL(await link.inputValue());
  expect(url.pathname).toBe("/es/portal");
  const token = url.searchParams.get("invitacion") ?? "";
  expect(token).toMatch(URL_SAFE_32_BYTES);
  return token;
}

/** Otro navegador (otro contexto, con su cookie y su IP): el del alumno. */
async function newBrowserOf(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() },
  });
  return { context, page: await context.newPage() };
}

/**
 * El alumno abre el link de la invitación y entra con el proveedor de prueba, como
 * `student`. Hace el clic de "Entrar" de la página del portal: un pedido del mismo sitio
 * (`FROM_THE_SITE`) a `/api/portal/auth/test` con la invitación, y sigue al proveedor.
 * Devuelve a dónde volvió el ingreso.
 */
async function signInWithInvite(page: Page, token: string | null, student: string): Promise<URL> {
  const query = new URLSearchParams({ locale: "es" });
  if (token) query.set("invitacion", token);
  const start = await page.request.get(`/api/portal/auth/test?${query}`, { headers: FROM_THE_SITE, maxRedirects: 0 });
  expect(start.status()).toBe(302);
  const authorize = new URL(start.headers().location);
  authorize.searchParams.set("login_hint", student);
  await page.goto(authorize.toString());
  await expect(page).toHaveURL(/\/es\/portal(\?|$)/);
  return new URL(page.url());
}

test.describe("Tallami invites a student from the student page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("invite, open the link in another browser, sign in with the provider, and the page shows the student linked", async ({
    page,
    browser,
  }) => {
    const name = uniqueName("Alumna invitada");
    const studentPath = await createStudent(page, name);
    await expect(portalCard(page)).toContainText("Sin vincular");
    await expect(portalCard(page)).toContainText("Todavía no tiene una cuenta en el portal.");

    const token = await generateInvite(page);
    // El link se ve una sola vez, con su vencimiento; con el link a la vista, el botón ofrece generar otro.
    await expect(portalCard(page)).toContainText("Vence el");
    await expect(portalCard(page).getByRole("button", { name: "Generar otro link" })).toBeVisible();

    const student = uniqueProviderStudent();
    const { context, page: studentPage } = await newBrowserOf(browser);
    const landed = await signInWithInvite(studentPage, token, student);
    expect(landed.pathname + landed.search).toBe("/es/portal?invitacion=vinculada");
    expect((await context.cookies()).some(({ name: cookie }) => cookie === "tallami_alumno")).toBe(true);

    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Vinculado");
    await expect(portalCard(page)).toContainText(`Cuenta de prueba: Alumno ${student}`);
    await expect(portalCard(page).getByRole("button", { name: "Invitar al portal" })).toHaveCount(0);
    await expect(portalCard(page).getByRole("button", { name: "Desvincular" })).toBeVisible();
    await context.close();
  });

  test("the same link in a third browser is invalid, and links nothing", async ({ page, browser }) => {
    const studentPath = await createStudent(page, uniqueName("Alumno una vez"));
    const token = await generateInvite(page);
    const first = await newBrowserOf(browser);
    const third = await newBrowserOf(browser);

    const firstLanding = await signInWithInvite(first.page, token, uniqueProviderStudent());
    const thirdLanding = await signInWithInvite(third.page, token, uniqueProviderStudent());

    expect(firstLanding.search).toBe("?invitacion=vinculada");
    expect(thirdLanding.pathname + thirdLanding.search).toBe("/es/portal?invitacion=invalida");
    // Igual entró (tiene su cuenta y su sesión), pero no quedó vinculada a nadie.
    expect((await third.context.cookies()).some(({ name }) => name === "tallami_alumno")).toBe(true);
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Vinculado");
    await first.context.close();
    await third.context.close();
  });

  test("a new link voids the one before", async ({ page, browser }) => {
    await createStudent(page, uniqueName("Alumno dos links"));
    const oldToken = await generateInvite(page);
    const newToken = await generateInvite(page);
    expect(newToken).not.toBe(oldToken);
    const student = await newBrowserOf(browser);

    const withOld = await signInWithInvite(student.page, oldToken, uniqueProviderStudent());
    const withNew = await signInWithInvite(student.page, newToken, uniqueProviderStudent());

    expect(withOld.search).toBe("?invitacion=invalida");
    expect(withNew.search).toBe("?invitacion=vinculada");
    await student.context.close();
  });

  test("an account that is already linked to another student gets `ocupada`, and the second student stays unlinked", async ({
    page,
    browser,
  }) => {
    await createStudent(page, uniqueName("Alumna primera"));
    const firstToken = await generateInvite(page);
    const secondPath = await createStudent(page, uniqueName("Alumna segunda"));
    const secondToken = await generateInvite(page);
    const student = uniqueProviderStudent();
    const browserOfStudent = await newBrowserOf(browser);
    expect((await signInWithInvite(browserOfStudent.page, firstToken, student)).search).toBe("?invitacion=vinculada");

    // La misma persona usa la invitación de otro alumno: no se pisa nada.
    const landed = await signInWithInvite(browserOfStudent.page, secondToken, student);

    expect(landed.pathname + landed.search).toBe("/es/portal?invitacion=ocupada");
    await page.goto(secondPath);
    await expect(portalCard(page)).toContainText("Sin vincular");
    await browserOfStudent.context.close();
  });

  test("an invite opened from a link of another site is not redeemed: the student signs in, and the invite still works from the portal", async ({
    page,
    browser,
  }) => {
    const studentPath = await createStudent(page, uniqueName("Alumno link ajeno"));
    const token = await generateInvite(page);
    const student = uniqueProviderStudent();
    const { context, page: studentPage } = await newBrowserOf(browser);

    // Un link de otro sitio (o una dirección escrita a mano) no manda `Sec-Fetch-Site: same-origin`.
    const start = await studentPage.request.get(`/api/portal/auth/test?locale=es&invitacion=${token}`, {
      headers: { "sec-fetch-site": "cross-site" },
      maxRedirects: 0,
    });
    const authorize = new URL(start.headers().location);
    authorize.searchParams.set("login_hint", student);
    await studentPage.goto(authorize.toString());
    await expect(studentPage).toHaveURL(/\/es\/portal$/);
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Sin vincular");

    // Desde la página del portal (el clic de verdad), la misma invitación sirve.
    const landed = await signInWithInvite(studentPage, token, student);
    expect(landed.search).toBe("?invitacion=vinculada");
    await context.close();
  });

  test("in a real browser, a click inside the site redeems the invite and an address typed by hand does not", async ({
    page,
    browser,
  }) => {
    const studentPath = await createStudent(page, uniqueName("Alumno navegador"));
    const token = await generateInvite(page);
    const { context, page: studentPage } = await newBrowserOf(browser);
    // Sin `login_hint` (el navegador no puede agregarlo a la redirección) el proveedor de prueba entra como `alumno-1`.
    const start = `/api/portal/auth/test?locale=es&invitacion=${token}`;

    // Escrita a mano en la barra de direcciones (el navegador manda `Sec-Fetch-Site: none`): entra, sin la invitación.
    await studentPage.goto(start);
    await expect(studentPage).toHaveURL(/\/es\/portal$/);
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Sin vincular");

    // Un clic dentro del sitio (una navegación del mismo origen, como el botón "Entrar" del portal): vincula.
    await studentPage.goto("/es/portal");
    await studentPage.evaluate((target) => window.location.assign(target), start);
    await expect(studentPage).toHaveURL(/\/es\/portal\?invitacion=vinculada$/);
    await context.close();
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Cuenta de prueba: Alumno alumno-1");

    // Deja la base como estaba: ese alumno del proveedor de prueba es el de todos los ingresos sin `login_hint`.
    await portalCard(page).getByRole("button", { name: "Borrar cuenta del portal" }).click();
    await portalCard(page).getByRole("button", { name: "Sí, borrar la cuenta" }).click();
    await expect(portalCard(page)).toContainText("Sin vincular");
  });

  test("the link can be copied with its button", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await createStudent(page, uniqueName("Alumno copia"));
    await generateInvite(page);
    const link = await portalCard(page).getByLabel("Link de invitación").inputValue();

    await portalCard(page).getByRole("button", { name: "Copiar link" }).click();

    await expect(portalCard(page).getByRole("status")).toHaveText("Link copiado.");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  });
});

test.describe("the Portal del alumno card", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("has no accessibility problems and no sideways scroll on a phone, with the link on screen and with the question open", async ({
    page,
    browser,
  }) => {
    await page.setViewportSize(PHONE);
    const studentPath = await createStudent(page, uniqueName("Alumno accesible"));

    const audit = async (label: string) => {
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map(({ id, nodes }) => ({ label, id, targets: nodes.map((n) => n.target) }))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), label).toBeLessThanOrEqual(0);
    };

    await audit("sin vincular");
    const token = await generateInvite(page);
    await audit("con el link a la vista");

    const { context, page: studentPage } = await newBrowserOf(browser);
    await signInWithInvite(studentPage, token, uniqueProviderStudent());
    await context.close();
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Vinculado");
    await audit("vinculado");
    await portalCard(page).getByRole("button", { name: "Desvincular" }).click();
    await expect(portalCard(page).getByRole("button", { name: "No, dejarla vinculada" })).toBeFocused();
    await audit("con la pregunta abierta");
  });
});

test.describe("unlinking and deleting the account", () => {
  /** Un alumno ya vinculado a una cuenta del proveedor de prueba; devuelve la dirección de su ficha, ya abierta. */
  async function linkedStudent(page: Page, browser: Browser): Promise<string> {
    const studentPath = await createStudent(page, uniqueName("Alumno vinculado"));
    const token = await generateInvite(page);
    const { context, page: studentPage } = await newBrowserOf(browser);
    await signInWithInvite(studentPage, token, uniqueProviderStudent());
    await context.close();
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Vinculado");
    return studentPath;
  }

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("unlinking asks first, keeps the account if the answer is no, and then allows inviting again", async ({
    page,
    browser,
  }) => {
    const studentPath = await linkedStudent(page, browser);

    await portalCard(page).getByRole("button", { name: "Desvincular" }).click();
    await expect(portalCard(page).getByText(/¿Desvincular la cuenta de prueba/)).toBeVisible();
    await expect(portalCard(page).getByRole("button", { name: "No, dejarla vinculada" })).toBeFocused();
    await portalCard(page).getByRole("button", { name: "No, dejarla vinculada" }).click();
    await expect(portalCard(page)).toContainText("Vinculado");
    await expect(portalCard(page).getByRole("button", { name: "Sí, desvincular" })).toHaveCount(0);

    await portalCard(page).getByRole("button", { name: "Desvincular" }).click();
    await portalCard(page).getByRole("button", { name: "Sí, desvincular" }).click();

    await expect(portalCard(page)).toContainText("Sin vincular");
    await expect(portalCard(page).getByRole("button", { name: "Invitar al portal" })).toBeVisible();
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Sin vincular");
  });

  test("deleting the account asks first and leaves the student without an account", async ({ page, browser }) => {
    const studentPath = await linkedStudent(page, browser);

    await portalCard(page).getByRole("button", { name: "Borrar cuenta del portal" }).click();
    await expect(portalCard(page).getByText(/Las ventas y las entregas siguen en el panel/)).toBeVisible();
    await portalCard(page).getByRole("button", { name: "Sí, borrar la cuenta" }).click();

    await expect(portalCard(page)).toContainText("Sin vincular");
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Sin vincular");
    await expect(page.getByRole("heading", { name: /Alumno vinculado/, level: 1 })).toBeVisible();
  });
});
