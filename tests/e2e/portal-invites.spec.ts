import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { PHONE, uniqueName } from "../helpers/admin-ui";
import { createStudent } from "../helpers/portal-admin-ui";
import {
  STUDENT_COOKIE,
  URL_SAFE_32_BYTES,
  chooseProviderStudent,
  cookieNamed,
  newStudentBrowser,
  signIn,
  startSignIn,
  uniqueProviderStudent,
} from "../helpers/portal-e2e";

// Las invitaciones al portal, de punta a punta: Tallami invita desde la ficha del alumno,
// el alumno abre el link en su navegador y entra con el proveedor de prueba (el servidor
// OAuth falso de `tests/helpers/mock-oauth-server.mjs`), y la ficha muestra "Vinculado".
// Estos tests miran a dónde vuelve el ingreso (`/es/portal?invitacion=…`) y la ficha del panel;
// lo que muestra la página del portal se prueba en `portal-page.spec.ts`.
//
// El link de la invitación sale con la dirección pública del sitio (`NEXT_PUBLIC_SITE_URL`,
// `http://localhost:3000` si falta), que en los e2e es el servidor de desarrollo de Tallami:
// nunca se abre. Los tests toman solo el token del link y arman la dirección con `baseURL`.
//
// Cada test entra con su propio alumno del proveedor de prueba (`tests/helpers/portal-e2e.ts`):
// ninguno comparte identidad con otro ni con un reintento.

/** La tarjeta "Portal del alumno" de la ficha que se ve ahora. */
function portalCard(page: Page) {
  return page.getByRole("region", { name: "Portal del alumno" });
}

/**
 * Genera la invitación desde la tarjeta, en el idioma `locale`, y devuelve su token (el link se ve
 * una sola vez). El foco va al campo del link, que es lo que lo anuncia a quien usa un lector de pantalla.
 */
async function generateInvite(page: Page, locale = "es"): Promise<string> {
  const link = portalCard(page).getByLabel("Link de invitación");
  // Si ya hay un link a la vista, el nuevo es el que lo reemplaza.
  const previous = (await link.isVisible()) ? await link.inputValue() : null;
  await portalCard(page).getByLabel("Idioma del link").selectOption(locale);
  await portalCard(page).getByRole("button", { name: /^(Invitar al portal|Generar otro link)$/ }).click();
  await expect(link).toBeVisible();
  if (previous) await expect(link).not.toHaveValue(previous);
  await expect(link).toBeFocused();
  const url = new URL(await link.inputValue());
  expect(url.pathname).toBe(`/${locale}/portal`);
  const token = url.searchParams.get("invitacion") ?? "";
  expect(token).toMatch(URL_SAFE_32_BYTES);
  return token;
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
    await expect(portalCard(page).getByLabel("Idioma del link")).toHaveValue("es");

    const token = await generateInvite(page);
    // El link se ve una sola vez, con su vencimiento; con el link a la vista, el botón ofrece generar otro.
    await expect(portalCard(page)).toContainText("Vence el");
    await expect(portalCard(page).getByRole("button", { name: "Generar otro link" })).toBeVisible();

    const student = uniqueProviderStudent();
    const { context, page: studentPage } = await newStudentBrowser(browser);
    const landed = await signIn(studentPage, { invitation: token, student });
    expect(landed.pathname + landed.search).toBe("/es/portal?invitacion=vinculada");
    expect(await cookieNamed(context, STUDENT_COOKIE)).toBeDefined();

    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Vinculado");
    await expect(portalCard(page)).toContainText(`Cuenta de prueba: Alumno ${student}`);
    await expect(portalCard(page).getByRole("button", { name: "Invitar al portal" })).toHaveCount(0);
    await expect(portalCard(page).getByRole("button", { name: "Desvincular" })).toBeVisible();
    await context.close();
  });

  test("the link opens the portal in the language chosen for the student", async ({ page, browser }) => {
    const studentPath = await createStudent(page, uniqueName("Alumno portugues"));

    const token = await generateInvite(page, "pt");

    await expect(portalCard(page).getByLabel("Idioma del link")).toHaveValue("pt");
    await expect(portalCard(page)).toContainText("Link en Português.");
    const { context, page: studentPage } = await newStudentBrowser(browser);
    const landed = await signIn(studentPage, { invitation: token, locale: "pt" });
    expect(landed.pathname + landed.search).toBe("/pt/portal?invitacion=vinculada");
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Vinculado");
    await context.close();
  });

  test("the same link in a third browser is invalid, and links nothing", async ({ page, browser }) => {
    const studentPath = await createStudent(page, uniqueName("Alumno una vez"));
    const token = await generateInvite(page);
    const first = await newStudentBrowser(browser);
    const third = await newStudentBrowser(browser);

    const firstLanding = await signIn(first.page, { invitation: token });
    const thirdLanding = await signIn(third.page, { invitation: token });

    expect(firstLanding.search).toBe("?invitacion=vinculada");
    expect(thirdLanding.pathname + thirdLanding.search).toBe("/es/portal?invitacion=invalida");
    // Igual entró (tiene su cuenta y su sesión), pero no quedó vinculada a nadie.
    expect(await cookieNamed(third.context, STUDENT_COOKIE)).toBeDefined();
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
    const student = await newStudentBrowser(browser);

    const withOld = await signIn(student.page, { invitation: oldToken });
    const withNew = await signIn(student.page, { invitation: newToken });

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
    const browserOfStudent = await newStudentBrowser(browser);
    expect((await signIn(browserOfStudent.page, { invitation: firstToken, student })).search).toBe(
      "?invitacion=vinculada",
    );

    // La misma persona usa la invitación de otro alumno: no se pisa nada.
    const landed = await signIn(browserOfStudent.page, { invitation: secondToken, student });

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
    const { context, page: studentPage } = await newStudentBrowser(browser);

    // Un link de otro sitio (o una dirección escrita a mano) no manda `Sec-Fetch-Site: same-origin`.
    const authorize = await startSignIn(studentPage.request, {
      invitation: token,
      student,
      headers: { "sec-fetch-site": "cross-site" },
    });
    await studentPage.goto(authorize.toString());
    await expect(studentPage).toHaveURL(/\/es\/portal$/);
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Sin vincular");

    // Desde la página del portal (el clic de verdad), la misma invitación sirve.
    const landed = await signIn(studentPage, { invitation: token, student });
    expect(landed.search).toBe("?invitacion=vinculada");
    await context.close();
  });

  test("in a real browser, a click inside the site redeems the invite and an address typed by hand does not", async ({
    page,
    browser,
  }) => {
    const studentPath = await createStudent(page, uniqueName("Alumno navegador"));
    const token = await generateInvite(page);
    const student = uniqueProviderStudent();
    const { context, page: studentPage } = await newStudentBrowser(browser);
    // El navegador no puede agregar `login_hint` a la redirección que le manda el sitio: el alumno del
    // proveedor de prueba se elige con una cookie de este contexto, la de este test y de nadie más.
    await chooseProviderStudent(context, student);
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
    await expect(portalCard(page)).toContainText(`Cuenta de prueba: Alumno ${student}`);
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

    const { context, page: studentPage } = await newStudentBrowser(browser);
    await signIn(studentPage, { invitation: token });
    await context.close();
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Vinculado");
    await audit("vinculado");
    await portalCard(page).getByRole("button", { name: "Desvincular" }).click();
    await expect(portalCard(page).getByRole("button", { name: "No, dejarla vinculada" })).toBeFocused();
    await audit("con la pregunta abierta");
    await portalCard(page).getByRole("button", { name: "Sí, desvincular" }).click();
    await expect(portalCard(page)).toContainText("Cuenta desvinculada.");
    await audit("con el aviso de que se desvinculó");
  });
});

