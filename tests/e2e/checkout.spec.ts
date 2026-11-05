import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../helpers/admin";
import { PHONE, whenInteractive } from "../helpers/admin-ui";
import {
  SERVICE_CASES,
  approveAndNeverComeBack,
  changePayment,
  choosePayment,
  emailsOf,
  ensureSharedRate,
  payButton,
  preferencesOf,
  returnWithoutPaying,
  returnedOrder,
  salesInPanel,
  studentName,
  tickAndPay,
} from "../helpers/checkout-e2e";
import {
  STUDENT_COOKIE,
  chooseProviderStudent,
  newStudentBrowser,
  signIn,
  uniqueProviderStudent,
} from "../helpers/portal-e2e";
import en from "../../messages/en.json" with { type: "json" };
import es from "../../messages/es.json" with { type: "json" };
import pt from "../../messages/pt.json" with { type: "json" };

// La compra de punta a punta: la portada, la pantalla de confirmación, Mercado Pago (el servidor falso de
// `tests/helpers/mock-mercadopago-server.mjs`) y la vuelta al portal, con la venta en el panel. El servidor
// es compartido y los tests corren en paralelo: todos usan el mismo valor (1500) y cada uno su propio alumno.
// Que el valor cambie de verdad lo prueba el unitario de `startCheckout`; lo que depende de que no haya
// valor, `checkout-content.test.ts`.

const [VOD, TOURNAMENT, LIVE, PLAN] = SERVICE_CASES;
const SEVERE = new Set(["serious", "critical"]);
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

function screenPath(slug: string, locale = "es"): string {
  return `/${locale}/comprar/${slug}`;
}

/** Entra con un alumno nuevo y deja abierta la pantalla de confirmación de `slug`. */
async function openScreenSignedIn(page: Page, slug: string, locale = "es"): Promise<string> {
  const student = uniqueProviderStudent();
  await signIn(page, { student, locale });
  await page.goto(screenPath(slug, locale));
  await expect(page.getByRole("checkbox")).toBeVisible();
  return student;
}

/** Los avisos de la página (el anunciador de rutas de Next también es un `alert`, pero está fuera de `main`). */
function alerts(page: Page): Locator {
  return page.getByRole("main").getByRole("alert");
}

function statuses(page: Page): Locator {
  return page.getByRole("main").getByRole("status");
}

async function expectNoSevereViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const severe = results.violations.filter(({ impact }) => SEVERE.has(impact ?? ""));
  expect(severe.map(({ id, nodes }) => ({ label, id, targets: nodes.map((node) => node.target) }))).toEqual([]);
}

test.beforeEach(async ({ browser }) => {
  await ensureSharedRate(browser);
});

