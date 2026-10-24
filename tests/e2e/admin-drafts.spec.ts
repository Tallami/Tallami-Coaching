import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";
import {
  ADMIN_COOKIE,
  confirmWithTestPasskey,
  expect,
  loginAsAdmin,
  submitTestPassword,
  test,
} from "../helpers/admin";
import {
  PHONE,
  createSale,
  fillSale,
  fillSaleDetails,
  openNewSale,
  uniqueName,
  whenInteractive,
} from "../helpers/admin-ui";
import { CLAIM_KEY, DRAFT_PREFIX } from "../../src/admin/ui/draft-store";
import { addDays, todayInArgentina } from "../../src/admin/metrics/period";

// Nunca se pierde lo que estaba escribiendo: si la sesión terminó justo al guardar (por inactividad,
// por las 8 horas, o porque se cerró desde otro dispositivo), después de volver a entrar el formulario
// aparece con lo escrito y un aviso. Lo guardado con éxito, en cambio, nunca reaparece, y cerrar la
// sesión a propósito borra todo.
//
// El mecanismo (ver `src/admin/ui/draft-store.ts`): al enviar, el formulario guarda un borrador
// pendiente en `sessionStorage`; si la sesión había terminado, el login recibe `?error=vencida` y deja
// una marca de recuperación; al abrir el formulario, un borrador con una marca posterior vuelve y un
// borrador sin marca se tira.

const NEW_SALE_PATH = "/admin/ventas/nueva";
const BILLING_PATH = "/admin/facturacion";
const SETTINGS_PATH = "/admin/configuracion";
const SAVE_BUTTON = { name: "Guardar venta" } as const;
const ENDED_MESSAGE = "Tu sesión se cerró. Volvé a entrar para seguir.";
const NEW_SALE_ENDED_URL = /\/admin\/login\?next=%2Fadmin%2Fventas%2Fnueva&error=vencida$/;
const BILLING_ENDED_URL = /\/admin\/login\?next=%2Fadmin%2Ffacturacion&error=vencida$/;

/** Los borradores pendientes que hay en la pestaña. */
function storedDrafts(page: Page): Promise<string[]> {
  return page.evaluate(
    (prefix) => Object.keys(sessionStorage).filter((key) => key.startsWith(prefix)),
    DRAFT_PREFIX,
  );
}

function storedClaim(page: Page): Promise<string | null> {
  return page.evaluate((key) => sessionStorage.getItem(key), CLAIM_KEY);
}

/** Lo que ve quien llega al login después de que se le cerró la sesión: el aviso, y la marca guardada. */
async function expectEndedLogin(page: Page, url: RegExp): Promise<void> {
  await expect(page).toHaveURL(url);
  // (La página tiene otro `role="alert"`: el anunciador de rutas de Next.)
  await expect(page.locator("#login-error")).toHaveText(ENDED_MESSAGE);
  // La marca la deja el navegador al hidratar el login: se espera antes de seguir (una contraseña enviada
  // antes recargaría la página, y con ella la marca nunca se dejaría).
  await expect.poll(() => storedClaim(page)).not.toBeNull();
}

/** Vuelve a entrar con contraseña y llave desde el login al que se llegó. */
async function signInAgain(page: Page): Promise<void> {
  await submitTestPassword(page);
  await confirmWithTestPasskey(page);
}

const DRAFT_NOTICE = (page: Page) => page.getByTestId("draft-notice");

interface FullSale {
  student: string;
  description: string;
  amount: string;
  paidOn: string;
  dueAt: string;
  arsPerUnit: string;
  arsPerUsd: string;
  notes: string;
}

function fullSale(student: string): FullSale {
  return {
    student,
    description: "Revisión de VOD extra",
    amount: "250,50",
    paidOn: "2026-10-12",
    dueAt: "2026-10-30T18:30",
    arsPerUnit: "280",
    arsPerUsd: "1.510,50",
    notes: "Pagó por Pix\nsegunda línea",
  };
}

/**
 * Una venta cargada a fondo: alumno nuevo, «Otro» con su descripción (un campo que aparece según otro),
 * reales con tipo de cambio manual (dos campos más que aparecen), listas, fechas y notas.
 */
async function typeFullSale(page: Page, sale: FullSale): Promise<void> {
  await fillSale(page, { student: sale.student, item: "other", currency: "BRL", paymentMethod: "pix", status: "paid" });
  await page.getByLabel("Descripción", { exact: false }).fill(sale.description);
  await page.getByLabel("Monto", { exact: true }).fill(sale.amount);
  await page.getByLabel("Fecha de cobro", { exact: true }).fill(sale.paidOn);
  await page.getByLabel("Entrega o sesión comprometida").fill(sale.dueAt);
  await page.getByRole("radio", { name: /^Manual/ }).check();
  await page.getByLabel("Pesos por real").fill(sale.arsPerUnit);
  await page.getByLabel("Pesos por dólar").fill(sale.arsPerUsd);
  await page.getByLabel("Notas de la venta").fill(sale.notes);
}

