import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { PASSKEY_BUTTON, PASSKEY_STEP_URL, expect, submitTestPassword, test, uniqueTestIp } from "../helpers/admin";
import { addCredential, enableVirtualAuthenticator, getCredentials, type VirtualCredential } from "../helpers/webauthn";

// Los e2e que cambian la seguridad del ingreso de todo el panel, en su propio
// servidor (`playwright.security.config.ts`): una base vacía, sin ninguna llave.
// Corren en serie y cada test parte de lo que dejó el anterior: el primero registra
// la primera llave y la guarda, y los siguientes la cargan en un navegador nuevo
// para entrar. Las tareas siguientes suman sus tests al final.
//
// Configuración → Seguridad (los tests del final): agregar, renombrar y borrar llaves,
// el código para otro dispositivo y cerrar sesiones. Un "dispositivo" aparte es un
// contexto de navegador propio, con su cookie, su IP y su autenticador virtual. La
// confirmación con la llave (`withReauth`) no se prueba acá: cada ingreso la deja
// abierta por 5 minutos y un test no puede esperar más; la cubren
// `admin-security-actions` y `admin-with-reauth`, en los tests unitarios.

test.describe.configure({ mode: "serial" });

const FIRST_KEY_URL = /\/admin\/login\/primera-llave(\?|$)/;
/** La línea bajo el título del resumen: solo aparece con la sesión iniciada. */
const PANEL_MARKER = "Cuánto ganás, qué se vende y qué tenés pendiente.";

/** La llave que registró el primer test, con su contador al día (cada uso lo sube). */
let savedKey: VirtualCredential | undefined;

/** Carga la llave guardada en un autenticador nuevo de `page` y devuelve el id del autenticador. */
async function armSavedKey(page: Page): Promise<string> {
  if (!savedKey) throw new Error("Falta la llave del primer test: este archivo corre en serie, desde el principio.");
  const authenticatorId = await enableVirtualAuthenticator(page);
  await addCredential(page, authenticatorId, savedKey);
  return authenticatorId;
}

/** Guarda la llave del autenticador tal como quedó (el contador sube con cada uso). */
async function saveKey(page: Page, authenticatorId: string): Promise<void> {
  const credentials = await getCredentials(page, authenticatorId);
  expect(credentials).toHaveLength(1);
  savedKey = credentials[0];
}

test("with no key yet, the password leads to registering the first one on this device, and that opens the panel", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin/login");
  await submitTestPassword(page);
  await expect(page).toHaveURL(FIRST_KEY_URL);
  const name = page.getByLabel("Nombre de la llave");
  // El nombre propuesto es el navegador y el sistema de este dispositivo.
  await expect(name).toHaveValue("Chrome en Windows");

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  const authenticatorId = await enableVirtualAuthenticator(page);
  await name.fill("PC de prueba");
  await page.getByRole("button", { name: "Registrar mi llave" }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(PANEL_MARKER)).toBeVisible();
  await saveKey(page, authenticatorId);
  expect(savedKey).toMatchObject({ rpId: "localhost", isResidentCredential: true });
});

test("once there is a key, the password leads to the passkey step, the first-key page sends you there, and the key opens the panel", async ({
  page,
}) => {
  await page.goto("/admin/login");
  await submitTestPassword(page);
  await expect(page).toHaveURL(PASSKEY_STEP_URL);

  await page.goto("/admin/login/primera-llave");
  await expect(page).toHaveURL(PASSKEY_STEP_URL);

  const authenticatorId = await armSavedKey(page);
  await page.getByRole("button", PASSKEY_BUTTON).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText(PANEL_MARKER)).toBeVisible();
  await saveKey(page, authenticatorId);
});

// --- Configuración → Seguridad ---

const LOGIN_URL = /\/admin\/login(\?|$)/;
const SECURITY_PATH = "/admin/configuracion/seguridad";
const CODE_SHAPE = /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/;

/** La llave de la PC de escritorio, la que se registra con un código en el test del código. */
let desktopKey: VirtualCredential | undefined;

function required(key: VirtualCredential | undefined, owner: string): VirtualCredential {
  if (!key) throw new Error(`Falta la llave de ${owner}: este archivo corre en serie, desde el principio.`);
  return key;
}

/** Entra al panel con contraseña y la llave `key` y devuelve la llave con su contador al día. */
async function signInWith(page: Page, key: VirtualCredential): Promise<VirtualCredential> {
  await page.goto("/admin/login");
  await submitTestPassword(page);
  await expect(page).toHaveURL(PASSKEY_STEP_URL);
  const authenticatorId = await enableVirtualAuthenticator(page);
  await addCredential(page, authenticatorId, key);
  await page.getByRole("button", PASSKEY_BUTTON).click();
  await expect(page).toHaveURL(/\/admin$/);
  const [updated] = await getCredentials(page, authenticatorId);
  return updated;
}

/** Otro dispositivo: un contexto de navegador nuevo, con su propia IP para el límite de intentos. */
async function newDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() },
  });
  return { context, page: await context.newPage() };
}

