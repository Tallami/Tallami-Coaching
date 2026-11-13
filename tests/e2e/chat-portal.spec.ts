import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { MESSAGES_REFRESH_MS, MESSAGE_MAX_LENGTH } from "../../src/chat/policy";
import { expect, loginAsAdmin, test, uniqueTestIp } from "../helpers/admin";
import { PHONE } from "../helpers/admin-ui";
import {
  chatLog,
  chatMessages,
  composeBox,
  linkedChatStudent,
  sendButton,
  whenComposeReady,
  writeAndSend,
  type ChatStudent,
} from "../helpers/chat-e2e";
import { STUDENT_COOKIE, newStudentBrowser, signIn } from "../helpers/portal-e2e";
import en from "../../messages/en.json" with { type: "json" };
import es from "../../messages/es.json" with { type: "json" };
import pt from "../../messages/pt.json" with { type: "json" };

// Los mensajes del alumno con Tallami en su portal (`/[locale]/portal/mensajes`), de punta a punta:
// cada test da de alta su propio alumno en el panel, lo invita y entra con su cuenta del proveedor de
// prueba en un navegador propio. Tallami todavía no contesta desde acá (eso es del panel): lo que se
// prueba es lo que escribe y lee el alumno.

const DESKTOP = { width: 1440, height: 900 } as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const MESSAGES_PATH = "/es/portal/mensajes";

/** Los avisos del formulario (el anunciador de rutas de Next también es un `alert`, pero está fuera de `main`). */
function alerts(page: Page) {
  return page.getByRole("main").getByRole("alert");
}

async function openMessages(page: Page, path = MESSAGES_PATH): Promise<void> {
  await page.goto(path);
  await whenComposeReady(page);
}

/** Otro navegador con la misma cuenta del alumno: entra de nuevo con el mismo alumno del proveedor de prueba. */
async function sameStudentElsewhere(student: ChatStudent, browser: Parameters<typeof newStudentBrowser>[0]) {
  const other = await newStudentBrowser(browser);
  await signIn(other.page, { student: student.providerStudent });
  return other;
}