async function expectFullSale(page: Page, sale: FullSale): Promise<void> {
  await expect(page.getByRole("radio", { name: "Alumno nuevo" })).toBeChecked();
  await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(sale.student);
  await expect(page.getByLabel("Servicio", { exact: true })).toHaveValue("other");
  await expect(page.getByLabel("Descripción", { exact: false })).toHaveValue(sale.description);
  await expect(page.getByLabel("Moneda", { exact: true })).toHaveValue("BRL");
  await expect(page.getByLabel("Monto", { exact: true })).toHaveValue(sale.amount);
  await expect(page.getByLabel("Medio de pago", { exact: true })).toHaveValue("pix");
  await expect(page.getByLabel("Estado", { exact: true })).toHaveValue("paid");
  await expect(page.getByLabel("Fecha de cobro", { exact: true })).toHaveValue(sale.paidOn);
  await expect(page.getByLabel("Entrega o sesión comprometida")).toHaveValue(sale.dueAt);
  await expect(page.getByRole("radio", { name: /^Manual/ })).toBeChecked();
  await expect(page.getByLabel("Pesos por real")).toHaveValue(sale.arsPerUnit);
  await expect(page.getByLabel("Pesos por dólar")).toHaveValue(sale.arsPerUsd);
  await expect(page.getByLabel("Notas de la venta")).toHaveValue(sale.notes);
}

