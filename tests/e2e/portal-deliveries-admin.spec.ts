import AxeBuilder from "@axe-core/playwright";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { PHONE, createSale, uniqueName } from "../helpers/admin-ui";
import { newStudentBrowser, signIn } from "../helpers/portal-e2e";

// Las entregas desde el panel, de punta a punta: Tallami carga un video de YouTube, un link y un
// PDF en la ficha de una venta, los ve listados, abre el PDF y borra. Y lo que importa de seguridad:
// el PDF de una entrega lo abre su alumno dueño y nadie más (los alumnos son de verdad, con la
// invitación y el proveedor de prueba de `tests/helpers/portal-e2e.ts`).

const YOUTUBE = "https://youtu.be/dQw4w9WgXcQ?si=prueba";
const DRIVE = "https://drive.google.com/file/d/1AbC/view?usp=sharing";
const MEGABYTE = 1024 * 1024;
/** Los encabezados con los que se sirve un PDF; el servidor real suma otros (los de seguridad del sitio). */
const PDF_HEADERS = {
  "content-type": "application/pdf",
  "content-disposition": 'inline; filename="entrega.pdf"',
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};
/**
 * Lo mismo, visto desde el panel: el `proxy` de `/admin` (`src/admin/auth/guard.ts`) pone `Cache-Control: no-store`
 * a todo lo que sale de `/admin`, y eso pisa el de la ruta. Para el caché es igual de estricto.
 */
const PDF_HEADERS_IN_PANEL = { ...PDF_HEADERS, "cache-control": "no-store" };