test.describe("the messages of a linked student", () => {
  test("the portal shows the card above the purchases with its link, and the empty page invites to write", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna de la tarjeta");
    const s = student.page;

    const card = s.getByRole("region", { name: es.Chat.card.title });
    await expect(card).toBeVisible();
    await expect(card).toContainText(es.Chat.card.body);
    await expect(card).toContainText("Sin mensajes nuevos");
    const link = card.getByRole("link", { name: es.Chat.card.open });
    await expect(link).toHaveAttribute("href", MESSAGES_PATH);
    const purchasesTitle = s.getByRole("heading", { level: 2, name: es.Portal.purchases.title });
    const [cardBox, purchasesBox] = [await card.boundingBox(), await purchasesTitle.boundingBox()];
    expect(cardBox?.y ?? Infinity).toBeLessThan(purchasesBox?.y ?? 0);

    await link.click();
    await expect(s).toHaveURL(new RegExp(`${MESSAGES_PATH}$`));
    const main = s.getByRole("main");
    await expect(main.getByRole("heading", { level: 1, name: es.Chat.title })).toBeVisible();
    await expect(main.getByText(es.Chat.thread.empty)).toBeVisible();
    await expect(composeBox(s)).toBeVisible();
    await expect(main.getByRole("link", { name: es.Chat.backToPortal })).toHaveAttribute("href", "/es/portal");
    await student.context.close();
  });

  test("a message sent appears, the box is left empty and focused, and it is still there after reloading", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumno que saluda");
    const s = student.page;
    await openMessages(s);

    await composeBox(s).fill("hola");
    await sendButton(s).click();

    await expect(chatMessages(s)).toHaveCount(1);
    await expect(chatMessages(s).first()).toContainText("hola");
    await expect(chatMessages(s).first()).toContainText(es.Chat.thread.own);
    await expect(composeBox(s)).toHaveValue("");
    await expect(composeBox(s)).toBeFocused();
    // Enter es un salto de línea; Ctrl + Enter también envía.
    await composeBox(s).press("Enter");
    await expect(chatMessages(s)).toHaveCount(1);
    await composeBox(s).pressSequentially("con el teclado");
    await composeBox(s).press("Control+Enter");
    await expect(chatMessages(s)).toHaveCount(2);
    await expect(chatMessages(s).last()).toContainText("con el teclado");
    await expect(composeBox(s)).toHaveValue("");
    await s.reload();
    await expect(chatMessages(s)).toHaveCount(2);
    await expect(chatMessages(s).first()).toContainText("hola");
    // La hora del mensaje, en un `time` con el instante exacto.
    await expect(chatMessages(s).first().locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
    await student.context.close();
  });

  test("the refresh of the page does not erase what is being typed nor take the focus away", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna que escribe");
    const s = student.page;
    // El reloj de la página se maneja desde el test: el refresco de cada 20 segundos se adelanta en vez de esperarlo.
    await s.clock.install();
    await openMessages(s);
    await composeBox(s).click();
    await composeBox(s).pressSequentially("todavía no lo mando");

    // El mismo alumno manda otro mensaje desde otro navegador.
    const other = await sameStudentElsewhere(student, browser);
    await openMessages(other.page);
    await writeAndSend(other.page, "desde el celular");

    const arrived = chatMessages(s).filter({ hasText: "desde el celular" });
    await expect(async () => {
      await s.clock.fastForward(MESSAGES_REFRESH_MS);
      await expect(arrived).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(composeBox(s)).toHaveValue("todavía no lo mando");
    await expect(composeBox(s)).toBeFocused();
    await other.context.close();
    await student.context.close();
  });

  test("a double click on Enviar leaves a single message", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumno del doble clic");
    const s = student.page;
    await openMessages(s);

    await composeBox(s).fill("una sola vez");
    await sendButton(s).dblclick();

    await expect(chatMessages(s).filter({ hasText: "una sola vez" })).toHaveCount(1);
    await s.reload();
    await expect(chatMessages(s).filter({ hasText: "una sola vez" })).toHaveCount(1);
    await student.context.close();
  });

  test("two submits of the same text that both reach the server leave a single message", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna de los dos envíos");
    const s = student.page;
    await openMessages(s);
    const posts: string[] = [];
    s.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === MESSAGES_PATH) posts.push(request.url());
    });

    await composeBox(s).fill("dos veces el mismo");
    // Los dos en la misma tarea: React todavía no volvió a dibujar, así que el segundo lleva el mismo texto
    // y no hay botón deshabilitado que lo frene. Los dos pedidos salen al servidor.
    await s.getByRole("main").locator("form").evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });

    await expect.poll(() => posts.length).toBe(2);
    await expect(composeBox(s)).toHaveValue("");
    await s.reload();
    await expect(chatMessages(s).filter({ hasText: "dos veces el mismo" })).toHaveCount(1);
    await student.context.close();
  });

  test("without JavaScript, the same form sent again within the 10 seconds (Back and resubmit at once) leaves a single message", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumno que vuelve atrás");
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      javaScriptEnabled: false,
      storageState: await student.context.storageState(),
      extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() },
    });
    const s = await context.newPage();
    await s.goto(MESSAGES_PATH);
    await composeBox(s).fill("lo mando de nuevo");

    const [submitted] = await Promise.all([
      s.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === MESSAGES_PATH),
      sendButton(s).click(),
    ]);
    await expect(chatMessages(s).filter({ hasText: "lo mando de nuevo" })).toHaveCount(1);
    // Volver atrás y reenviar manda otra vez el mismo pedido, con la misma sesión: se repite tal cual.
    const again = await s.request.fetch(submitted);
    expect(again.status()).toBe(200);

    await s.goto(MESSAGES_PATH);
    await expect(chatMessages(s).filter({ hasText: "lo mando de nuevo" })).toHaveCount(1);
    await context.close();
    await student.context.close();
  });

  test("with the session gone and the page open, sending asks to sign in again, keeps the text and saves nothing", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna sin sesión");
    const s = student.page;
    await openMessages(s);

    await composeBox(s).fill("se me venció la sesión");
    await student.context.clearCookies({ name: STUDENT_COOKIE });
    await sendButton(s).click();

    await expect(alerts(s)).toContainText(es.Chat.compose.errors.signedOut);
    await expect(alerts(s).getByRole("link", { name: new RegExp(`^${es.Chat.compose.signIn}`) })).toHaveAttribute("href", "/es/portal");
    await expect(composeBox(s)).toHaveValue("se me venció la sesión");
    await expect(chatMessages(s)).toHaveCount(0);
    // El aviso de sesión cerrada, también sin problemas serios de accesibilidad.
    const results = await new AxeBuilder({ page: s }).withTags(WCAG_TAGS).analyze();
    const serious = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
    expect(serious.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);

    await signIn(s, { student: student.providerStudent });
    await openMessages(s);
    await expect(s.getByRole("main").getByText(es.Chat.thread.empty)).toBeVisible();
    await expect(chatMessages(s)).toHaveCount(0);
    // No se guardó nada, pero lo escrito vuelve al cuadro en esta pestaña.
    await expect(composeBox(s)).toHaveValue("se me venció la sesión");
    await student.context.close();
  });

  test("when the refresh finds the session gone and swaps the form for the sign-in, the text comes back after signing in again in the same tab", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna que vuelve a entrar");
    const s = student.page;
    await s.clock.install();
    await openMessages(s);
    await composeBox(s).click();
    await composeBox(s).pressSequentially("lo escribí antes de que se cerrara");

    await student.context.clearCookies({ name: STUDENT_COOKIE });
    const signInTitle = s.getByRole("main").getByRole("heading", { level: 2, name: es.Chat.signIn.title });
    await expect(async () => {
      await s.clock.fastForward(MESSAGES_REFRESH_MS);
      await expect(signInTitle).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(composeBox(s)).toHaveCount(0);

    await signIn(s, { student: student.providerStudent });
    await openMessages(s);
    await expect(composeBox(s)).toHaveValue("lo escribí antes de que se cerrara");
    await expect(chatMessages(s)).toHaveCount(0);
    await student.context.close();
  });

  test("a different student who signs in in that tab gets an empty box, and the draft is gone for good", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const ana = await linkedChatStudent(page, browser, "Ana del borrador");
    const beto = await linkedChatStudent(page, browser, "Beto del borrador");
    await beto.context.close();
    const s = ana.page;
    await s.clock.install();
    await openMessages(s);
    await composeBox(s).click();
    await composeBox(s).pressSequentially("esto es solo de Ana");

    await ana.context.clearCookies({ name: STUDENT_COOKIE });
    const signInTitle = s.getByRole("main").getByRole("heading", { level: 2, name: es.Chat.signIn.title });
    await expect(async () => {
      await s.clock.fastForward(MESSAGES_REFRESH_MS);
      await expect(signInTitle).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    await signIn(s, { student: beto.providerStudent });
    await openMessages(s);
    await expect(composeBox(s)).toHaveValue("");
    expect(await s.locator("body").innerText()).not.toContain("esto es solo de Ana");

    // El borrador se borró al verlo otro dueño: Ana tampoco lo recupera después.
    await signIn(s, { student: ana.providerStudent });
    await openMessages(s);
    await expect(composeBox(s)).toHaveValue("");
    await ana.context.close();
  });

  test("an empty message is not sent, and 2,001 characters are rejected also without the maxlength of the page", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumno de los bordes");
    const s = student.page;
    await openMessages(s);

    await expect(composeBox(s)).toHaveAttribute("maxlength", String(MESSAGE_MAX_LENGTH));
    await sendButton(s).click();
    await composeBox(s).fill("   ");
    await sendButton(s).click();
    await expect(alerts(s)).toContainText(es.Chat.compose.errors.invalid.replace("{max}", "2000"));

    await composeBox(s).evaluate((box) => box.removeAttribute("maxlength"));
    const tooLong = "b".repeat(MESSAGE_MAX_LENGTH + 1);
    await composeBox(s).fill(tooLong);
    await sendButton(s).click();
    await expect(alerts(s)).toContainText(es.Chat.compose.errors.invalid.replace("{max}", "2000"));
    await expect(composeBox(s)).toHaveValue(tooLong);

    await s.reload();
    await expect(s.getByRole("main").getByText(es.Chat.thread.empty)).toBeVisible();
    await expect(chatMessages(s)).toHaveCount(0);
    await student.context.close();
  });

  test("2,000 characters without spaces on a phone do not widen the page, and Enviar stays in sight", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna del texto largo");
    const s = student.page;
    await s.setViewportSize(PHONE);
    await openMessages(s);

    await writeAndSend(s, "x".repeat(MESSAGE_MAX_LENGTH));
    for (const label of ["recién enviado", "al recargar"]) {
      if (label === "al recargar") await openMessages(s);
      const widths = await s.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(widths.scroll, label).toBeLessThanOrEqual(widths.client);
      await expect(sendButton(s), label).toBeInViewport();
      await expect(composeBox(s), label).toBeInViewport();
    }
    await student.context.close();
  });

  test("a message with HTML is shown as text and runs nothing", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumno del script");
    const s = student.page;
    const dialogs: string[] = [];
    s.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await openMessages(s);

    await writeAndSend(s, "<script>alert(1)</script><img src=x onerror=alert(2)>");
    await s.reload();

    await expect(chatMessages(s).first()).toContainText("<script>alert(1)</script><img src=x onerror=alert(2)>");
    await expect(chatLog(s).locator("script, img")).toHaveCount(0);
    expect(dialogs).toEqual([]);
    await student.context.close();
  });

  test("without JavaScript, sending works and the message appears", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna sin JavaScript");
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      javaScriptEnabled: false,
      storageState: await student.context.storageState(),
      extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() },
    });
    const s = await context.newPage();
    await s.goto(MESSAGES_PATH);

    await composeBox(s).fill("sin JavaScript");
    await sendButton(s).click();

    await expect(chatMessages(s).filter({ hasText: "sin JavaScript" })).toHaveCount(1);
    await expect(composeBox(s)).toHaveValue("");
    await context.close();
    await student.context.close();
  });

  test("another student does not see these messages on their page", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const ana = await linkedChatStudent(page, browser, "Ana del chat");
    const beto = await linkedChatStudent(page, browser, "Beto del chat");
    await openMessages(ana.page);
    await writeAndSend(ana.page, "esto es solo de Ana");

    await openMessages(beto.page);
    await expect(beto.page.getByRole("main").getByText(es.Chat.thread.empty)).toBeVisible();
    expect(await beto.page.locator("body").innerText()).not.toContain("esto es solo de Ana");
    await ana.context.close();
    await beto.context.close();
  });

  test("the page is private, translated in /pt and /en, and has no serious accessibility problems on a phone and on a desktop", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna accesible del chat");
    const s = student.page;
    await openMessages(s);
    await writeAndSend(s, "Un mensaje para que la conversación no esté vacía.\nCon dos líneas.");

    const response = await s.request.get(MESSAGES_PATH);
    expect(response.headers()["referrer-policy"]).toBe("same-origin");
    expect(response.headers()["cache-control"]).toMatch(/no-store|private/);
    await expect(s.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
    await expect(s.locator("meta[name=referrer]")).toHaveAttribute("content", "same-origin");
    await expect(s).toHaveTitle(es.Chat.metaTitle);

    for (const { locale, messages } of [
      { locale: "es", messages: es },
      { locale: "pt", messages: pt },
      { locale: "en", messages: en },
    ] as const) {
      for (const [label, size] of [
        ["celular", PHONE],
        ["escritorio", DESKTOP],
      ] as const) {
        const where = `${locale}, ${label}`;
        await s.setViewportSize(size);
        await openMessages(s, `/${locale}/portal/mensajes`);
        const main = s.getByRole("main");
        await expect(main.getByRole("heading", { level: 1, name: messages.Chat.title }), where).toBeVisible();
        await expect(composeBox(s, messages.Chat.compose), where).toBeVisible();
        await expect(sendButton(s, messages.Chat.compose), where).toBeVisible();
        await expect(chatMessages(s).first(), where).toContainText(messages.Chat.thread.own);
        // Lo último queda a la vista al abrir la página.
        await expect(chatMessages(s).last(), where).toBeInViewport();
        const results = await new AxeBuilder({ page: s }).withTags(WCAG_TAGS).analyze();
        const serious = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
        expect(serious.map(({ id, nodes }) => ({ where, id, targets: nodes.map((node) => node.target) }))).toEqual([]);
        expect(await s.locator("body").innerText(), where).not.toMatch(/undefined|\[object|Chat\./);
      }
    }
    await student.context.close();
  });
});

