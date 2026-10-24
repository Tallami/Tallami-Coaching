import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import {
  ADMIN_COOKIE,
  confirmWithTestPasskey,
  expect,
  loginAsAdmin,
  signTestToken,
  submitTestPassword,
  test,
  uniqueTestIp,
} from "../helpers/admin";
import { fillSale, openNewSale, uniqueName, whenInteractive } from "../helpers/admin-ui";

// Las sesiones del panel se cierran solas a los 30 minutos sin uso y a las 8 horas
// como máximo: con la pestaña abierta un rato largo, la sesión ya no existe cuando
// se envía lo que se cargó. El `proxy` no deja pasar ese Server Action (cuando lo
// que falta es la cookie o ya venció su firma); el navegador tiene que terminar en el
// ingreso o, si algo más falla, en la pantalla de error en español, nunca en la
// página "Application error" de Next.

// Sin sesión en medio de una acción, el login avisa que la sesión se cerró (`error=vencida`) y recuerda la pantalla.
const NEW_SALE_LOGIN_URL = /\/admin\/login\?next=%2Fadmin%2Fventas%2Fnueva&error=vencida$/;
// Volver a pedir la pantalla (no enviar una acción) sin sesión: el `proxy` la manda al login sin aviso.
const NEW_SALE_RELOAD_LOGIN_URL = /\/admin\/login\?next=%2Fadmin%2Fventas%2Fnueva$/;
const SAVE_BUTTON = { name: "Guardar venta" } as const;
const ENGLISH_ERRORS = ["Application error", "unexpected response", "Internal Server Error"];

/** Cambia la cookie de sesión por la de una sesión ya vencida (la firma es buena; la hora, pasada). */
async function expireSession(context: BrowserContext): Promise<void> {
  await context.clearCookies();
  await context.addCookies([
    {
      name: ADMIN_COOKIE,
      value: await signTestToken({ expiresInSeconds: -60 }),
      domain: "localhost",
      path: "/admin",
    },
  ]);
}

/**
 * Cierra la sesión desde otro navegador que tiene la misma cookie: la sesión queda cerrada en la
 * base y la cookie de `context` sigue ahí, con la firma y la hora buenas.
 */
async function closeFromAnotherBrowser(context: BrowserContext, browser: Browser): Promise<void> {
  const cookie = (await context.cookies()).find(({ name }) => name === ADMIN_COOKIE);
  if (!cookie) throw new Error("Falta la cookie de sesión.");
  const elsewhere = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() } });
  try {
    await elsewhere.addCookies([{ name: ADMIN_COOKIE, value: cookie.value, domain: "localhost", path: "/admin" }]);
    const other = await elsewhere.newPage();
    await other.goto("/admin");
    const logout = other.getByRole("button", { name: "Salir" });
    await whenInteractive(logout);
    await logout.click();
    await expect(other).toHaveURL(/\/admin\/login/);
  } finally {
    await elsewhere.close();
  }
}

async function expectNoEnglishError(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  for (const english of ENGLISH_ERRORS) expect(text).not.toContain(english);
}

/** Corta el Server Action de la página (y solo ese pedido) con una respuesta que el cliente no reconoce. */
async function breakServerActions(page: Page): Promise<void> {
  await page.route("**/admin/ventas/nueva", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && "next-action" in request.headers()) {
      await route.fulfill({ status: 500, contentType: "text/html", body: "<h1>Internal Server Error</h1>" });
      return;
    }
    await route.fallback();
  });
}

