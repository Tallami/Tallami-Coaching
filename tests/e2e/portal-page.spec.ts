import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { PHONE, createSale, createSaleForExisting, uniqueName } from "../helpers/admin-ui";
import { addDelivery, createStudent, inviteStudent, openSale, pdfFile } from "../helpers/portal-admin-ui";
import {
  FLOW_COOKIE,
  STUDENT_COOKIE,
  URL_SAFE_32_BYTES,
  chooseProviderStudent,
  cookieNamed,
  newStudentBrowser,
  signIn,
  startSignIn,
  uniqueProviderStudent,
} from "../helpers/portal-e2e";
import en from "../../messages/en.json" with { type: "json" };
import es from "../../messages/es.json" with { type: "json" };
import pt from "../../messages/pt.json" with { type: "json" };

// La página del alumno (`/[locale]/portal`) de punta a punta, con alumnos de verdad: Tallami carga
// ventas y entregas en el panel, los invita, y cada alumno entra con el proveedor de prueba (el
// servidor OAuth falso de `tests/helpers/mock-oauth-server.mjs`) y mira su página en un navegador
// propio. Nada habla con la red: el reproductor de YouTube se reemplaza por una página de prueba.

const YOUTUBE = "https://youtu.be/dQw4w9WgXcQ?si=prueba";
const VIDEO_ID = "dQw4w9WgXcQ";
const DRIVE = "https://drive.google.com/file/d/1AbC/view?usp=sharing";
const DESKTOP = { width: 1440, height: 900 } as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
/** Un token con la forma de una invitación, pero que no existe: sirve para ver cómo se comporta la página con el link. */
const FAKE_TOKEN = "Zm9vYmFyYmF6cXV4MDEyMzQ1Njc4OWFiY2RlZmdoaWo";

const LOCALES = [
  { locale: "es", messages: es },
  { locale: "pt", messages: pt },
  { locale: "en", messages: en },
] as const;

/** El reproductor de YouTube no se pide a la red: el marco recibe una página de prueba. */
async function stubYoutube(context: BrowserContext): Promise<void> {
  await context.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: '<!doctype html><html lang="es"><head><title>Video de prueba</title></head><body>Video de prueba</body></html>',
    }),
  );
}