test.describe("the messages page of someone who cannot write", () => {
  test("an account that is not linked has no card on the portal, and the messages page explains they come with the first purchase", async ({ browser }) => {
    const student = await newStudentBrowser(browser);
    await signIn(student.page, {});
    const s = student.page;
    await expect(s.getByText(es.Portal.unlinked.body)).toBeVisible();
    await expect(s.getByRole("region", { name: es.Chat.card.title })).toHaveCount(0);

    await s.goto(MESSAGES_PATH);
    const main = s.getByRole("main");
    await expect(main.getByText(es.Chat.unlinked.body)).toBeVisible();
    await expect(main.getByRole("link", { name: es.Chat.unlinked.services })).toHaveAttribute("href", "/es#services");
    await expect(composeBox(s)).toHaveCount(0);
    await student.context.close();
  });

  test("without a session, the messages page offers to sign in", async ({ page }) => {
    await page.goto(MESSAGES_PATH);

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 2, name: es.Chat.signIn.title })).toBeVisible();
    await expect(main.getByRole("link", { name: es.Portal.providers.test.button })).toHaveAttribute("href", "/api/portal/auth/test?locale=es");
    await expect(composeBox(page)).toHaveCount(0);
    await expect(chatLog(page)).toHaveCount(0);
  });
});