/** Bytes que empiezan como un PDF, del tamaño pedido. */
function pdfFile(name: string, size = 300) {
  const buffer = Buffer.alloc(size);
  buffer.write("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
  return { name, mimeType: "application/pdf", buffer };
}

/** La tarjeta "Entregas" de la ficha de la venta que se ve ahora. */
function card(page: Page) {
  return page.getByRole("region", { name: "Entregas", exact: true });
}

function addForm(page: Page) {
  return card(page).getByRole("form", { name: "Agregar una entrega" });
}

function items(page: Page) {
  return card(page).getByRole("list", { name: "Entregas de esta venta" }).getByRole("listitem");
}

/** Abre la ficha de la venta del alumno `student` y espera a que la tarjeta esté lista para usarse. */
async function openSale(page: Page, student: string): Promise<void> {
  await page.goto(`/admin/ventas?q=${encodeURIComponent(student)}`);
  await page.getByRole("row").filter({ hasText: student }).getByRole("link", { name: student }).click();
  await expect(page.getByRole("heading", { name: "Editar venta" })).toBeVisible();
  await expect(addForm(page).getByRole("button", { name: "Agregar entrega" })).toBeEnabled();
}

interface NewDelivery {
  kind: "youtube" | "pdf" | "link";
  title: string;
  url?: string;
  file?: ReturnType<typeof pdfFile>;
}

/** Llena el formulario y lo envía; no espera el resultado. */
async function submitDelivery(page: Page, delivery: NewDelivery): Promise<void> {
  const form = addForm(page);
  await form.getByLabel("Tipo", { exact: true }).selectOption(delivery.kind);
  await form.getByLabel("Título", { exact: true }).fill(delivery.title);
  if (delivery.kind === "pdf") {
    if (delivery.file) await form.getByLabel("Archivo PDF", { exact: true }).setInputFiles(delivery.file);
  } else {
    await form.getByLabel("Link", { exact: true }).fill(delivery.url ?? "");
  }
  await form.getByRole("button", { name: "Agregar entrega" }).click();
}

/** Agrega una entrega y espera a verla en la lista. */
async function addDelivery(page: Page, delivery: NewDelivery): Promise<void> {
  const before = await items(page).count();
  await submitDelivery(page, delivery);
  await expect(card(page).getByText("Entrega agregada. El alumno la ve en su portal.")).toBeVisible();
  await expect(items(page)).toHaveCount(before + 1);
}

/** La dirección donde se abre la entrega `title` de la lista. */
async function hrefOf(page: Page, title: string): Promise<string> {
  const href = await items(page)
    .filter({ hasText: title })
    .getByRole("link", { name: new RegExp(`^Abrir ${title}`) })
    .getAttribute("href");
  expect(href).not.toBeNull();
  return href ?? "";
}

test.describe("the Entregas card of a sale", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("adds a YouTube video, a link and a small PDF, lists them, opens the PDF and deletes one", async ({ page }) => {
    const student = uniqueName("Alumna entregas");
    await createSale(page, { student });
    await openSale(page, student);
    await expect(card(page).getByText("Todavía no hay entregas en esta venta.")).toBeVisible();

    await addDelivery(page, { kind: "youtube", title: "Review de tu partida", url: YOUTUBE });
    // El formulario queda listo para la próxima, con el tipo elegido y los campos vacíos.
    await expect(addForm(page).getByLabel("Título", { exact: true })).toHaveValue("");
    await expect(addForm(page).getByLabel("Link", { exact: true })).toHaveValue("");
    await addDelivery(page, { kind: "link", title: "Guía en Drive", url: DRIVE });
    const pdf = pdfFile("plan-de-juego.pdf");
    await addDelivery(page, { kind: "pdf", title: "Plan de juego", file: pdf });

    // Quedan guardadas y en el orden en que se cargaron.
    await page.reload();
    await expect(items(page)).toHaveCount(3);
    await expect(items(page).nth(0)).toContainText("YouTube");
    await expect(items(page).nth(0)).toContainText("Review de tu partida");
    await expect(items(page).nth(1)).toContainText("Link");
    await expect(items(page).nth(1)).toContainText("Guía en Drive");
    await expect(items(page).nth(2)).toContainText("PDF");
    await expect(items(page).nth(2)).toContainText("Plan de juego");
    await expect(items(page).nth(0)).toContainText("Cargada el");
    // El video y el link abren en otra pestaña; el video, por su id (no por lo que se pegó).
    expect(await hrefOf(page, "Review de tu partida")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(await hrefOf(page, "Guía en Drive")).toBe(DRIVE);
    await expect(items(page).nth(0).getByRole("link", { name: /^Abrir/ })).toHaveAttribute("target", "_blank");

    // El PDF se abre desde el panel, con los encabezados del diseño.
    const pdfHref = await hrefOf(page, "Plan de juego");
    expect(pdfHref).toMatch(/^\/admin\/ventas\/[0-9a-f-]{36}\/entregas\/[0-9a-f-]{36}$/);
    const served = await page.request.get(pdfHref);
    expect(served.status()).toBe(200);
    for (const [name, value] of Object.entries(PDF_HEADERS_IN_PANEL)) expect(served.headers()[name], name).toBe(value);
    expect((await served.body()).equals(pdf.buffer)).toBe(true);

    // Borrar pregunta primero, con la opción segura enfocada; decir que no lo deja todo como estaba.
    await items(page).filter({ hasText: "Guía en Drive" }).getByRole("button", { name: "Borrar Guía en Drive" }).click();
    const question = card(page).getByText(/¿Borrar «Guía en Drive»\?/);
    await expect(question).toBeVisible();
    await expect(card(page).getByRole("button", { name: "No, conservarla" })).toBeFocused();
    await expect(card(page).getByRole("button", { name: "Sí, borrar" })).toHaveAccessibleDescription(/¿Borrar «Guía en Drive»\?/);
    await card(page).getByRole("button", { name: "No, conservarla" }).click();
    await expect(question).toHaveCount(0);
    await expect(items(page)).toHaveCount(3);
    await expect(card(page).getByRole("button", { name: "Borrar Guía en Drive" })).toBeFocused();

    await card(page).getByRole("button", { name: "Borrar Guía en Drive" }).click();
    await card(page).getByRole("button", { name: "Sí, borrar" }).click();
    await expect(items(page)).toHaveCount(2);
    await expect(card(page).getByText("Guía en Drive")).toHaveCount(0);
    // El resultado se anuncia: el foco va al aviso, porque el botón que lo pidió ya no está.
    await expect(page.locator(":focus")).toContainText("Entrega borrada.");
    await page.reload();
    await expect(items(page)).toHaveCount(2);

    // Borrar el PDF borra también su archivo: la dirección ya no lo sirve.
    await card(page).getByRole("button", { name: "Borrar Plan de juego" }).click();
    await expect(card(page).getByText(/y se borra el archivo/)).toBeVisible();
    await card(page).getByRole("button", { name: "Sí, borrar" }).click();
    await expect(items(page)).toHaveCount(1);
    const gone = await page.request.get(pdfHref);
    expect(gone.status()).toBe(404);
    expect((await gone.body()).length).toBe(0);
  });

  test("a PDF is judged by its bytes: an executable renamed to .pdf, and a file over 4 MB, are refused with a message and nothing is saved", async ({
    page,
  }) => {
    const student = uniqueName("Alumno archivos");
    await createSale(page, { student });
    await openSale(page, student);
    const posts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST") posts.push(request.url());
    });

    // Un ejecutable con nombre y tipo de PDF: el servidor mira los bytes.
    const fake = { name: "plan.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ\x90\x00\x03\x00\x00\x00 programa") };
    await submitDelivery(page, { kind: "pdf", title: "Parece un PDF", file: fake });
    const fileField = addForm(page).getByLabel("Archivo PDF", { exact: true });
    await expect(addForm(page).getByText(/Ese archivo no es un PDF/)).toBeVisible();
    await expect(fileField).toBeFocused();
    await expect(fileField).toHaveAttribute("aria-invalid", "true");
    expect(posts.length).toBeGreaterThan(0);

    // Uno de 4 MB y un byte: el navegador ya lo avisa, sin mandarlo.
    posts.length = 0;
    await submitDelivery(page, { kind: "pdf", title: "Grande", file: pdfFile("grande.pdf", 4 * MEGABYTE + 1) });
    await expect(addForm(page).getByText(/El PDF pesa más de 4 MB/)).toBeVisible();
    expect(posts).toEqual([]);
    await submitDelivery(page, { kind: "pdf", title: "Un exe de 5 MB", file: pdfFile("exe.pdf", 5 * MEGABYTE) });
    await expect(addForm(page).getByText(/El PDF pesa más de 4 MB/)).toBeVisible();
    expect(posts).toEqual([]);

    // Sin archivo.
    await addForm(page).getByLabel("Tipo", { exact: true }).selectOption("pdf");
    await addForm(page).getByLabel("Título", { exact: true }).fill("Sin archivo");
    await addForm(page).getByLabel("Archivo PDF", { exact: true }).setInputFiles([]);
    await addForm(page).getByRole("button", { name: "Agregar entrega" }).click();
    await expect(addForm(page).getByText("Elegí un archivo PDF.")).toBeVisible();

    await page.reload();
    await expect(card(page).getByText("Todavía no hay entregas en esta venta.")).toBeVisible();
    await expect(items(page)).toHaveCount(0);
  });

  test("a PDF of exactly 4 MB goes through the panel: the Server Action accepts the body", async ({ page }) => {
    const student = uniqueName("Alumno justo");
    await createSale(page, { student });
    await openSale(page, student);
    const exact = pdfFile("justo.pdf", 4 * MEGABYTE);

    await addDelivery(page, { kind: "pdf", title: "Justo 4 MB", file: exact });

    const served = await page.request.get(await hrefOf(page, "Justo 4 MB"));
    expect(served.status()).toBe(200);
    expect((await served.body()).length).toBe(4 * MEGABYTE);
  });

  test("refuses a title that is empty, a YouTube link that is not one, and a link that is not https", async ({ page }) => {
    const student = uniqueName("Alumno enlaces");
    await createSale(page, { student });
    await openSale(page, student);
    const form = addForm(page);

    await submitDelivery(page, { kind: "link", title: "   ", url: DRIVE });
    await expect(form.getByText(/Escribí un título de 1 a 120 caracteres/)).toBeVisible();
    await expect(form.getByLabel("Título", { exact: true })).toBeFocused();

    await submitDelivery(page, { kind: "youtube", title: "Video falso", url: "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ" });
    await expect(form.getByText(/Pegá el link de un video de YouTube/)).toBeVisible();
    await expect(form.getByLabel("Link", { exact: true })).toBeFocused();

    await submitDelivery(page, { kind: "link", title: "Sin https", url: "http://ejemplo.com/guia" });
    await expect(form.getByText("Pegá un link completo que empiece con https://")).toBeVisible();
    await submitDelivery(page, { kind: "link", title: "Script", url: "javascript:alert(1)" });
    await expect(form.getByText("Pegá un link completo que empiece con https://")).toBeVisible();

    await page.reload();
    await expect(items(page)).toHaveCount(0);
  });

  test("has no accessibility problems and no sideways scroll on a phone, with deliveries, with an error and with the question open", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    const student = uniqueName("Alumno accesible");
    await createSale(page, { student });
    await openSale(page, student);

    const audit = async (label: string) => {
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map(({ id, nodes }) => ({ label, id, targets: nodes.map((n) => n.target) }))).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), label).toBeLessThanOrEqual(0);
    };

    await audit("sin entregas");
    await addDelivery(page, { kind: "youtube", title: "Un título bastante largo para ver cómo se corta en una pantalla chica de teléfono", url: YOUTUBE });
    await addDelivery(page, { kind: "pdf", title: "Plan", file: pdfFile("plan.pdf") });
    await audit("con entregas");
    await submitDelivery(page, { kind: "link", title: "Sin https", url: "http://ejemplo.com" });
    await expect(addForm(page).getByText("Pegá un link completo que empiece con https://")).toBeVisible();
    await audit("con un error");
    await card(page).getByRole("button", { name: "Borrar Plan" }).click();
    await expect(card(page).getByRole("button", { name: "No, conservarla" })).toBeFocused();
    await audit("con la pregunta abierta");
  });
});