async function audit(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(results.violations.map(({ id, nodes }) => ({ label, id, targets: nodes.map((node) => node.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), label).toBeLessThanOrEqual(0);
}

/** Los avisos de la página (el anunciador de rutas de Next también es un `alert`, pero está fuera de `main`). */
function alerts(page: Page): Locator {
  return page.getByRole("main").getByRole("alert");
}

/** Las compras de la página, de la más nueva a la más vieja. */
function purchases(page: Page): Locator {
  return page.getByRole("article");
}

/** Dónde cae el foco en cada Tab: el nombre de lo que lo tiene y cómo se dibuja su aro. */
interface FocusStop {
  name: string;
  tag: string;
  focusVisible: boolean;
  outlineStyle: string;
  outlineWidth: string;
}

/** Más Tab que esto sin llegar a `until` es que el foco se perdió: el recorrido falla en vez de seguir. */
const MAX_TABS = 40;

/**
 * Pulsa Tab desde el principio de la página y anota dónde cae el foco cada vez, hasta llegar a lo que se llama `until`
 * (el último link del pie): ahí termina, para no salir del documento.
 */
async function tabThrough(page: Page, until: string): Promise<FocusStop[]> {
  const stops: FocusStop[] = [];
  for (let press = 0; press < MAX_TABS; press += 1) {
    await page.keyboard.press("Tab");
    stops.push(
      await page.evaluate(() => {
        const element = document.activeElement as HTMLElement;
        const style = getComputedStyle(element);
        // Un marco se nombra por su `title`; todo lo demás, por su texto (con lo que lee el lector de pantalla).
        const label = element.getAttribute("title") ?? element.textContent ?? "";
        return {
          name: label.trim().replace(/\s+/g, " ").slice(0, 80),
          tag: element.tagName,
          focusVisible: element.matches(":focus-visible"),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth,
        };
      }),
    );
    if (stops[stops.length - 1].name.startsWith(until)) return stops;
  }
  throw new Error(`El foco no llegó a "${until}" en ${MAX_TABS} Tab: ${JSON.stringify(stops.map(({ name }) => name))}`);
}

/** Los nombres esperados aparecen en ese orden (empiezan igual: los links nuevos agregan "(se abre en una pestaña nueva)"). */
function expectInOrder(names: string[], expected: string[]): void {
  let from = 0;
  for (const name of expected) {
    const index = names.findIndex((value, position) => position >= from && value.startsWith(name));
    expect(index, `"${name}" after position ${from} in ${JSON.stringify(names)}`).toBeGreaterThanOrEqual(0);
    from = index + 1;
  }
}

/**
 * Cada parada del foco tiene su aro a la vista: el de `:focus-visible` de la marca, de 3 px y sólido. El marco del
 * reproductor se salta: cuando el foco entra al video, el aro lo dibuja el reproductor de YouTube, no la página.
 */
function expectVisibleFocus(walk: FocusStop[]): void {
  for (const stop of walk.filter(({ tag }) => tag !== "IFRAME")) {
    expect(stop.focusVisible, `${stop.name} matches :focus-visible`).toBe(true);
    expect({ name: stop.name, style: stop.outlineStyle, width: stop.outlineWidth }).toEqual({
      name: stop.name,
      style: "solid",
      width: "3px",
    });
  }
}

interface LinkedStudent {
  name: string;
  browser: { context: BrowserContext; page: Page };
}

/** Un alumno nuevo con una venta cobrada, invitado desde el panel y ya vinculado a su cuenta del proveedor de prueba. */
async function linkedStudent(page: Page, browser: Browser, prefix: string): Promise<LinkedStudent> {
  const name = uniqueName(prefix);
  await createSale(page, { student: name, item: "vodRecorded", currency: "USD", amount: "30", status: "paid", paidOn: "2026-10-05" });
  const token = await inviteStudent(page, name);
  const studentBrowser = await newStudentBrowser(browser);
  await stubYoutube(studentBrowser.context);
  const landed = await signIn(studentBrowser.page, { invitation: token });
  expect(landed.search).toBe("?invitacion=vinculada");
  return { name, browser: studentBrowser };
}

test.describe("the student portal without a session", () => {
  for (const { locale, messages } of LOCALES) {
    test(`/${locale}/portal asks to sign in, in the language of the page, with only the providers that are enabled`, async ({
      page,
    }) => {
      await page.goto(`/${locale}/portal`);

      await expect(page.getByRole("heading", { level: 1, name: messages.Portal.title })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: messages.Portal.signIn.title })).toBeVisible();
      // El servidor de los e2e solo tiene el proveedor de prueba: ni Discord ni Google, y el botón dice que es de prueba.
      const sign = page.getByRole("link", { name: messages.Portal.providers.test.button });
      await expect(sign).toBeVisible();
      await expect(sign).toHaveAttribute("href", `/api/portal/auth/test?locale=${locale}`);
      await expect(page.getByRole("link", { name: /Discord|Google/ })).toHaveCount(0);
      await expect(page.locator("html")).toHaveAttribute("lang", locale === "pt" ? "pt-BR" : locale);
      await expect(page.getByRole("contentinfo").getByRole("link", { name: messages.Footer.portal })).toHaveAttribute(
        "href",
        `/${locale}/portal`,
      );
      // Nada de los otros idiomas.
      for (const other of LOCALES) {
        if (other.locale === locale) continue;
        if (other.messages.Portal.signIn.title !== messages.Portal.signIn.title) {
          await expect(page.getByText(other.messages.Portal.signIn.title, { exact: true })).toHaveCount(0);
        }
      }
      expect(await page.locator("body").innerText()).not.toMatch(/undefined|\[object|Portal\./);
    });
  }

  test("is private: not indexed, not cached, and it sends no Referer to other sites", async ({ request, page }) => {
    for (const { locale } of LOCALES) {
      const response = await request.get(`/${locale}/portal`);

      expect(response.status(), locale).toBe(200);
      // `same-origin`: nada sale hacia otros sitios, y al propio sitio el Referer y el `Origin` de un POST siguen llegando.
      expect(response.headers()["referrer-policy"], locale).toBe("same-origin");
      expect(response.headers()["cache-control"], locale).not.toMatch(/public|s-maxage/);
      expect(response.headers()["cache-control"], locale).toMatch(/no-store|private/);
    }
    await page.goto("/es/portal");
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
    await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /nofollow/);
    // El respaldo del encabezado: la misma política, en la propia página.
    await expect(page.locator("meta[name=referrer]")).toHaveAttribute("content", "same-origin");
    await expect(page).toHaveTitle(es.Portal.metaTitle);
    // No se anuncia como una versión de la portada: su dirección canónica es la propia.
    await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", /\/es\/portal$/);
    await expect(page.locator("link[rel=alternate][hreflang]")).toHaveCount(0);
  });

  test("the public pages stay static and the rest of the site keeps its Referrer-Policy", async ({ request }) => {
    for (const { locale } of LOCALES) {
      const response = await request.get(`/${locale}`);

      expect(response.headers()["referrer-policy"], locale).toBe("strict-origin-when-cross-origin");
      expect(response.headers()["cache-control"], locale).toMatch(/s-maxage=\d+/);
    }
  });

  test("a sign-in that failed shows a notice, and the buttons to try again", async ({ page }) => {
    await page.goto("/es/portal?ingreso=fallido");

    await expect(alerts(page)).toHaveText(es.Portal.notices.signInFailed);
    await expect(page.getByRole("link", { name: es.Portal.providers.test.button })).toBeVisible();
    await page.goto("/pt/portal?ingreso=fallido");
    await expect(alerts(page)).toHaveText(pt.Portal.notices.signInFailed);
    await page.goto("/en/portal?ingreso=fallido");
    await expect(alerts(page)).toHaveText(en.Portal.notices.signInFailed);
  });

  test("a sign-in cancelled in the provider comes back to the notice without a session", async ({ page }) => {
    const authorize = await startSignIn(page.request, { deny: true });
    await page.goto(authorize.toString());

    await expect(page).toHaveURL(/\/es\/portal\?ingreso=fallido$/);
    await expect(alerts(page)).toHaveText(es.Portal.notices.signInFailed);
    expect(await cookieNamed(page.context(), STUDENT_COOKIE)).toBeUndefined();
  });

  test("the link of an invitation asks to sign in to link the account, keeps the token only in the buttons, and takes it off the address bar", async ({
    page,
  }) => {
    await page.goto(`/es/portal?invitacion=${FAKE_TOKEN}`);

    await expect(page.getByRole("status").filter({ hasText: es.Portal.notices.inviteToSignIn })).toBeVisible();
    // El botón lleva la invitación a la ruta del ingreso (es lo único que la lleva)...
    const sign = page.getByRole("link", { name: es.Portal.providers.test.button });
    await expect(sign).toHaveAttribute("href", `/api/portal/auth/test?locale=es&invitacion=${FAKE_TOKEN}`);
    // ...y la barra de direcciones ya no la tiene: ni cuando la página la saca, ni cuando todo lo que estaba
    // en curso (la hidratación, las precargas del router) terminó de acomodarse.
    await expect.poll(() => new URL(page.url()).search).toBe("");
    await page.waitForLoadState("networkidle");
    expect(new URL(page.url()).search).toBe("");
    expect(page.url()).not.toContain(FAKE_TOKEN);
    expect(page.url()).not.toContain("invitacion");
    // Ningún otro atributo de la página lo repite: ni un link canónico ni una etiqueta del encabezado.
    await expect(page.locator(`a[href*="${FAKE_TOKEN}"]`)).toHaveCount(1);
    await expect(page.locator(`[href*="${FAKE_TOKEN}"]:not(a), [src*="${FAKE_TOKEN}"], [content*="${FAKE_TOKEN}"]`)).toHaveCount(0);
    await expect(page).not.toHaveTitle(new RegExp(FAKE_TOKEN));
  });

  test("the notices that are about an account are not shown to someone without a session, whatever the address says", async ({ page }) => {
    await page.goto("/es/portal?invitacion=vinculada");
    await expect(page.getByRole("link", { name: es.Portal.providers.test.button })).toBeVisible();
    await expect(page.getByText(es.Portal.notices.linked)).toHaveCount(0);
    await expect(alerts(page)).toHaveCount(0);

    await page.goto("/es/portal?invitacion=invalida");
    await expect(page.getByText(es.Portal.notices.inviteInvalid)).toHaveCount(0);
  });

  test("has no accessibility problems and no sideways scroll on a phone and on a desktop, in every language, with and without a notice", async ({
    page,
  }) => {
    for (const { locale, messages } of LOCALES) {
      for (const [label, size] of [
        ["celular", PHONE],
        ["escritorio", DESKTOP],
      ] as const) {
        const where = `${locale}, ${label}`;
        await page.setViewportSize(size);
        await page.goto(`/${locale}/portal`);
        await expect(page.getByRole("link", { name: messages.Portal.providers.test.button })).toBeVisible();
        await audit(page, `sin sesión, ${where}`);
        // El aviso de error (`alert`) y el informativo de la invitación (`status`).
        await page.goto(`/${locale}/portal?ingreso=fallido`);
        await expect(alerts(page)).toBeVisible();
        await audit(page, `con un error, ${where}`);
        await page.goto(`/${locale}/portal?invitacion=${FAKE_TOKEN}`);
        await expect(page.getByRole("main").getByRole("status").filter({ hasText: messages.Portal.notices.inviteToSignIn })).toBeVisible();
        await audit(page, `con el aviso de la invitación, ${where}`);
      }
    }
  });

  test("the keyboard reaches the skip link, the brand, the languages, the sign-in button and the footer, each with a visible focus ring", async ({
    page,
  }) => {
    await page.goto("/es/portal");
    await expect(page.getByRole("link", { name: es.Portal.providers.test.button })).toBeVisible();

    const walk = await tabThrough(page, es.Footer.portal);

    expectInOrder(
      walk.map((stop) => stop.name),
      [es.Common.skipLink, "Tallami.", "ES", "PT", "EN", es.Portal.providers.test.button, "X", es.Footer.portal],
    );
    expectVisibleFocus(walk);
  });
});

test.describe("signing in from the page", () => {
  test("the link of an invitation, the button of the page and the provider link the account, and the page shows the purchases", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    const name = uniqueName("Alumna del link");
    await createSale(page, { student: name, item: "lesson", currency: "USD", amount: "40", status: "paid", paidOn: "2026-10-12" });
    const token = await inviteStudent(page, name);
    const student = uniqueProviderStudent();
    const { context, page: studentPage } = await newStudentBrowser(browser);
    await chooseProviderStudent(context, student);

    // Abre el link que le mandó Tallami y toca el botón: el clic es dentro del sitio, así que la invitación se canjea.
    await studentPage.goto(`/es/portal?invitacion=${token}`);
    await expect(studentPage.getByText(es.Portal.notices.inviteToSignIn)).toBeVisible();
    await expect.poll(() => new URL(studentPage.url()).search).toBe("");
    const origin = new URL(studentPage.url()).origin;
    const started = studentPage.waitForRequest((request) => new URL(request.url()).pathname === "/api/portal/auth/test");
    await studentPage.getByRole("link", { name: es.Portal.providers.test.button }).click();

    // Lo que el navegador manda al empezar el ingreso: es un clic dentro del sitio, y el Referer es la página del
    // portal sin el token (ya no estaba en la barra). `same-origin` lo deja llegar al propio sitio, y a nadie más.
    const startRequest = await started;
    const startHeaders = await startRequest.allHeaders();
    expect(startHeaders["sec-fetch-site"]).toBe("same-origin");
    expect(startHeaders["referer"]).toBe(`${origin}/es/portal`);
    expect(startRequest.url()).toContain(token); // viaja en la dirección de inicio, que es lo que lo canjea...
    expect(startHeaders["referer"]).not.toContain(token); // ...y no en el Referer.
    await expect(studentPage).toHaveURL(/\/es\/portal\?invitacion=vinculada$/);
    await expect(studentPage.getByRole("status").filter({ hasText: es.Portal.notices.linked })).toBeVisible();
    await expect(studentPage.getByRole("heading", { level: 2, name: es.Portal.purchases.title })).toBeVisible();
    await expect(purchases(studentPage)).toHaveCount(1);
    await expect(purchases(studentPage).first()).toContainText("Clase 1 a 1");
    await expect(purchases(studentPage).first()).toContainText("USD 40");
    await expect(studentPage.getByText(`Hola, Alumno ${student}`)).toBeVisible();

    // Ya vinculada, abrir el mismo link otra vez no es un error: la cuenta ya está vinculada.
    await studentPage.goto(`/es/portal?invitacion=invalida`);
    await expect(studentPage.getByText(es.Portal.notices.alreadyLinked, { exact: true })).toBeVisible();
    await expect(alerts(studentPage)).toHaveCount(0);
    await expect(purchases(studentPage)).toHaveCount(1);

    // Ya vinculada, abrir el link de una invitación (con su token) avisa que entró con otra cuenta, sin tocar
    // lo suyo, y saca el token de la barra.
    await studentPage.goto(`/es/portal?invitacion=${token}`);
    await expect(studentPage.getByRole("status").filter({ hasText: es.Portal.notices.inviteOtherAccount })).toBeVisible();
    await expect(purchases(studentPage)).toHaveCount(1);
    await expect.poll(() => new URL(studentPage.url()).search).toBe("");
    await expect(alerts(studentPage)).toHaveCount(0);
    await context.close();
  });

  test("a student with a session whose account is not linked yet is told to ask for the invitation, and can use the one that arrives later", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    const name = uniqueName("Alumno sin vincular");
    await createSale(page, { student: name, item: "vodLive", currency: "USD", amount: "45", status: "paid", paidOn: "2026-10-10" });
    const student = uniqueProviderStudent();
    const { context, page: studentPage } = await newStudentBrowser(browser);
    await chooseProviderStudent(context, student);

    // Entra sin invitación: tiene cuenta y sesión, pero no ve nada de nadie.
    await studentPage.goto("/es/portal");
    await studentPage.getByRole("link", { name: es.Portal.providers.test.button }).click();
    await expect(studentPage).toHaveURL(/\/es\/portal$/);
    await expect(studentPage.getByText(es.Portal.unlinked.body)).toBeVisible();
    await expect(studentPage.getByRole("button", { name: es.Portal.account.signOut })).toBeVisible();
    await expect(purchases(studentPage)).toHaveCount(0);
    expect(await studentPage.locator("body").innerText()).not.toContain(name);

    // Después le llega la invitación: con la sesión abierta, la página le pide volver a entrar para usarla.
    const token = await inviteStudent(page, name);
    await studentPage.goto(`/es/portal?invitacion=${token}`);
    await expect(studentPage.getByText(es.Portal.unlinked.withInvite)).toBeVisible();
    await expect.poll(() => new URL(studentPage.url()).search).toBe("");
    await studentPage.getByRole("link", { name: es.Portal.providers.test.button }).click();

    await expect(studentPage).toHaveURL(/\/es\/portal\?invitacion=vinculada$/);
    await expect(purchases(studentPage)).toHaveCount(1);
    await expect(purchases(studentPage).first()).toContainText("VOD review en vivo");
    await context.close();
  });

  test("the invitation that is no good (already used) is explained, and the account stays unlinked", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const name = uniqueName("Alumno invitacion usada");
    await createSale(page, { student: name });
    const token = await inviteStudent(page, name);
    const first = await newStudentBrowser(browser);
    await signIn(first.page, { invitation: token });
    const second = await newStudentBrowser(browser);
    const student = uniqueProviderStudent();
    await chooseProviderStudent(second.context, student);

    await second.page.goto(`/es/portal?invitacion=${token}`);
    await second.page.getByRole("link", { name: es.Portal.providers.test.button }).click();

    await expect(second.page).toHaveURL(/\/es\/portal\?invitacion=invalida$/);
    await expect(alerts(second.page)).toHaveText(es.Portal.notices.inviteInvalid);
    await expect(second.page.getByText(es.Portal.unlinked.body)).toBeVisible();
    await expect(purchases(second.page)).toHaveCount(0);
    await first.context.close();
    await second.context.close();
  });

  test("a browser without Sec-Fetch-Site keeps the invite when the Referer is the portal page without the token, and drops it for a Referer of another site", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    const name = uniqueName("Alumno sin sec-fetch");
    await createSale(page, { student: name });
    const token = await inviteStudent(page, name);
    const origin = new URL(test.info().project.use.baseURL ?? "").origin;
    const student = await newStudentBrowser(browser);

    // Un pedido crudo, como el de un navegador viejo: sin `Sec-Fetch-Site`, solo el `Referer`.
    // Desde otro sitio, no se canjea: la persona entra, sin vincularse.
    const fromAnotherSite = await signIn(student.page, { invitation: token, headers: { referer: "https://evil.example/es/portal" } });
    expect(fromAnotherSite.pathname + fromAnotherSite.search).toBe("/es/portal");
    await expect(student.page.getByText(es.Portal.unlinked.body)).toBeVisible();

    // Desde la página del portal (la dirección sin el token, que es lo que manda la página una vez que lo sacó de la barra), sí.
    const fromThePortal = await signIn(student.page, { invitation: token, headers: { referer: `${origin}/es/portal` } });
    expect(fromThePortal.pathname + fromThePortal.search).toBe("/es/portal?invitacion=vinculada");
    await expect(purchases(student.page)).toHaveCount(1);
    await student.context.close();
  });

  test("a linked account with no purchases sees an empty list that says so, and the page has no accessibility problems", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    const name = uniqueName("Alumna sin compras");
    await createStudent(page, name);
    const token = await inviteStudent(page, name);
    const student = await newStudentBrowser(browser);
    expect((await signIn(student.page, { invitation: token })).search).toBe("?invitacion=vinculada");
    const s = student.page;

    await expect(s.getByRole("heading", { level: 2, name: es.Portal.purchases.title })).toBeVisible();
    await expect(s.getByText(es.Portal.purchases.empty)).toBeVisible();
    await expect(purchases(s)).toHaveCount(0);
    await expect(s.getByRole("button", { name: es.Portal.account.signOut })).toBeVisible();
    for (const [label, size] of [
      ["celular", PHONE],
      ["escritorio", DESKTOP],
    ] as const) {
      await s.setViewportSize(size);
      await s.goto("/es/portal");
      await expect(s.getByText(es.Portal.purchases.empty)).toBeVisible();
      await audit(s, `vinculada sin compras, ${label}`);
    }
    await student.context.close();
  });

  test("an account that is not linked yet has no accessibility problems on a phone and on a desktop, with and without the invitation, in every language", async ({
    browser,
  }) => {
    const student = await newStudentBrowser(browser);
    await signIn(student.page, {});
    const s = student.page;

    for (const { locale, messages } of LOCALES) {
      for (const [label, size] of [
        ["celular", PHONE],
        ["escritorio", DESKTOP],
      ] as const) {
        const where = `${locale}, ${label}`;
        await s.setViewportSize(size);
        await s.goto(`/${locale}/portal`);
        await expect(s.getByText(messages.Portal.unlinked.body)).toBeVisible();
        await audit(s, `sin vincular, ${where}`);
        // Con el link de una invitación: la vista le pide entrar de nuevo, con los botones sobre el color del escenario.
        await s.goto(`/${locale}/portal?invitacion=${FAKE_TOKEN}`);
        await expect(s.getByText(messages.Portal.unlinked.withInvite)).toBeVisible();
        await audit(s, `sin vincular, con la invitación, ${where}`);
        // Y con el aviso de error de una invitación que no sirve.
        await s.goto(`/${locale}/portal?invitacion=invalida`);
        await expect(alerts(s)).toHaveText(messages.Portal.notices.inviteInvalid);
        await audit(s, `sin vincular, con la invitación inválida, ${where}`);
      }
    }
    await student.context.close();
  });

  test("Salir closes the session: the cookie goes, the page asks to sign in again, and the old cookie opens nothing", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    const { browser: student } = await linkedStudent(page, browser, "Alumna que sale");
    const cookie = await cookieNamed(student.context, STUDENT_COOKIE);
    expect(cookie?.value).toMatch(URL_SAFE_32_BYTES);

    await student.page.goto("/es/portal");
    const origin = new URL(student.page.url()).origin;
    const loggedOut = student.page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/portal/auth/logout");
    await student.page.getByRole("button", { name: es.Portal.account.signOut }).click();

    // Un POST del propio sitio: con `same-origin` el `Origin` llega (con `no-referrer` el navegador lo mandaba `null`).
    const logoutHeaders = await (await loggedOut).allHeaders();
    expect(logoutHeaders["origin"]).toBe(origin);
    expect(logoutHeaders["referer"]).toBe(`${origin}/es/portal`);

    await expect(student.page).toHaveURL(/\/es\/portal$/);
    await expect(student.page.getByRole("link", { name: es.Portal.providers.test.button })).toBeVisible();
    await expect(purchases(student.page)).toHaveCount(0);
    expect(await cookieNamed(student.context, STUDENT_COOKIE)).toBeUndefined();
    // Quien conserve la cookie vieja tampoco entra: la sesión se cerró en la base.
    await student.context.addCookies([
      { name: STUDENT_COOKIE, value: cookie?.value ?? "", url: new URL(student.page.url()).origin },
    ]);
    await student.page.goto("/es/portal");
    await expect(student.page.getByRole("link", { name: es.Portal.providers.test.button })).toBeVisible();
    await expect(purchases(student.page)).toHaveCount(0);
    expect(await cookieNamed(student.context, FLOW_COOKIE)).toBeUndefined();
    await student.context.close();
  });
});