test.describe("a complete purchase", () => {
  for (const service of SERVICE_CASES) {
    test(`${service.name}: from the button of the home to the sale in the panel`, async ({ page, browser }) => {
      const student = uniqueProviderStudent();
      await signIn(page, { student });

      // La portada lleva a la pantalla.
      await page.goto("/es");
      const button = page.locator("#services li").nth(service.index).getByRole("link");
      await whenInteractive(button);
      await button.click();
      await expect(page).toHaveURL(new RegExp(`${screenPath(service.slug)}$`));

      // La pantalla: el servicio y los dos precios.
      await expect(page.getByRole("heading", { level: 1, name: service.name })).toBeVisible();
      await expect(page.getByTestId("price")).toHaveText(service.usd);
      await expect(page.getByTestId("price-ars")).toHaveText(service.ars);

      // Mercado Pago cobra lo que se mostró, con el título del servicio.
      await tickAndPay(page);
      await expect(page.getByTestId("title")).toHaveText(`Tallami Coaching: ${service.name}`);
      await expect(page.getByTestId("amount")).toHaveText(`${service.unitPrice} ARS`);
      await choosePayment(page, "Aprobar");

      // Vuelve al portal con el aviso y la compra.
      await expect(page).toHaveURL(/\/es\/portal\?compra=[0-9a-f-]{36}/);
      await expect(statuses(page).filter({ hasText: es.Portal.notices.paymentApproved })).toBeVisible();
      await expect(page.getByRole("article")).toHaveCount(1);
      await expect(page.getByRole("article")).toContainText(service.name);

      // En el panel, la venta tiene pesos y dólares.
      const [sale, ...rest] = await salesInPanel(browser, student);
      expect(rest).toEqual([]);
      expect(sale).toContain(service.name);
      expect(sale).toContain("Mercado Pago");
      expect(sale).toContain(service.panelArs);
      expect(sale).toContain(service.panelUsd);

      // Y a quien compró le llega la confirmación.
      await expect.poll(() => emailsOf(page.request, student)).toHaveLength(1);
    });
  }

  test("the form is a plain form: with the JavaScript of the site blocked, it still goes to pay and comes back", async ({ page }) => {
    await page.route("**/_next/static/chunks/*.js", (route) => route.abort());
    await openScreenSignedIn(page, PLAN.slug);

    await tickAndPay(page);
    await choosePayment(page, "Aprobar");

    await expect(page).toHaveURL(/\/es\/portal\?compra=/);
    await expect(statuses(page).filter({ hasText: es.Portal.notices.paymentApproved })).toBeVisible();
    await expect(page.getByRole("article")).toContainText(PLAN.name);
  });

  test.describe("with JavaScript turned off in the browser", () => {
    test.use({ javaScriptEnabled: false });

    // Lo que depende de la sesión llega en el `Suspense`, y mostrarlo es un script del propio HTML. Mercado
    // Pago también lo necesita: la pantalla dice qué hacer en vez de quedar cargando para siempre.
    test("the screen says JavaScript is needed, instead of loading forever", async ({ page }) => {
      await page.goto(screenPath(PLAN.slug));

      await expect(page.getByRole("heading", { level: 1, name: PLAN.name })).toBeVisible();
      // `getByText` no mira adentro de un `noscript`: se lo pide por su etiqueta.
      await expect(page.locator("noscript p")).toHaveText(es.Checkout.noScript);
      await expect(page.locator("noscript p")).toBeVisible();
    });
  });

  test("in Portuguese and in English the screen, the payment and the return keep the language", async ({ page }) => {
    await openScreenSignedIn(page, TOURNAMENT.slug, "pt");
    await expect(page.getByRole("heading", { level: 1, name: pt.Services.items.tournamentReview.name })).toBeVisible();
    await expect(page.getByTestId("price-ars")).toHaveText("ARS 90.000");

    await tickAndPay(page, pt.Checkout.form.pay);
    await expect(page.getByTestId("title")).toHaveText(`Tallami Coaching: ${pt.Services.items.tournamentReview.name}`);
    await choosePayment(page, "Aprobar");

    await expect(page).toHaveURL(/\/pt\/portal\?compra=/);
    await expect(statuses(page).filter({ hasText: pt.Portal.notices.paymentApproved })).toBeVisible();

    await page.goto(screenPath(LIVE.slug, "en"));
    await expect(page.getByRole("heading", { level: 1, name: en.Services.items.vodLive.name })).toBeVisible();
    await expect(page.getByTestId("price-ars")).toHaveText("ARS 67,500");
  });
});

test.describe("without a session", () => {
  test("the screen shows the price and the ways in, and coming back from the sign-in it is the same screen", async ({ page, context }) => {
    const student = uniqueProviderStudent();
    await chooseProviderStudent(context, student);

    await page.goto(screenPath(LIVE.slug));
    await expect(page.getByRole("heading", { level: 1, name: LIVE.name })).toBeVisible();
    await expect(page.getByTestId("price")).toHaveText(LIVE.usd);
    await expect(page.getByTestId("price-ars")).toHaveText(LIVE.ars);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(payButton(page)).toHaveCount(0);

    await page.getByRole("link", { name: es.Portal.providers.test.button }).click();

    await expect(page).toHaveURL(new RegExp(`${screenPath(LIVE.slug)}$`));
    await expect(page.getByRole("checkbox")).toBeVisible();
    await expect(payButton(page)).toBeVisible();
  });
});

