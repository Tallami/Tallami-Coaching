import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { PASSKEY_BUTTON, PASSKEY_STEP_URL, expect, submitTestPassword, test } from "../helpers/admin";
import { addCredential, enableVirtualAuthenticator, getCredentials, type VirtualCredential } from "../helpers/webauthn";

// Los e2e que cambian la seguridad del ingreso de todo el panel, en su propio
// servidor (`playwright.security.config.ts`): una base vacía, sin ninguna llave.
// Corren en serie y cada test parte de lo que dejó el anterior: el primero registra
// la primera llave y la guarda, y los siguientes la cargan en un navegador nuevo
// para entrar. Las tareas siguientes suman sus tests al final.

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