/** Hasta el campo del código de un dispositivo nuevo: contraseña y "Tengo un código". */
async function openCodeField(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await submitTestPassword(page);
  await expect(page).toHaveURL(PASSKEY_STEP_URL);
  await page.getByRole("button", { name: "Tengo un código" }).click();
}

/** Las sesiones abiertas de la página de Seguridad. Las de los tests anteriores siguen abiertas: se cuentan, no se suponen. */
function openSessions(page: Page) {
  return page.getByRole("region", { name: "Sesiones abiertas" }).getByRole("listitem");
}

async function expectNoSeriousAccessibilityProblems(page: Page): Promise<void> {
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(accessibility.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) }))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test("Seguridad lists the key and the session, adds a second key, renames it, deletes it, and the last key stays", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  savedKey = await signInWith(page, required(savedKey, "la PC de prueba"));
  await page.goto(SECURITY_PATH);

  await expect(page.getByRole("heading", { level: 1, name: "Seguridad" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Renombrar PC de prueba" })).toBeVisible();
  await expect(page.getByText("Esta sesión")).toBeVisible();
  await expect(page.getByText("Avisos por email: sin configurar")).toBeVisible();
  await expectNoSeriousAccessibilityProblems(page);

  // Un dispositivo más: la página pasa a un autenticador nuevo y vacío (la sesión ya está abierta).
  const secondAuthenticator = await enableVirtualAuthenticator(page);
  await page.getByLabel("Nombre de la llave").fill("Notebook");
  await page.getByRole("button", { name: "Agregar una llave en este dispositivo" }).click();
  await expect(page.getByText("Agregaste la llave «Notebook».")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Renombrar / })).toHaveCount(2);
  expect(await getCredentials(page, secondAuthenticator)).toHaveLength(1);

  const notebook = page.getByRole("listitem").filter({ hasText: "Notebook" });
  await notebook.getByRole("button", { name: "Renombrar Notebook" }).click();
  const renameForm = page.getByRole("form", { name: "Renombrar Notebook" });
  await renameForm.getByLabel("Nombre de la llave").fill("Notebook de Tomás");
  await renameForm.getByRole("button", { name: "Guardar nombre" }).click();
  await expect(page.getByRole("button", { name: "Renombrar Notebook de Tomás" })).toBeVisible();

  // Borrar pide confirmar, y "No" la deja.
  const renamed = page.getByRole("listitem").filter({ hasText: "Notebook de Tomás" });
  await renamed.getByRole("button", { name: "Borrar Notebook de Tomás" }).click();
  await renamed.getByRole("button", { name: "No, conservarla" }).click();
  await expect(page.getByRole("button", { name: /^Renombrar / })).toHaveCount(2);
  await renamed.getByRole("button", { name: "Borrar Notebook de Tomás" }).click();
  await renamed.getByRole("button", { name: "Sí, borrar" }).click();
  await expect(page.getByRole("button", { name: /^Renombrar / })).toHaveCount(1);

  // La última no se borra: el aviso lo dice y la llave sigue.
  const last = page.getByRole("listitem").filter({ hasText: "PC de prueba" });
  await last.getByRole("button", { name: "Borrar PC de prueba" }).click();
  await last.getByRole("button", { name: "Sí, borrar" }).click();
  await expect(last.getByText("Agregá otra llave antes de borrar esta.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Renombrar PC de prueba" })).toBeVisible();
  await expectNoSeriousAccessibilityProblems(page);
});

test("a code registers the key of another device once, and the same code again is refused", async ({ page, browser }) => {
  savedKey = await signInWith(page, required(savedKey, "la PC de prueba"));
  await page.goto(SECURITY_PATH);
  await page.getByRole("button", { name: "Generar un código" }).click();
  const shownCode = page.getByTestId("enrollment-code");
  await expect(shownCode).toBeVisible();
  const code = (await shownCode.innerText()).trim();
  expect(code).toMatch(CODE_SHAPE);
  await expect(
    page.getByText("Usalo antes de 10 minutos y no cierres sesión en este dispositivo hasta usarlo."),
  ).toBeVisible();

  const desktop = await newDevice(browser);
  const stranger = await newDevice(browser);
  try {
    // La PC de escritorio: contraseña, "Tengo un código", el código, y su propia llave.
    await openCodeField(desktop.page);
    await desktop.page.setViewportSize({ width: 375, height: 812 });
    await expectNoSeriousAccessibilityProblems(desktop.page);
    await desktop.page.getByLabel("Código").fill(code);
    await desktop.page.getByRole("button", { name: "Continuar" }).click();
    const register = desktop.page.getByRole("button", { name: "Registrar la llave de este dispositivo" });
    await expect(register).toBeVisible();
    const desktopAuthenticator = await enableVirtualAuthenticator(desktop.page);
    await desktop.page.getByLabel("Nombre de la llave").fill("PC de escritorio");
    await register.click();
    await expect(desktop.page).toHaveURL(/\/admin$/);
    await expect(desktop.page.getByText(PANEL_MARKER)).toBeVisible();
    desktopKey = (await getCredentials(desktop.page, desktopAuthenticator))[0];
    expect(desktopKey).toBeDefined();

    // Las dos llaves están en la lista.
    await page.reload();
    await expect(page.getByRole("button", { name: "Renombrar PC de escritorio" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Renombrar / })).toHaveCount(2);

    // El mismo código en otro dispositivo: ya se usó.
    await openCodeField(stranger.page);
    await stranger.page.getByLabel("Código").fill(code);
    await stranger.page.getByRole("button", { name: "Continuar" }).click();
    await expect(stranger.page.getByText("El código no es correcto o ya venció.")).toBeVisible();
    await expect(stranger.page.getByRole("button", { name: "Registrar la llave de este dispositivo" })).toHaveCount(0);
  } finally {
    await desktop.context.close();
    await stranger.context.close();
  }
});