test.describe("what stops a payment", () => {
  test("without the box it does not go out to Mercado Pago, also with `required` taken off the page", async ({ page }) => {
    const student = await openScreenSignedIn(page, VOD.slug);

    // El navegador no deja mandar el formulario.
    await payButton(page).click();
    await expect(page).toHaveURL(new RegExp(`${screenPath(VOD.slug)}$`));

    // Sin esa ayuda del navegador, lo frena el servidor.
    await page.getByRole("checkbox").evaluate((box) => box.removeAttribute("required"));
    await payButton(page).click();

    await expect(page).toHaveURL(new RegExp(`${screenPath(VOD.slug)}\\?error=adult$`));
    await expect(alerts(page).filter({ hasText: es.Checkout.errors.adult })).toBeVisible();
    expect(await preferencesOf(page.request, student)).toBe(0);
  });

  test("a value that changed with the screen open: it comes back with the price of now and the notice, and nothing was charged", async ({ page }) => {
    const student = await openScreenSignedIn(page, VOD.slug);
    // El valor de todos los tests es el mismo: lo que cambia es lo que esta pantalla dice haber mostrado.
    await page.locator('input[name="shownArsMinor"]').evaluate((field: HTMLInputElement) => {
      field.value = "4000000";
    });

    await page.getByRole("checkbox").check();
    await payButton(page).click();

    await expect(page).toHaveURL(new RegExp(`${screenPath(VOD.slug)}\\?error=price-changed$`));
    await expect(alerts(page).filter({ hasText: es.Checkout.errors["price-changed"] })).toBeVisible();
    await expect(page.getByTestId("price-ars")).toHaveText(VOD.ars);
    expect(await preferencesOf(page.request, student)).toBe(0);

    // Con el precio nuevo a la vista, sí sale a pagar.
    await tickAndPay(page);
    expect(await preferencesOf(page.request, student)).toBe(1);
  });

  test("a session that ended with the screen open: it offers the way in again and comes back to the same screen", async ({ page, context }) => {
    const student = await openScreenSignedIn(page, VOD.slug);
    await context.clearCookies({ name: STUDENT_COOKIE });

    await page.getByRole("checkbox").check();
    await payButton(page).click();

    await expect(page.getByRole("link", { name: es.Portal.providers.test.button })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`${screenPath(VOD.slug)}$`));
    expect(await preferencesOf(page.request, student)).toBe(0);

    await chooseProviderStudent(context, student);
    await page.getByRole("link", { name: es.Portal.providers.test.button }).click();
    await expect(page).toHaveURL(new RegExp(`${screenPath(VOD.slug)}$`));
    await expect(page.getByRole("checkbox")).toBeVisible();
  });
});