test.describe("a session that ends while the panel is open", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  for (const [label, end] of [
    ["has no cookie any more", (context: BrowserContext) => context.clearCookies()],
    ["has an expired cookie", expireSession],
  ] as const) {
    test(`a sale submitted when the session ${label} ends at the login, the sale is not saved, and signing in comes back to the form`, async ({
      context,
      page,
    }) => {
      const student = uniqueName("Sesión vencida");
      await openNewSale(page);
      await fillSale(page, { student, item: "lesson", paymentMethod: "transfer", status: "paid" });

      await end(context);
      await page.getByRole("button", SAVE_BUTTON).click();

      // Un cierre limpio: el ingreso, que recuerda la pantalla, y nada en inglés.
      await expect(page).toHaveURL(NEW_SALE_LOGIN_URL);
      await expect(page.getByRole("heading", { name: "Panel de Tallami", level: 1 })).toBeVisible();
      await expectNoEnglishError(page);

      // La acción no corrió: no se guardó nada.
      await submitTestPassword(page);
      await confirmWithTestPasskey(page);
      await expect(page).toHaveURL(/\/admin\/ventas\/nueva$/);
      await page.goto(`/admin/ventas?q=${encodeURIComponent(student)}`);
      await expect(page.getByRole("row").filter({ hasText: student })).toHaveCount(0);
    });
  }

  test("a sale submitted when the session was closed from another browser ends at the login and is not saved", async ({
    browser,
    context,
    page,
  }) => {
    const student = uniqueName("Sesión cerrada");
    await openNewSale(page);
    await fillSale(page, { student, item: "lesson", paymentMethod: "transfer", status: "paid" });

    // La cookie sigue firmada y sin vencer: no la frena el `proxy` sino `requireAdmin()`, que mira la base.
    await closeFromAnotherBrowser(context, browser);
    await page.getByRole("button", SAVE_BUTTON).click();

    // `requireAdmin()` (no el `proxy`) la manda al login: la página del formulario viene del `Referer` del pedido.
    await expect(page).toHaveURL(NEW_SALE_LOGIN_URL);
    await expect(page.getByRole("heading", { name: "Panel de Tallami", level: 1 })).toBeVisible();
    await expectNoEnglishError(page);

    await submitTestPassword(page);
    await confirmWithTestPasskey(page);
    await expect(page).toHaveURL(/\/admin\/ventas\/nueva$/);
    await page.goto(`/admin/ventas?q=${encodeURIComponent(student)}`);
    await expect(page.getByRole("row").filter({ hasText: student })).toHaveCount(0);
  });

  test("any other action ends at the login too: the Salir button of a tab that already lost its session", async ({
    context,
    page,
  }) => {
    await page.goto("/admin");
    const logout = page.getByRole("button", { name: "Salir" });
    await whenInteractive(logout);
    await context.clearCookies();

    await logout.click();

    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin&error=vencida$/);
    await expectNoEnglishError(page);
  });
});

test.describe("an unexpected failure in the panel", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("shows the Spanish error page with a way out, and trying again brings the screen back", async ({
    page,
  }) => {
    await openNewSale(page);
    await fillSale(page, { student: uniqueName("Falla rara"), item: "lesson", paymentMethod: "transfer", status: "paid" });
    await breakServerActions(page);

    await page.getByRole("button", SAVE_BUTTON).click();

    const heading = page.getByRole("heading", { name: "Algo salió mal", level: 1 });
    await expect(heading).toBeVisible();
    await expect(page.getByRole("button", { name: "Volver a intentar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ir al ingreso" })).toHaveAttribute(
      "href",
      "/admin/login?next=%2Fadmin%2Fventas%2Fnueva",
    );
    await expectNoEnglishError(page);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);

    // Pasado el problema, volver a intentar trae la pantalla de nuevo.
    await page.unroute("**/admin/ventas/nueva");
    await page.getByRole("button", { name: "Volver a intentar" }).click();
    await expect(page.getByRole("button", SAVE_BUTTON)).toBeVisible();
    await expect(heading).toHaveCount(0);
  });

  test("trying again after the session ended lands on the login", async ({ context, page }) => {
    await openNewSale(page);
    await fillSale(page, { student: uniqueName("Falla y vence"), item: "lesson", paymentMethod: "transfer", status: "paid" });
    await breakServerActions(page);
    await page.getByRole("button", SAVE_BUTTON).click();
    await expect(page.getByRole("heading", { name: "Algo salió mal", level: 1 })).toBeVisible();

    await page.unroute("**/admin/ventas/nueva");
    await context.clearCookies();
    await page.getByRole("button", { name: "Volver a intentar" }).click();

    await expect(page).toHaveURL(NEW_SALE_RELOAD_LOGIN_URL);
    await expectNoEnglishError(page);
  });
});
