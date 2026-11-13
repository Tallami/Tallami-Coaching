import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { MESSAGES_REFRESH_MS, MESSAGE_MAX_LENGTH } from "../../src/chat/policy";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { PHONE, uniqueName } from "../helpers/admin-ui";
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
import {
  MOCK_MERCADOPAGO_URL,
  SERVICE_CASES,
  choosePayment,
  emailsOf,
  ensureSharedRate,
  studentName,
  tickAndPay,
} from "../helpers/checkout-e2e";
import { createStudent, inviteStudent } from "../helpers/portal-admin-ui";
import { newStudentBrowser, signIn, uniqueProviderStudent } from "../helpers/portal-e2e";
import es from "../../messages/es.json" with { type: "json" };

// La sección Mensajes del panel, de punta a punta y con los dos lados: cada test da de alta su propio
// alumno, lo invita y entra con su cuenta del proveedor de prueba en un navegador propio. El servidor es
// compartido y los tests corren en paralelo: del número del menú solo se afirma que es al menos 1, y
// después de navegar con un enlace se mira solo dentro de `main` (Next deja oculta la página anterior).

const PANEL_COPY = { label: "Tu respuesta", submit: "Enviar" } as const;
const MESSAGES_PATH = "/es/portal/mensajes";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const DESKTOP = { width: 1440, height: 900 } as const;
const SCRIPT = "<script>alert(1)</script>";
const [, , LIVE] = SERVICE_CASES;

function main(page: Page) {
  return page.getByRole("main");
}

/** El enlace Mensajes del menú del panel, con su número si lo tiene. */
function menuLink(page: Page) {
  return page.getByRole("navigation", { name: "Secciones del panel" }).getByRole("link", { name: /^Mensajes/ });
}

/** La fila de la bandeja de ese alumno. */
function inboxRow(page: Page, name: string) {
  return main(page).getByTestId("inbox-row").filter({ hasText: name });
}

/** El id del alumno `name`, leído de su ficha. */
async function studentIdOf(admin: Page, name: string): Promise<string> {
  await admin.goto(`/admin/alumnos?q=${encodeURIComponent(name)}`);
  await main(admin).getByRole("link", { name }).first().click();
  await expect(admin).toHaveURL(/\/admin\/alumnos\/[0-9a-f-]{36}/);
  return new URL(admin.url()).pathname.split("/").at(-1) ?? "";
}

async function openConversation(admin: Page, customerId: string): Promise<void> {
  await admin.goto(`/admin/mensajes/${customerId}`);
  await expect(main(admin).getByRole("heading", { level: 1 })).toBeVisible();
}

async function writeInPanel(admin: Page, text: string): Promise<void> {
  await writeAndSend(admin, text, PANEL_COPY);
}

async function studentWrites(student: ChatStudent, text: string): Promise<void> {
  await student.page.goto(MESSAGES_PATH);
  await whenComposeReady(student.page);
  await writeAndSend(student.page, text);
}

/** Los avisos que le llegaron a Tallami por este alumno (el servidor falso de Resend guarda todo; el asunto lleva el nombre). */
async function noticesToTallami(request: APIRequestContext, name: string): Promise<{ subject: string; text: string }[]> {
  const response = await request.get(`${MOCK_MERCADOPAGO_URL}/test/emails`);
  const emails = (await response.json()) as { subject: string; text: string }[];
  return emails.filter(({ subject }) => subject.includes(name));
}

/** Un navegador con el panel abierto, que se cierra solo. */
async function withPanel(browser: Browser, body: (admin: Page) => Promise<void>): Promise<void> {
  const panel = await newStudentBrowser(browser);
  try {
    await loginAsAdmin(panel.page);
    await body(panel.page);
  } finally {
    await panel.context.close();
  }
}

