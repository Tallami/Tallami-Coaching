// Ayudas de los e2e de los mensajes entre el alumno y Tallami: un alumno nuevo con su cuenta del
// portal ya vinculada, y dónde se lee y se escribe la conversación en una página (la del portal o la
// del panel). Las usan `chat-portal.spec.ts` y los e2e del panel.
//
// Cada alumno es nuevo y su cuenta del proveedor de prueba también (`uniqueProviderStudent`): los
// tests corren en paralelo sobre la misma base y ninguno ve la conversación de otro.

import type { Browser, BrowserContext, Locator, Page, Response } from "@playwright/test";
import { expect } from "./admin";
import { uniqueName } from "./admin-ui";
import { createStudent, inviteStudent } from "./portal-admin-ui";
import { newStudentBrowser, signIn, uniqueProviderStudent } from "./portal-e2e";
import es from "../../messages/es.json" with { type: "json" };

export interface ChatStudent {
  /** El nombre del alumno en el panel. */
  name: string;
  /** El alumno del proveedor de prueba: con él se vuelve a entrar a la misma cuenta. */
  providerStudent: string;
  context: BrowserContext;
  page: Page;
}

/**
 * Da de alta un alumno en el panel (con `admin`, que ya entró al panel), lo invita y entra con su
 * invitación en un navegador propio: queda con su cuenta del portal vinculada y en `/es/portal`.
 */
export async function linkedChatStudent(admin: Page, browser: Browser, prefix: string): Promise<ChatStudent> {
  const name = uniqueName(prefix);
  await createStudent(admin, name);
  const token = await inviteStudent(admin, name);
  const providerStudent = uniqueProviderStudent();
  const { context, page } = await newStudentBrowser(browser);
  const landed = await signIn(page, { invitation: token, student: providerStudent });
  expect(landed.search).toBe("?invitacion=vinculada");
  return { name, providerStudent, context, page };
}

/** La conversación de la página (un `log`, dentro de `main`: Next deja oculta la página anterior). */
export function chatLog(page: Page): Locator {
  return page.getByRole("main").getByRole("log");
}

/** Los mensajes de la conversación, del más viejo al más nuevo. */
export function chatMessages(page: Page): Locator {
  return chatLog(page).getByRole("listitem");
}

export interface ComposeCopy {
  label: string;
  submit: string;
}

/** El cuadro de texto del formulario de la página. */
export function composeBox(page: Page, copy: ComposeCopy = es.Chat.compose): Locator {
  return page.getByRole("main").getByRole("textbox", { name: copy.label });
}

/** El botón que envía (con su nombre de siempre, no el de mientras envía). */
export function sendButton(page: Page, copy: ComposeCopy = es.Chat.compose): Locator {
  return page.getByRole("main").getByRole("button", { name: copy.submit, exact: true });
}

/** Espera a que el formulario esté hidratado: antes, un clic lo manda como un formulario sin JavaScript. */
export async function whenComposeReady(page: Page): Promise<void> {
  await expect(page.getByRole("main").locator("form[data-hydrated='true']")).toHaveCount(1);
}

/**
 * Espera la respuesta de la acción que marca la conversación como leída al abrir la página `path` (la
 * del portal o la de una conversación del panel). Se llama ANTES de abrirla y se espera después: la marca
 * sale recién cuando la página se hidrata, y un test que se va enseguida la corta antes de que salga.
 * Se la distingue del envío de un mensaje porque no es un formulario (`multipart/form-data`).
 */
export function markReadDone(page: Page, path: string): Promise<Response> {
  return page.waitForResponse((response) => {
    const request = response.request();
    return (
      request.method() === "POST" &&
      new URL(request.url()).pathname === path &&
      request.headers()["next-action"] !== undefined &&
      !(request.headers()["content-type"] ?? "").startsWith("multipart/form-data")
    );
  });
}

/** Escribe `text`, toca Enviar y espera a que el mensaje aparezca en la conversación. */
export async function writeAndSend(page: Page, text: string, copy: ComposeCopy = es.Chat.compose): Promise<void> {
  await whenComposeReady(page);
  await composeBox(page, copy).fill(text);
  await sendButton(page, copy).click();
  await expect(chatMessages(page).filter({ hasText: text }).last()).toBeVisible();
}