test("a code does not get a device in without the password, or after the session that made it is closed", async ({
  page,
  browser,
}) => {
  // Sin la contraseña no hay campo del código: la página manda al login.
  const visitor = await newDevice(browser);
  try {
    await visitor.page.goto("/admin/login/llave");
    await expect(visitor.page).toHaveURL(LOGIN_URL);
    await expect(visitor.page.getByText("Tu ingreso venció")).toBeVisible();
  } finally {
    await visitor.context.close();
  }

  // Un código de una sesión que se cerró ya no sirve: se genera, se cierra esa sesión con "Salir" y se prueba.
  savedKey = await signInWith(page, required(savedKey, "la PC de prueba"));
  await page.goto(SECURITY_PATH);
  await page.getByRole("button", { name: "Generar un código" }).click();
  const code = (await page.getByTestId("enrollment-code").innerText()).trim();
  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page).toHaveURL(LOGIN_URL);

  const late = await newDevice(browser);
  try {
    await openCodeField(late.page);
    await late.page.getByLabel("Código").fill(code);
    await late.page.getByRole("button", { name: "Continuar" }).click();
    await expect(late.page.getByText("El código no es correcto o ya venció.")).toBeVisible();
  } finally {
    await late.context.close();
  }
});

test("deleting the key of another device closes that device's session at once", async ({ page, browser }) => {
  const desktop = await newDevice(browser);
  try {
    savedKey = await signInWith(page, required(savedKey, "la PC de prueba"));
    desktopKey = await signInWith(desktop.page, required(desktopKey, "la PC de escritorio"));
    await desktop.page.goto("/admin/ventas");
    await expect(desktop.page).toHaveURL(/\/admin\/ventas$/);

    // Las dos sesiones están abiertas, y la de este navegador va marcada.
    await page.goto(SECURITY_PATH);
    await expect(page.getByRole("heading", { level: 1, name: "Seguridad" })).toBeVisible();
    await expect(page.getByText("Esta sesión")).toHaveCount(1);
    const openBefore = await openSessions(page).count();
    expect(openBefore).toBeGreaterThanOrEqual(2);

    const lost = page.getByRole("listitem").filter({ hasText: "PC de escritorio" });
    await lost.getByRole("button", { name: "Borrar PC de escritorio" }).click();
    await lost.getByRole("button", { name: "Sí, borrar" }).click();
    await expect(page.getByRole("button", { name: /^Renombrar / })).toHaveCount(1);

    // El dispositivo perdido, al navegar, va al login; este sigue adentro.
    await desktop.page.goto("/admin/facturacion");
    await expect(desktop.page).toHaveURL(LOGIN_URL);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Seguridad" })).toBeVisible();
    // Se cerraron las dos sesiones de esa llave: la de ahora y la que dejó el test del código.
    await expect(openSessions(page)).toHaveCount(openBefore - 2);
  } finally {
    await desktop.context.close();
  }
});

test("closing every session sends all the devices to the login, and the keys still work", async ({ page, browser }) => {
  const notebook = await newDevice(browser);
  try {
    savedKey = await signInWith(page, required(savedKey, "la PC de prueba"));
    savedKey = await signInWith(notebook.page, savedKey);
    await page.goto(SECURITY_PATH);
    await expect(page.getByRole("heading", { level: 1, name: "Seguridad" })).toBeVisible();
    await expect(page.getByText("Esta sesión")).toHaveCount(1);
    expect(await openSessions(page).count()).toBeGreaterThanOrEqual(2);

    await page.getByRole("button", { name: "Cerrar todas las sesiones" }).click();
    await expect(page).toHaveURL(LOGIN_URL);
    await notebook.page.goto("/admin");
    await expect(notebook.page).toHaveURL(LOGIN_URL);

    // La cookie vieja no vuelve a abrir nada, y las llaves siguen: se entra de nuevo con contraseña y llave.
    await page.goto(SECURITY_PATH);
    await expect(page).toHaveURL(LOGIN_URL);
    savedKey = await signInWith(page, savedKey);
    await page.goto(SECURITY_PATH);
    await expect(page.getByRole("button", { name: /^Renombrar / })).toHaveCount(1);
    // De todas las sesiones, queda solo la nueva.
    await expect(openSessions(page)).toHaveCount(1);
    await expect(page.getByText("Esta sesión")).toHaveCount(1);
  } finally {
    await notebook.context.close();
  }
});