test.describe("the conversation in both directions", () => {
  test("the student writes, Tallami sees it unread, opens it, answers, and the student reads the answer", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna del vaivén");
    await studentWrites(student, "Hola Tallami, ¿cuándo jugamos?");

    await page.goto("/admin/mensajes");
    await expect(menuLink(page)).toContainText(/[1-9]\d* sin leer/);
    const row = inboxRow(page, student.name);
    await expect(row).toContainText("Hola Tallami");
    await expect(row).toContainText("sin leer");
    await expect(row).toHaveAttribute("data-unread", "true");

    await row.getByRole("link").first().click();
    await expect(main(page).getByRole("heading", { level: 1, name: student.name })).toBeVisible();
    await expect(chatMessages(page)).toHaveCount(1);
    await expect(chatMessages(page).first()).toContainText("Hola Tallami, ¿cuándo jugamos?");

    // Abrirla la marca como leída: de vuelta en la bandeja, la fila ya no está sin leer.
    await expect(async () => {
      await page.goto("/admin/mensajes");
      await expect(inboxRow(page, student.name)).toBeVisible();
      await expect(inboxRow(page, student.name)).not.toContainText("sin leer");
      await expect(inboxRow(page, student.name)).toHaveAttribute("data-unread", "false");
    }).toPass({ timeout: 20_000 });

    await inboxRow(page, student.name).getByRole("link").first().click();
    await whenComposeReady(page);
    await writeInPanel(page, "Mañana a las 18 nos vemos en Discord");
    await expect(chatMessages(page).last()).toContainText(es.Chat.thread.own);

    const s = student.page;
    await s.goto("/es/portal");
    const card = s.getByRole("region", { name: es.Chat.card.title });
    await expect(card).toContainText("1 mensaje sin leer");
    await card.getByRole("link", { name: es.Chat.card.open }).click();
    await expect(chatMessages(s).filter({ hasText: "Mañana a las 18 nos vemos en Discord" })).toBeVisible();
    await expect(chatMessages(s).last()).toContainText(es.Chat.thread.other);
    await expect(async () => {
      await s.goto("/es/portal");
      await expect(s.getByRole("region", { name: es.Chat.card.title })).toContainText("Sin mensajes nuevos");
    }).toPass({ timeout: 20_000 });
    await student.context.close();
  });

  test("Tallami writes first, from the Mensajes button of the student's page, and the student sees it", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumno que espera");
    const id = await studentIdOf(page, student.name);

    await page.goto(`/admin/alumnos/${id}`);
    await main(page).getByRole("link", { name: "Mensajes" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/mensajes/${id}$`));
    await expect(main(page).getByText("Todavía no hay mensajes")).toBeVisible();
    await writeInPanel(page, "Hola, soy Tallami. Mi Discord es tallami");

    const s = student.page;
    await s.goto(MESSAGES_PATH);
    await expect(chatMessages(s).filter({ hasText: "Mi Discord es tallami" })).toBeVisible();
    await expect(chatMessages(s).first()).toContainText(es.Chat.thread.other);
    await student.context.close();
  });

  test("the panel page refreshes by itself and shows what the student wrote after", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna que insiste");
    const id = await studentIdOf(page, student.name);
    await page.clock.install();
    await openConversation(page, id);
    await whenComposeReady(page);
    await composeBox(page, PANEL_COPY).fill("lo que estoy escribiendo");

    await studentWrites(student, "me llegó recién");

    const arrived = chatMessages(page).filter({ hasText: "me llegó recién" });
    await expect(async () => {
      await page.clock.fastForward(MESSAGES_REFRESH_MS);
      await expect(arrived).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(composeBox(page, PANEL_COPY)).toHaveValue("lo que estoy escribiendo");
    await student.context.close();
  });
});

test.describe("the emails", () => {
  test("two messages in a row from the student send one email to Tallami, and two answers send one to the student; none carries the text", async ({
    page,
    browser,
    request,
  }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna de los avisos");
    const id = await studentIdOf(page, student.name);

    await studentWrites(student, "primer mensaje secreto uno");
    await writeAndSend(student.page, "segundo mensaje secreto dos");
    await expect.poll(async () => (await noticesToTallami(request, student.name)).length).toBe(1);
    const [toTallami] = await noticesToTallami(request, student.name);
    expect(toTallami.text).toContain(student.name);
    expect(toTallami.text).toContain(`/admin/mensajes/${id}`);
    expect(`${toTallami.subject}\n${toTallami.text}`).not.toMatch(/secreto/);

    await openConversation(page, id);
    await writeInPanel(page, "respuesta reservada uno");
    await writeInPanel(page, "respuesta reservada dos");
    await expect.poll(async () => (await emailsOf(request, student.providerStudent)).length).toBe(1);
    const [toStudent] = await emailsOf(request, student.providerStudent);
    expect(`${toStudent.subject}\n${toStudent.text}`).not.toMatch(/reservada/);
    expect(toStudent.text).toContain("/es/portal/mensajes");

    // Tras haber escrito los dos, ninguno mandó un segundo aviso.
    expect(await noticesToTallami(request, student.name)).toHaveLength(1);
    expect(await emailsOf(request, student.providerStudent)).toHaveLength(1);
    await student.context.close();
  });
});

test.describe("a student that cannot receive messages", () => {
  test("a student added by hand without an account: the conversation says so, leads to invite them and has no form", async ({ page }) => {
    await loginAsAdmin(page);
    const name = uniqueName("Alumno sin cuenta");
    const path = await createStudent(page, name);
    const id = path.split("/").at(-1) ?? "";

    await page.goto(path);
    await main(page).getByRole("link", { name: "Mensajes" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/mensajes/${id}$`));
    await expect(main(page).getByText(/no puede recibir mensajes/)).toBeVisible();
    await expect(main(page).getByRole("link", { name: /Invitarlo desde su ficha/ })).toHaveAttribute("href", `/admin/alumnos/${id}`);
    await expect(composeBox(page, PANEL_COPY)).toHaveCount(0);
    await expect(sendButton(page, PANEL_COPY)).toHaveCount(0);
  });

  test("the student lost the account while Tallami was writing: nothing is saved, it says what to do and the text stays", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna que se desvincula");
    const id = await studentIdOf(page, student.name);
    await openConversation(page, id);
    await whenComposeReady(page);
    await composeBox(page, PANEL_COPY).fill("esto nadie lo va a leer");

    // Mientras tanto, en otra pestaña del panel, se desvincula la cuenta.
    const other = await page.context().newPage();
    await other.goto(`/admin/alumnos/${id}`);
    const portal = other.getByRole("region", { name: "Portal del alumno" });
    await portal.getByRole("button", { name: "Desvincular" }).click();
    await portal.getByRole("button", { name: "Sí, desvincular" }).click();
    await expect(portal.getByRole("button", { name: "Invitar al portal" })).toBeVisible();
    await other.close();

    await sendButton(page, PANEL_COPY).click();

    const alert = main(page).getByRole("alert");
    await expect(alert).toContainText("no tiene una cuenta del portal");
    await expect(alert).toContainText("Invitalo");
    await expect(composeBox(page, PANEL_COPY)).toHaveValue("esto nadie lo va a leer");
    await page.reload();
    await expect(chatMessages(page)).toHaveCount(0);
    await expect(main(page).getByText(/no puede recibir mensajes/)).toBeVisible();
    await student.context.close();
  });
});