test.describe("the panel and the portal never open each other", () => {
  test("a browser with only the session of the panel sees the sign-in of the portal, with no data", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/ventas");
    await expect(page).toHaveURL(/\/admin\/ventas/);

    await page.goto("/es/portal");

    await expect(page.getByRole("heading", { level: 2, name: es.Portal.signIn.title })).toBeVisible();
    await expect(page.getByRole("link", { name: es.Portal.providers.test.button })).toBeVisible();
    await expect(page.getByRole("button", { name: es.Portal.account.signOut })).toHaveCount(0);
    await expect(purchases(page)).toHaveCount(0);
  });

  test("a browser with only the session of a student is sent to the login of the panel", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const { browser: student } = await linkedStudent(page, browser, "Alumno curioso del panel");

    await student.page.goto("/admin/ventas");

    await expect(student.page).toHaveURL(/\/admin\/login/);
    await expect(student.page.getByLabel("Contraseña")).toBeVisible();
    await student.context.close();
  });
});

test.describe("a student with purchases and deliveries", () => {
  test("sees their own purchases and deliveries, in their language, and another student sees nothing of them", async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    await loginAsAdmin(page);

    // Ana: dos compras (una cobrada con un video y un link, una pendiente con un PDF). Beto: una compra sin entregas.
    const ana = uniqueName("Ana de las entregas");
    await createSale(page, { student: ana, item: "vodRecorded", currency: "USD", amount: "30", status: "paid", paidOn: "2026-10-05" });
    await createSaleForExisting(page, { student: ana, item: "gamePlan", currency: "ARS", amount: "50000", status: "pending", paidOn: "" });
    await openSale(page, ana, "VOD review grabado");
    await addDelivery(page, { kind: "youtube", title: "Review de tu partida", url: YOUTUBE });
    await addDelivery(page, { kind: "link", title: "Guía en Drive", url: DRIVE });
    await openSale(page, ana, "Plan de juego personalizado");
    const secret = pdfFile("plan.pdf");
    await addDelivery(page, { kind: "pdf", title: "Plan de juego de Ana", file: secret });
    const anaToken = await inviteStudent(page, ana);
    const anaBrowser = await newStudentBrowser(browser);
    await stubYoutube(anaBrowser.context);
    expect((await signIn(anaBrowser.page, { invitation: anaToken })).search).toBe("?invitacion=vinculada");
    const beto = await linkedStudent(page, browser, "Beto sin entregas");
    const a = anaBrowser.page;
    const b = beto.browser.page;

    // --- Ana, en español ---
    await a.goto("/es/portal");
    await expect(purchases(a)).toHaveCount(2);
    // También con la sesión abierta, la página con las compras de alguien no se guarda en ningún caché compartido.
    const authenticated = await a.request.get("/es/portal");
    expect(authenticated.status()).toBe(200);
    expect(authenticated.headers()["cache-control"]).not.toMatch(/public|s-maxage/);
    expect(authenticated.headers()["cache-control"]).toMatch(/no-store|private/);
    expect(authenticated.headers()["referrer-policy"]).toBe("same-origin");
    const [pending, paid] = [purchases(a).nth(0), purchases(a).nth(1)];
    // La más nueva primero: la que todavía no se cobró arriba.
    await expect(pending.getByRole("heading", { level: 3, name: "Plan de juego personalizado" })).toBeVisible();
    await expect(pending).toContainText(es.Portal.status.pending);
    await expect(pending).toContainText(es.Portal.purchases.unpaid);
    await expect(pending).toContainText("ARS 50.000");
    await expect(paid.getByRole("heading", { level: 3, name: "VOD review grabado" })).toBeVisible();
    await expect(paid).toContainText(es.Portal.status.paid);
    await expect(paid).toContainText("Cobro: 5 oct 2026");
    await expect(paid).toContainText("USD 30");

    // El video: embebido con youtube-nocookie.com, con lo que YouTube pide, y un link para abrirlo en YouTube.
    const player = paid.locator("iframe");
    await expect(player).toHaveCount(1);
    await expect(player).toHaveAttribute("src", `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`);
    await expect(player).toHaveAttribute("title", "Review de tu partida");
    await expect(player).toHaveAttribute("loading", "lazy");
    await expect(player).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    await expect(player).toHaveAttribute("allowfullscreen", "");
    await expect(player).toHaveAttribute("allow", /encrypted-media/);
    await expect(player).toHaveAttribute("allow", /picture-in-picture/);
    const ratio = await player.evaluate((frame) => frame.getBoundingClientRect().width / frame.getBoundingClientRect().height);
    expect(ratio).toBeCloseTo(16 / 9, 1);
    const watch = paid.getByRole("link", { name: new RegExp(`^${es.Portal.deliveries.openYoutube}`) });
    await expect(watch).toHaveAttribute("href", `https://www.youtube.com/watch?v=${VIDEO_ID}`);
    await expect(watch).toHaveAttribute("target", "_blank");
    await expect(watch).toHaveAttribute("rel", /noopener/);
    await expect(watch).toHaveAttribute("rel", /noreferrer/);
    await expect(watch).toHaveAccessibleName("Abrir en YouTube (se abre en una pestaña nueva)");

    // El link: con el dominio a la vista, en otra pestaña y sin opener ni referer.
    const drive = paid.getByRole("listitem").filter({ hasText: "Guía en Drive" });
    const open = drive.getByRole("link", { name: new RegExp(`^${es.Portal.deliveries.openLink}`) });
    await expect(open).toHaveAttribute("href", DRIVE);
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(open).toHaveAttribute("rel", /noopener/);
    await expect(open).toHaveAttribute("rel", /noreferrer/);
    await expect(drive).toContainText("drive.google.com");
    // El nombre accesible del link: la acción, el dominio (con un espacio entre los dos) y el aviso de la pestaña nueva.
    await expect(open).toHaveAccessibleName("Abrir drive.google.com (se abre en una pestaña nueva)");
    await expect(drive).not.toContainText("usp=sharing");

    // El PDF: un botón que lo abre desde la ruta del portal, solo para su dueña.
    await expect(pending.getByRole("listitem").filter({ hasText: "Plan de juego de Ana" })).toContainText("Subida el");
    const view = pending.getByRole("link", { name: new RegExp(`^${es.Portal.deliveries.viewPdf}`) });
    await expect(view).toHaveAccessibleName("Ver PDF (se abre en una pestaña nueva)");
    await expect(view).toHaveAttribute("target", "_blank");
    await expect(view).toHaveAttribute("rel", /noreferrer/);
    const pdfHref = (await view.getAttribute("href")) ?? "";
    expect(pdfHref).toMatch(/^\/api\/portal\/files\/[0-9a-f-]{36}$/);
    const served = await a.request.get(pdfHref);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toBe("application/pdf");
    expect((await served.body()).equals(secret.buffer)).toBe(true);

    // Nada del panel en la página: ni notas, ni factura, ni medio de pago, ni pesos calculados, ni cotización.
    const text = await a.locator("main").innerText();
    expect(text).not.toMatch(/Transferencia|factur|cotizaci|BCRA|Notas|Mercado Pago|dólares/i);

    // --- Ana, con el teclado: Salir y cada acción de las entregas se alcanzan en orden, con su aro de foco a la vista ---
    await a.goto("/es/portal");
    await expect(purchases(a)).toHaveCount(2);
    const walk = await tabThrough(a, es.Footer.portal);
    expectInOrder(
      walk.map((stop) => stop.name),
      [
        es.Common.skipLink,
        "Tallami.",
        "ES",
        "PT",
        "EN",
        es.Portal.account.signOut,
        es.Portal.deliveries.viewPdf, // la compra pendiente va primero: su PDF
        "Review de tu partida", // el marco del video (su `title`)
        es.Portal.deliveries.openYoutube,
        `${es.Portal.deliveries.openLink} drive.google.com`,
        "X",
      ],
    );
    expectVisibleFocus(walk);

    // --- Ana, en portugués y en inglés: la misma sesión, los textos traducidos ---
    for (const { locale, messages, day, pesos } of [
      { locale: "pt", messages: pt, day: "5 de out. de 2026", pesos: "ARS 50.000" },
      { locale: "en", messages: en, day: "Oct 5, 2026", pesos: "ARS 50,000" },
    ] as const) {
      await a.goto(`/${locale}/portal`);
      await expect(a.getByRole("heading", { level: 1, name: messages.Portal.title })).toBeVisible();
      await expect(a.getByRole("heading", { level: 2, name: messages.Portal.purchases.title })).toBeVisible();
      await expect(a.getByRole("heading", { level: 3, name: messages.Portal.items.gamePlan })).toBeVisible();
      await expect(a.getByRole("heading", { level: 3, name: messages.Portal.items.vodRecorded })).toBeVisible();
      await expect(purchases(a).nth(0)).toContainText(messages.Portal.status.pending);
      await expect(purchases(a).nth(0)).toContainText(messages.Portal.purchases.unpaid);
      await expect(purchases(a).nth(0)).toContainText(pesos);
      await expect(purchases(a).nth(1)).toContainText(messages.Portal.status.paid);
      await expect(purchases(a).nth(1)).toContainText(day);
      await expect(a.getByRole("link", { name: new RegExp(`^${messages.Portal.deliveries.openYoutube}`) })).toBeVisible();
      await expect(a.getByRole("link", { name: new RegExp(`^${messages.Portal.deliveries.viewPdf}`) })).toBeVisible();
      await expect(a.getByRole("button", { name: messages.Portal.account.signOut })).toBeVisible();
      await expect(a.getByText(es.Portal.purchases.title, { exact: true })).toHaveCount(0);
      await expect(a.locator("iframe")).toHaveAttribute("title", "Review de tu partida");
    }

    // --- Beto: lo suyo y nada de Ana ---
    await b.goto("/es/portal");
    await expect(purchases(b)).toHaveCount(1);
    await expect(purchases(b)).toContainText(es.Portal.deliveries.empty);
    await expect(b.locator("iframe")).toHaveCount(0);
    const betoText = await b.locator("body").innerText();
    for (const secretText of [ana, "Review de tu partida", "Guía en Drive", "Plan de juego de Ana", "drive.google.com", "ARS 50.000"]) {
      expect(betoText).not.toContain(secretText);
    }
    // Con su sesión de verdad, abrir el PDF de Ana cambiando la dirección da 404 sin cuerpo, igual que un id que no existe.
    const stolen = await b.request.get(pdfHref);
    const missing = await b.request.get("/api/portal/files/00000000-0000-4000-8000-000000000000");
    expect(stolen.status()).toBe(404);
    expect((await stolen.body()).length).toBe(0);
    expect(missing.status()).toBe(404);

    await anaBrowser.context.close();
    await beto.browser.context.close();
  });

  test("looks right and has no accessibility problems on a phone and on a desktop, in every language", async ({ page, browser }) => {
    test.setTimeout(180_000);
    await loginAsAdmin(page);
    const name = uniqueName("Alumna accesible");
    await createSale(page, { student: name, item: "tournament", currency: "BRL", amount: "750", status: "delivered", paidOn: "2026-10-01" });
    await createSaleForExisting(page, { student: name, item: "lesson", currency: "USD", amount: "40", status: "cancelled", paidOn: "" });
    await openSale(page, name, "Coaching de torneo");
    await addDelivery(page, {
      kind: "youtube",
      title: "Un título bastante largo para ver cómo se corta en una pantalla chica de teléfono sin que se rompa nada",
      url: YOUTUBE,
    });
    await addDelivery(page, { kind: "link", title: "Guía", url: "https://un-dominio-muy-largo-para-probar-el-corte.ejemplo.com/ruta/larga" });
    await addDelivery(page, { kind: "pdf", title: "Plan", file: pdfFile("plan.pdf") });
    const token = await inviteStudent(page, name);
    const student = await newStudentBrowser(browser);
    await stubYoutube(student.context);
    await signIn(student.page, { invitation: token });
    const s = student.page;

    for (const { locale } of LOCALES) {
      for (const [label, size] of [
        ["celular", PHONE],
        ["escritorio", DESKTOP],
      ] as const) {
        await s.setViewportSize(size);
        await s.goto(`/${locale}/portal`);
        await expect(purchases(s)).toHaveCount(2);
        await s.locator("iframe").scrollIntoViewIfNeeded();
        await audit(s, `${locale}, ${label}`);
      }
    }
    // Las canceladas y las entregadas se marcan, y la pendiente de pago de una cancelada no se anuncia como pendiente.
    await s.goto("/es/portal");
    await expect(purchases(s).filter({ hasText: es.Portal.status.cancelled })).toHaveCount(1);
    await expect(purchases(s).filter({ hasText: es.Portal.status.delivered })).toHaveCount(1);
    await expect(purchases(s).filter({ hasText: es.Portal.purchases.unpaid })).toHaveCount(0);
    await expect(purchases(s).filter({ hasText: es.Portal.status.cancelled })).toContainText(es.Portal.deliveries.empty);
    await student.context.close();
  });
});

test.describe("the link to the portal", () => {
  for (const { locale, messages } of LOCALES) {
    test(`the footer of /${locale} has a discreet link that opens the portal in the same language`, async ({ page }) => {
      await page.goto(`/${locale}`);

      const link = page.getByRole("contentinfo").getByRole("link", { name: messages.Footer.portal });
      await expect(link).toHaveAttribute("href", `/${locale}/portal`);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/${locale}/portal$`));
      await expect(page.getByRole("heading", { level: 1, name: messages.Portal.title })).toBeVisible();
    });
  }
});