test.describe("what comes back from Mercado Pago", () => {
  test("rejected: the notice, no sale, and it can be tried again up to a single sale", async ({ page, browser }) => {
    const student = await openScreenSignedIn(page, VOD.slug);

    await tickAndPay(page);
    await choosePayment(page, "Rechazar");

    await expect(page).toHaveURL(/\/es\/portal\?compra=/);
    await expect(alerts(page).filter({ hasText: es.Portal.notices.paymentFailed })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(0);
    // Le dice una sola cosa: ni que espere la confirmación, ni que pida una invitación.
    await expect(page.getByText(es.Portal.unlinked.failedBody)).toBeVisible();
    await expect(page.getByText(es.Portal.unlinked.orderBody)).toHaveCount(0);
    await expect(page.getByText(es.Portal.unlinked.body)).toHaveCount(0);
    expect(await salesInPanel(browser, student)).toEqual([]);

    // Lo mismo si abre el portal sin la dirección de la vuelta.
    await page.goto("/es/portal");
    await expect(page.getByText(es.Portal.unlinked.failedBody)).toBeVisible();
    await expect(page.getByText(es.Portal.unlinked.body)).toHaveCount(0);
    await page.goBack();

    await page.getByRole("link", { name: es.Portal.retryPayment }).click();
    await expect(page).toHaveURL(new RegExp(`${screenPath(VOD.slug)}$`));

    await tickAndPay(page);
    await choosePayment(page, "Aprobar");

    await expect(statuses(page).filter({ hasText: es.Portal.notices.paymentApproved })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(1);
    expect(await salesInPanel(browser, student)).toHaveLength(1);
  });

  test("coming back without paying: it keeps saying it is waiting and offers a way back, to a new buyer and to one with purchases", async ({ page, browser }) => {
    const student = await openScreenSignedIn(page, VOD.slug);
    await tickAndPay(page);

    // La primera compra: la cuenta todavía no está vinculada.
    await page.goto(await returnWithoutPaying(page.request, student));
    await expect(statuses(page).filter({ hasText: es.Portal.notices.paymentPending })).toBeVisible();
    await expectNoSevereViolations(page, "portal, pago sin confirmar");
    await page.getByRole("link", { name: es.Portal.retryUnpaid }).click();
    await expect(page).toHaveURL(new RegExp(`${screenPath(VOD.slug)}$`));

    // Intentar de nuevo es un pedido nuevo, y el que quedó sin pagar no molesta.
    await tickAndPay(page);
    await choosePayment(page, "Aprobar");
    await expect(statuses(page).filter({ hasText: es.Portal.notices.paymentApproved })).toBeVisible();
    await expect(page.getByRole("link", { name: es.Portal.retryUnpaid })).toHaveCount(0);
    expect(await salesInPanel(browser, student)).toHaveLength(1);

    // Ya con una compra: la cuenta está vinculada y esta página no tiene otro camino a los servicios.
    await page.goto(screenPath(PLAN.slug));
    await tickAndPay(page);
    await page.goto(await returnWithoutPaying(page.request, student));
    await expect(statuses(page).filter({ hasText: es.Portal.notices.paymentPending })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(1);
    await page.getByRole("link", { name: es.Portal.retryUnpaid }).click();
    await expect(page).toHaveURL(new RegExp(`${screenPath(PLAN.slug)}$`));
  });

  test("approved without a notice: the portal asks Mercado Pago and the sale appears anyway, only one, even when the notice arrives later", async ({ page, browser }) => {
    const student = await openScreenSignedIn(page, TOURNAMENT.slug);

    await tickAndPay(page);
    await choosePayment(page, "Aprobar sin aviso");

    await expect(page).toHaveURL(/\/es\/portal\?compra=/);
    // La cuenta se vinculó en ese mismo momento: ve su compra, no el "falta un paso".
    await expect(statuses(page).filter({ hasText: es.Portal.notices.paymentApproved })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByRole("article")).toContainText(TOURNAMENT.name);

    await page.reload();
    await expect(page.getByRole("article")).toHaveCount(1);

    const { paymentId } = returnedOrder(page);
    expect(await changePayment(page.request, paymentId, "approved")).toBe(200);

    const sales = await salesInPanel(browser, student);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toContain(TOURNAMENT.panelArs);
    await expect.poll(() => emailsOf(page.request, student)).toHaveLength(1);
  });

  test("the address cannot invent a result: a typed `status=approved` over a rejected payment still says it failed", async ({ page, browser }) => {
    const student = await openScreenSignedIn(page, VOD.slug);
    await tickAndPay(page);
    await choosePayment(page, "Rechazar");
    await expect(alerts(page).filter({ hasText: es.Portal.notices.paymentFailed })).toBeVisible();
    const { orderId, paymentId } = returnedOrder(page);

    await page.goto(`/es/portal?compra=${orderId}&payment_id=${paymentId}&status=approved&collection_status=approved`);

    await expect(alerts(page).filter({ hasText: es.Portal.notices.paymentFailed })).toBeVisible();
    await expect(statuses(page)).toHaveCount(0);
    expect(await salesInPanel(browser, student)).toEqual([]);
  });
});

test.describe("the order of someone else", () => {
  test("/es/portal?compra=<order of another> shows no notice and no data, and asks nothing about it", async ({ page, browser }) => {
    const owner = await openScreenSignedIn(page, VOD.slug);
    await tickAndPay(page);
    await choosePayment(page, "Aprobar sin aviso");
    await expect(page).toHaveURL(/\/es\/portal\?compra=/);
    const { orderId, paymentId } = returnedOrder(page);

    const other = await newStudentBrowser(browser);
    await signIn(other.page, { student: uniqueProviderStudent() });
    await other.page.goto(`/es/portal?compra=${orderId}&payment_id=${paymentId}`);

    const main = other.page.getByRole("main");
    await expect(main.getByText(es.Portal.unlinked.title)).toBeVisible();
    await expect(alerts(other.page)).toHaveCount(0);
    await expect(statuses(other.page)).toHaveCount(0);
    await expect(main).not.toContainText(studentName(owner));
    await expect(main).not.toContainText(VOD.name);
    await expect(main.getByRole("article")).toHaveCount(0);
    await other.context.close();
  });

  test("a payment id of another order in the address does nothing to either", async ({ page, browser }) => {
    // Alguien aprueba sin aviso y no vuelve (su pedido sigue sin confirmar), y otro prueba con ese pago.
    const owner = await openScreenSignedIn(page, VOD.slug);
    await tickAndPay(page);
    const paymentId = await approveAndNeverComeBack(page);

    const other = await newStudentBrowser(browser);
    const thief = await openScreenSignedIn(other.page, VOD.slug);
    await tickAndPay(other.page);
    await choosePayment(other.page, "Rechazar");
    await expect(other.page).toHaveURL(/\/es\/portal\?compra=/);
    const { orderId } = returnedOrder(other.page);

    await other.page.goto(`/es/portal?compra=${orderId}&payment_id=${paymentId}`);

    await expect(alerts(other.page).filter({ hasText: es.Portal.notices.paymentFailed })).toBeVisible();
    expect(await salesInPanel(browser, thief)).toEqual([]);
    expect(await salesInPanel(browser, owner)).toEqual([]);
    await other.context.close();
  });
});

test.describe("the addresses of the screen", () => {
  test("a service that does not exist is a real 404, in the language of the address", async ({ request, page }) => {
    for (const [locale, messages] of [["es", es], ["pt", pt], ["en", en]] as const) {
      for (const slug of ["no-existe", "https%3A%2F%2Fmal.example", "vod-3-partidas-x", "x-vod-3-partidas"]) {
        expect((await request.get(`/${locale}/comprar/${slug}`)).status(), `${locale}/${slug}`).toBe(404);
      }
      await page.goto(`/${locale}/comprar/no-existe`);
      await expect(page.getByRole("heading", { level: 1, name: messages.NotFound.title })).toBeVisible();
    }
  });

  test("the addresses of the services are not caught by that 404", async ({ request }) => {
    for (const { slug } of SERVICE_CASES) {
      for (const locale of ["es", "pt", "en"]) {
        expect((await request.get(screenPath(slug, locale))).status(), `${locale}/${slug}`).toBe(200);
      }
    }
  });

  test("it is private: not indexed, and no Referer to other sites", async ({ page }) => {
    const response = await page.goto(screenPath(VOD.slug));

    expect(response?.headers()["referrer-policy"]).toBe("same-origin");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});

test.describe("accessibility", () => {
  test("no serious or critical violations on the screen, with and without a session, nor on the notices of the return", async ({ page }) => {
    await page.goto(screenPath(VOD.slug));
    await expect(page.getByTestId("price-ars")).toBeVisible();
    await expectNoSevereViolations(page, "sin sesión");

    await openScreenSignedIn(page, VOD.slug);
    await expectNoSevereViolations(page, "con sesión");

    await page.goto(`${screenPath(VOD.slug)}?error=price-changed`);
    await expect(alerts(page)).toBeVisible();
    await expectNoSevereViolations(page, "con un aviso de error");

    await tickAndPay(page);
    await choosePayment(page, "Rechazar");
    await expect(alerts(page)).toBeVisible();
    await expectNoSevereViolations(page, "portal, pago rechazado");

    await page.getByRole("link", { name: es.Portal.retryPayment }).click();
    await tickAndPay(page);
    await choosePayment(page, "Aprobar");
    await expect(statuses(page)).toBeVisible();
    await expectNoSevereViolations(page, "portal, pago aprobado");
  });

  test.describe("on a phone", () => {
    test.use({ viewport: PHONE });

    test("the screen never scrolls sideways and the payment button is within reach", async ({ page }) => {
      await openScreenSignedIn(page, TOURNAMENT.slug);

      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      await expect(payButton(page)).toBeVisible();
      await expectNoSevereViolations(page, "en un celular");
    });
  });
});