/** Un alumno nuevo con su venta, vinculado a una cuenta del portal y con su propio navegador. */
interface LinkedStudent {
  name: string;
  browser: { context: BrowserContext; page: Page };
}

async function linkedStudentWithSale(page: Page, browser: Browser, prefix: string): Promise<LinkedStudent> {
  const name = uniqueName(prefix);
  await createSale(page, { student: name });
  await page.goto(`/admin/alumnos?q=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name }).first().click();
  const portal = page.getByRole("region", { name: "Portal del alumno" });
  await portal.getByRole("button", { name: "Invitar al portal" }).click();
  const link = portal.getByLabel("Link de invitación");
  await expect(link).toBeVisible();
  const token = new URL(await link.inputValue()).searchParams.get("invitacion") ?? "";
  const studentBrowser = await newStudentBrowser(browser);
  const landed = await signIn(studentBrowser.page, { invitation: token });
  expect(landed.search).toBe("?invitacion=vinculada");
  return { name, browser: studentBrowser };
}

test.describe("who can open the PDF of a delivery", () => {
  test("only the student whose sale it is: another student, a visitor and even the panel session get a 404 with no body", async ({
    page,
    browser,
  }) => {
    test.setTimeout(120_000);
    await loginAsAdmin(page);
    const ana = await linkedStudentWithSale(page, browser, "Ana duena");
    const beto = await linkedStudentWithSale(page, browser, "Beto curioso");
    const visitor = await newStudentBrowser(browser);
    const secret = pdfFile("secreto.pdf");
    await openSale(page, ana.name);
    await addDelivery(page, { kind: "pdf", title: "Plan secreto de Ana", file: secret });
    const adminHref = await hrefOf(page, "Plan secreto de Ana");
    const deliveryId = adminHref.split("/").pop() ?? "";
    const portalFile = `/api/portal/files/${deliveryId}`;

    // Ana lo abre, con los encabezados del diseño.
    const mine = await ana.browser.page.request.get(portalFile);
    expect(mine.status()).toBe(200);
    for (const [name, value] of Object.entries(PDF_HEADERS)) expect(mine.headers()[name], name).toBe(value);
    expect((await mine.body()).equals(secret.buffer)).toBe(true);

    // Beto, con su sesión de verdad, cambiando el id en la dirección: 404, igual que un id que no existe.
    const others = await beto.browser.page.request.get(portalFile);
    const missing = await beto.browser.page.request.get("/api/portal/files/00000000-0000-4000-8000-000000000000");
    expect(others.status()).toBe(404);
    expect((await others.body()).length).toBe(0);
    expect(others.headers()["content-type"]).toBeUndefined();
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toBe(await others.text());

    // Sin sesión de alumno, y con la sesión del panel (que no abre el portal): lo mismo.
    const anonymous = await visitor.page.request.get(portalFile);
    const asAdmin = await page.request.get(portalFile);
    for (const response of [anonymous, asAdmin]) {
      expect(response.status()).toBe(404);
      expect((await response.body()).length).toBe(0);
    }

    // Y la ruta del panel no le sirve a nadie sin la sesión del panel (ni a Ana ni a un visitante).
    for (const outsider of [ana.browser.page, visitor.page]) {
      const response = await outsider.request.get(adminHref, { maxRedirects: 0 });
      expect(response.status()).not.toBe(200);
      expect((await response.body()).toString("latin1")).not.toContain("%PDF-");
    }

    await ana.browser.context.close();
    await beto.browser.context.close();
    await visitor.context.close();
  });
});