test.describe("the text Tallami was writing", () => {
  test("survives the refresh that removes the form when the account is unlinked, and is back when the student is linked again", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna que se va y vuelve");
    const id = await studentIdOf(page, student.name);
    await page.clock.install();
    await openConversation(page, id);
    await whenComposeReady(page);
    await composeBox(page, PANEL_COPY).click();
    await composeBox(page, PANEL_COPY).pressSequentially("te escribo cuando vuelvas");

    // En otra pestaña del panel se desvincula la cuenta; el refresco de esta saca el formulario.
    const other = await page.context().newPage();
    await other.goto(`/admin/alumnos/${id}`);
    const portal = other.getByRole("region", { name: "Portal del alumno" });
    await portal.getByRole("button", { name: "Desvincular" }).click();
    await portal.getByRole("button", { name: "Sí, desvincular" }).click();
    await expect(portal.getByRole("button", { name: "Invitar al portal" })).toBeVisible();

    await expect(async () => {
      await page.clock.fastForward(MESSAGES_REFRESH_MS);
      await expect(main(page).getByText(/no puede recibir mensajes/)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(composeBox(page, PANEL_COPY)).toHaveCount(0);

    // Se lo vuelve a invitar y entra con la invitación: la cuenta queda vinculada otra vez.
    const token = await inviteStudent(other, student.name);
    await other.close();
    const back = await newStudentBrowser(browser);
    await signIn(back.page, { invitation: token, student: uniqueProviderStudent() });
    await back.context.close();

    await page.reload();
    await whenComposeReady(page);
    await expect(composeBox(page, PANEL_COPY)).toHaveValue("te escribo cuando vuelvas");
    await expect(chatMessages(page)).toHaveCount(0);
    await student.context.close();
  });
});

test.describe("what the inbox and the conversation show", () => {
  test("HTML from the student is text in the inbox and in the conversation, and opens no dialog", async ({ page, browser }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumno del script");
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    const id = await studentIdOf(page, student.name);
    await studentWrites(student, `${SCRIPT}<img src=x onerror=alert(2)>`);

    await page.goto("/admin/mensajes");
    await expect(inboxRow(page, student.name)).toContainText(SCRIPT);
    await expect(inboxRow(page, student.name).locator("script, img")).toHaveCount(0);
    await openConversation(page, id);
    await expect(chatMessages(page).first()).toContainText(`${SCRIPT}<img src=x onerror=alert(2)>`);
    await expect(chatLog(page).locator("script, img")).toHaveCount(0);
    expect(dialogs).toEqual([]);
    await student.context.close();
  });

  test("deleting the conversation asks first, empties the inbox row, and the student's open page ends up empty without errors", async ({
    page,
    browser,
  }) => {
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna que se borra");
    const id = await studentIdOf(page, student.name);
    const s = student.page;
    await s.clock.install();
    await studentWrites(student, "esto se va a borrar");
    await openConversation(page, id);

    const conversationButtons = main(page);
    await conversationButtons.getByRole("button", { name: /^Borrar la conversación/ }).click();
    await expect(conversationButtons.getByText(/no se puede deshacer/)).toBeVisible();
    await conversationButtons.getByRole("button", { name: "No, conservarla" }).click();
    await expect(chatMessages(page)).toHaveCount(1);

    await conversationButtons.getByRole("button", { name: /^Borrar la conversación/ }).click();
    await conversationButtons.getByRole("button", { name: "Sí, borrarla" }).click();
    await expect(page).toHaveURL(/\/admin\/mensajes\?borrada=1$/);
    await expect(main(page).getByText("Conversación borrada.")).toBeVisible();
    await expect(inboxRow(page, student.name)).toHaveCount(0);

    await expect(async () => {
      await s.clock.fastForward(MESSAGES_REFRESH_MS);
      await expect(main(s).getByText(es.Chat.thread.empty)).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(chatLog(s)).toHaveCount(0);
    await expect(main(s).getByRole("alert")).toHaveCount(0);
    await student.context.close();
  });

  test("the empty inbox invites to write from a student's page", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/mensajes");
    await expect(main(page).getByRole("heading", { level: 1, name: "Mensajes" })).toBeVisible();
    // El servidor es compartido: otras conversaciones pueden existir. Si no hay, el estado vacío dice qué hacer.
    const rows = await main(page).getByTestId("inbox-row").count();
    if (rows === 0) {
      await expect(main(page).getByText("Todavía no hay conversaciones. Podés escribirle a un alumno desde su ficha.")).toBeVisible();
    }
  });

  test("an id that is not a student says so, and without the panel session both pages go to the login", async ({ page, browser }) => {
    await loginAsAdmin(page);
    for (const id of ["00000000-0000-0000-0000-000000000000", "no-es-un-id"]) {
      await page.goto(`/admin/mensajes/${id}`);
      await expect(main(page).getByText("No encontramos a ese alumno")).toBeVisible();
    }

    const visitor = await newStudentBrowser(browser);
    for (const path of ["/admin/mensajes", "/admin/mensajes/00000000-0000-0000-0000-000000000000"]) {
      await visitor.page.goto(path);
      await expect(visitor.page).toHaveURL(/\/admin\/login/);
    }
    await visitor.context.close();
  });

  test("the inbox and the conversation have no serious accessibility problems and do not scroll sideways on a phone", async ({ page, browser }) => {
    test.setTimeout(180_000);
    await loginAsAdmin(page);
    const student = await linkedChatStudent(page, browser, "Alumna accesible del panel");
    const id = await studentIdOf(page, student.name);
    await studentWrites(student, "x".repeat(MESSAGE_MAX_LENGTH));
    await studentWrites(student, "Un mensaje normal.\nCon dos líneas.");

    for (const [label, size] of [
      ["celular", PHONE],
      ["escritorio", DESKTOP],
    ] as const) {
      await page.setViewportSize(size);
      for (const path of ["/admin/mensajes", `/admin/mensajes/${id}`]) {
        const where = `${label} ${path}`;
        await page.goto(path);
        await expect(main(page).getByRole("heading", { level: 1 }), where).toBeVisible();
        if (path.endsWith(id)) await whenComposeReady(page);
        const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
        const serious = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
        expect(serious.map(({ id: rule, nodes }) => ({ where, rule, targets: nodes.map((node) => node.target) })), where).toEqual([]);
        const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
        expect(widths.scroll, where).toBeLessThanOrEqual(widths.client);
        if (path.endsWith(id)) {
          await expect(sendButton(page, PANEL_COPY), where).toBeInViewport();
          await expect(composeBox(page, PANEL_COPY), where).toBeInViewport();
        }
      }
    }
    await student.context.close();
  });
});

test.describe("from 'Por coordinar'", () => {
  test.beforeEach(async ({ browser }) => {
    await ensureSharedRate(browser);
  });

  test("a live VOD review just paid shows 'Escribirle', which leads to the conversation with that student", async ({ page, browser }) => {
    const student = uniqueProviderStudent();
    await signIn(page, { student });
    await page.goto(`/es/comprar/${LIVE.slug}`);
    await tickAndPay(page);
    await choosePayment(page, "Aprobar");
    await expect(page).toHaveURL(/\/es\/portal\?compra=/);

    await withPanel(browser, async (admin) => {
      await admin.goto("/admin");
      const block = admin.getByTestId("pending-coordinate");
      // Las filas de más de cinco están detrás de un "Ver las N restantes": se abren todas.
      await block.locator("details").evaluateAll((all) => all.forEach((details) => ((details as HTMLDetailsElement).open = true)));
      const row = block.getByRole("listitem").filter({ hasText: studentName(student) });
      await row.getByRole("link", { name: /^Escribirle/ }).click();
      await expect(admin).toHaveURL(/\/admin\/mensajes\/[0-9a-f-]{36}$/);
      await expect(main(admin).getByRole("heading", { level: 1, name: studentName(student) })).toBeVisible();
      await expect(composeBox(admin, PANEL_COPY)).toBeVisible();
    });
  });
});