/** Lo que sigue en una pantalla de venta nueva cuando no se recuperó nada. */
async function expectBlankSale(page: Page): Promise<void> {
  await expect(DRAFT_NOTICE(page)).toHaveCount(0);
  await expect(page.getByLabel("Servicio", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Monto", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Medio de pago", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Notas de la venta")).toHaveValue("");
  await page.getByRole("radio", { name: "Alumno nuevo" }).check();
  await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue("");
}

/** Cierra la sesión desde otra pestaña ("Salir"): la fila se cierra en la base y se borra la cookie del navegador. */
async function logOutFromAnotherTab(context: BrowserContext): Promise<void> {
  const other = await context.newPage();
  try {
    await other.goto("/admin");
    const logout = other.getByRole("button", { name: "Salir" });
    await whenInteractive(logout);
    await logout.click();
    await expect(other).toHaveURL(/\/admin\/login/);
  } finally {
    await other.close();
  }
}

test.describe("what was typed when the session ended", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("a full sale comes back after signing in again, with the notice, and Descartar empties it", async ({
    context,
    page,
  }) => {
    const sale = fullSale(uniqueName("Sesión perdida"));
    await openNewSale(page);
    await typeFullSale(page, sale);

    // La sesión se perdió (como si se hubiera cerrado desde otro dispositivo).
    await context.clearCookies();
    await page.getByRole("button", SAVE_BUTTON).click();
    await expectEndedLogin(page, NEW_SALE_ENDED_URL);
    await signInAgain(page);

    await expect(page).toHaveURL(new RegExp(`${NEW_SALE_PATH}$`));
    await expect(DRAFT_NOTICE(page)).toContainText(
      "Tu sesión se cerró por inactividad: recuperamos lo que habías escrito, revisalo y guardá.",
    );
    await expectFullSale(page, sale);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    // La marca y el borrador se usaron: recargar no vuelve a traerlo.
    expect(await storedClaim(page)).toBeNull();
    expect(await storedDrafts(page)).toEqual([]);

    await page.getByRole("button", { name: "Descartar" }).click();
    await expectBlankSale(page);
    await expect(page.getByRole("button", SAVE_BUTTON)).toBeEnabled();
  });

  test("the notice and its Descartar button fit a phone", async ({ context, page }) => {
    await page.setViewportSize(PHONE);
    const student = uniqueName("Celular perdido");
    await openNewSale(page);
    await page.getByRole("radio", { name: "Alumno nuevo" }).check();
    await page.getByLabel("Nombre", { exact: true }).fill(student);

    await context.clearCookies();
    await page.getByRole("button", SAVE_BUTTON).click();
    await expectEndedLogin(page, NEW_SALE_ENDED_URL);
    await signInAgain(page);

    await expect(DRAFT_NOTICE(page)).toBeVisible();
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(student);
    const descartar = page.getByRole("button", { name: "Descartar" });
    const box = await descartar.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(PHONE.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test("a sale that was saved does not come back: the next new sale is empty, with no notice", async ({ page }) => {
    await createSale(page, { student: uniqueName("Venta guardada") });
    // Lo que deja un envío exitoso: un borrador pendiente que nadie va a reclamar.
    expect(await storedDrafts(page)).toEqual([`${DRAFT_PREFIX}venta:nueva`]);

    await openNewSale(page);

    await expectBlankSale(page);
    await expect.poll(() => storedDrafts(page)).toEqual([]);
  });

  test("a sale saved a moment before the session ends does not come back in place of the form that was lost", async ({
    context,
    page,
  }) => {
    // Guardó bien una venta y, enseguida, perdió la sesión escribiendo un alumno: vuelve el alumno, no la venta.
    await createSale(page, { student: uniqueName("Venta anterior") });
    const student = uniqueName("Alumno perdido");
    await page.goto("/admin/alumnos/nuevo");
    await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
    await page.getByLabel("Nombre", { exact: true }).fill(student);
    await page.getByLabel("Discord", { exact: false }).fill("perdido.e2e");

    await context.clearCookies();
    await page.getByRole("button", { name: "Guardar alumno" }).click();
    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Falumnos%2Fnuevo&error=vencida$/);
    await expect.poll(() => storedClaim(page)).not.toBeNull();
    await signInAgain(page);

    await expect(page).toHaveURL(/\/admin\/alumnos\/nuevo$/);
    await expect(DRAFT_NOTICE(page)).toBeVisible();
    await expect(page.getByLabel("Nombre", { exact: true })).toHaveValue(student);
    await expect(page.getByLabel("Discord", { exact: false })).toHaveValue("perdido.e2e");
    // La venta guardada antes sigue siendo un borrador que nadie reclamó: no vuelve a aparecer.
    await openNewSale(page);
    await expectBlankSale(page);
  });

  test("the chosen existing student comes back too, not only what was typed", async ({ context, page }) => {
    const student = uniqueName("Alumna elegida");
    await createSale(page, { student });
    await openNewSale(page);
    await page.getByRole("radio", { name: "Alumno existente" }).check();
    await page.getByRole("combobox", { name: "Buscar alumno" }).fill(student);
    await page.getByRole("option", { name: new RegExp(student) }).click();
    await expect(page.getByRole("button", { name: "Cambiar alumno" })).toBeVisible();
    await fillSaleDetails(page, { item: "lesson", paymentMethod: "transfer", status: "paid", amount: "45" });

    await context.clearCookies();
    await page.getByRole("button", SAVE_BUTTON).click();
    await expectEndedLogin(page, NEW_SALE_ENDED_URL);
    await signInAgain(page);

    await expect(DRAFT_NOTICE(page)).toBeVisible();
    await expect(page.getByRole("radio", { name: "Alumno existente" })).toBeChecked();
    await expect(page.getByRole("button", { name: "Cambiar alumno" })).toBeVisible();
    await expect(page.locator("form").getByText(student)).toBeVisible();
    await expect(page.getByLabel("Monto", { exact: true })).toHaveValue("45");
    await expect(page.getByLabel("Medio de pago", { exact: true })).toHaveValue("transfer");

    // Guardar anda: el alumno elegido viajó con el formulario.
    await page.getByRole("button", SAVE_BUTTON).click();
    await expect(page).toHaveURL(/\/admin\/ventas\?guardada=creada$/);
  });

  test("the sales ticked in Por facturar come back with the invoice type, number and date", async ({
    context,
    page,
  }) => {
    const first = uniqueName("Ana por facturar");
    const second = uniqueName("Beto por facturar");
    const untouched = uniqueName("Caro sin tildar");
    const number = `00003-${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
    const issuedOn = addDays(todayInArgentina(), -3);
    for (const student of [first, second, untouched]) await createSale(page, { student });

    await page.goto(BILLING_PATH);
    await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
    const pickerOf = (student: string) =>
      page.getByRole("checkbox", { name: new RegExp(`Elegir la venta de ${student}`) });
    await pickerOf(first).check();
    await pickerOf(second).check();
    await page.getByLabel("Tipo de factura").selectOption("E");
    await page.getByLabel("Número de factura").fill(number);
    await page.getByLabel("Fecha de la factura").fill(issuedOn);

    await context.clearCookies();
    await page.getByRole("button", { name: "Marcar como facturadas" }).click();
    await expectEndedLogin(page, BILLING_ENDED_URL);
    await signInAgain(page);

    await expect(page).toHaveURL(new RegExp(`${BILLING_PATH}$`));
    await expect(DRAFT_NOTICE(page)).toBeVisible();
    await expect(pickerOf(first)).toBeChecked();
    await expect(pickerOf(second)).toBeChecked();
    await expect(pickerOf(untouched)).not.toBeChecked();
    await expect(page.getByTestId("selection-summary")).toContainText("2 ventas elegidas");
    await expect(page.getByLabel("Tipo de factura")).toHaveValue("E");
    await expect(page.getByLabel("Número de factura")).toHaveValue(number);
    await expect(page.getByLabel("Fecha de la factura")).toHaveValue(issuedOn);

    // Descartar deja la lista como se abrió: nada elegido y la fecha de hoy.
    await page.getByRole("button", { name: "Descartar" }).click();
    await expect(DRAFT_NOTICE(page)).toHaveCount(0);
    await expect(pickerOf(first)).not.toBeChecked();
    await expect(pickerOf(second)).not.toBeChecked();
    await expect(page.getByLabel("Tipo de factura")).toHaveValue("");
    await expect(page.getByLabel("Número de factura")).toHaveValue("");
    await expect(page.getByLabel("Fecha de la factura")).toHaveValue(todayInArgentina());
  });

  test("the monotributo settings come back too", async ({ context, page }) => {
    // No se guarda nada: la base de los tests se comparte y otros tests cambian estos datos.
    await page.goto(SETTINGS_PATH);
    await expect(page.locator("form[data-hydrated='true']")).toBeVisible();
    await page.getByLabel("Categoría", { exact: true }).selectOption("H");
    await page.getByLabel("Tope anual en pesos").fill("68.000.000,50");
    await page.getByLabel("Vigente desde").fill("2026-02-01");

    await context.clearCookies();
    await page.getByRole("button", { name: "Guardar configuración" }).click();
    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fconfiguracion&error=vencida$/);
    await expect.poll(() => storedClaim(page)).not.toBeNull();
    await signInAgain(page);

    await expect(page).toHaveURL(new RegExp(`${SETTINGS_PATH}$`));
    await expect(DRAFT_NOTICE(page)).toBeVisible();
    await expect(page.getByLabel("Categoría", { exact: true })).toHaveValue("H");
    await expect(page.getByLabel("Tope anual en pesos")).toHaveValue("68.000.000,50");
    await expect(page.getByLabel("Vigente desde")).toHaveValue("2026-02-01");
  });

  test("Salir on purpose throws every draft away: signing in again shows no notice", async ({ page }) => {
    await openNewSale(page);
    await page.getByLabel("Servicio", { exact: true }).selectOption("lesson");
    // Se envía incompleto: el servidor devuelve los errores y el borrador queda pendiente.
    await page.getByRole("button", SAVE_BUTTON).click();
    await expect.poll(() => storedDrafts(page)).toEqual([`${DRAFT_PREFIX}venta:nueva`]);
    // Una marca que quedó de antes: sin el borrado de «Salir», el borrador volvería.
    await page.evaluate((key) => sessionStorage.setItem(key, String(Date.now())), CLAIM_KEY);

    const logout = page.getByRole("button", { name: "Salir" });
    await whenInteractive(logout);
    await logout.click();
    await expect(page).toHaveURL(/\/admin\/login(\?|$)/);
    expect(await storedDrafts(page)).toEqual([]);
    expect(await storedClaim(page)).toBeNull();

    await submitTestPassword(page);
    await confirmWithTestPasskey(page);
    await expect(page).toHaveURL(/\/admin$/);
    await openNewSale(page);
    await expectBlankSale(page);
  });

  test("a session closed in the database while its cookie is still good sends the form to the login and brings it back", async ({
    context,
    page,
  }) => {
    // Como al vencer por inactividad: la cookie sigue firmada y sin vencer (el `proxy` la deja pasar), y es
    // `requireAdmin()` quien ve la sesión cerrada. Antes de cerrarla se guarda la cookie para volver a ponerla.
    const cookie = (await context.cookies()).find(({ name }) => name === ADMIN_COOKIE);
    if (!cookie) throw new Error("El ingreso no dejó la cookie de sesión.");
    const sale = fullSale(uniqueName("Sesión cerrada"));
    await openNewSale(page);
    await typeFullSale(page, sale);

    await logOutFromAnotherTab(context);
    await context.addCookies([cookie]);
    await page.getByRole("button", SAVE_BUTTON).click();

    await expectEndedLogin(page, NEW_SALE_ENDED_URL);
    await signInAgain(page);
    await expect(page).toHaveURL(new RegExp(`${NEW_SALE_PATH}$`));
    await expect(DRAFT_NOTICE(page)).toBeVisible();
    await expectFullSale(page, sale);
  });
});