test.describe("unlinking and deleting the account", () => {
  /** Un alumno ya vinculado a una cuenta del proveedor de prueba; devuelve la dirección de su ficha, ya abierta. */
  async function linkedStudent(page: Page, browser: Browser): Promise<string> {
    const studentPath = await createStudent(page, uniqueName("Alumno vinculado"));
    const token = await generateInvite(page);
    const { context, page: studentPage } = await newStudentBrowser(browser);
    await signIn(studentPage, { invitation: token });
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
    const question = /¿Desvincular la cuenta de prueba/;

    await portalCard(page).getByRole("button", { name: "Desvincular" }).click();
    await expect(portalCard(page).getByText(question)).toBeVisible();
    // La pregunta es la descripción de los dos botones: se lee junto con cada uno.
    await expect(portalCard(page).getByRole("button", { name: "Sí, desvincular" })).toHaveAccessibleDescription(question);
    await expect(portalCard(page).getByRole("button", { name: "No, dejarla vinculada" })).toHaveAccessibleDescription(
      question,
    );
    await expect(portalCard(page).getByRole("button", { name: "No, dejarla vinculada" })).toBeFocused();
    await portalCard(page).getByRole("button", { name: "No, dejarla vinculada" }).click();
    await expect(portalCard(page)).toContainText("Vinculado");
    await expect(portalCard(page).getByRole("button", { name: "Sí, desvincular" })).toHaveCount(0);
    // Al decir que no, el foco vuelve al botón que abrió la pregunta.
    await expect(portalCard(page).getByRole("button", { name: "Desvincular" })).toBeFocused();

    await portalCard(page).getByRole("button", { name: "Desvincular" }).click();
    await portalCard(page).getByRole("button", { name: "Sí, desvincular" }).click();

    await expect(portalCard(page)).toContainText("Sin vincular");
    await expect(portalCard(page).getByRole("button", { name: "Invitar al portal" })).toBeVisible();
    // El resultado se anuncia: el foco va al aviso, porque el botón que lo pidió ya no está.
    await expect(page.locator(":focus")).toContainText("Cuenta desvinculada. Se cerraron sus sesiones.");
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Sin vincular");
  });

  test("deleting the account asks first, announces the result and leaves the student without an account", async ({
    page,
    browser,
  }) => {
    const studentPath = await linkedStudent(page, browser);

    await portalCard(page).getByRole("button", { name: "Borrar cuenta del portal" }).click();
    await expect(portalCard(page).getByText(/Las ventas y las entregas siguen en el panel/)).toBeVisible();
    await portalCard(page).getByRole("button", { name: "Sí, borrar la cuenta" }).click();

    await expect(portalCard(page)).toContainText("Sin vincular");
    await expect(page.locator(":focus")).toContainText("Cuenta borrada del portal.");
    await page.goto(studentPath);
    await expect(portalCard(page)).toContainText("Sin vincular");
    await expect(page.getByRole("heading", { name: /Alumno vinculado/, level: 1 })).toBeVisible();
  });
});
