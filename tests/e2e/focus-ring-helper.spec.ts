import { expect, test, type Page } from "@playwright/test";
import { focusRingProblems } from "../helpers/focus-ring";

// La revisión del aro de foco (`tests/helpers/focus-ring.ts`) es la que prueba que el foco se ve
// en el panel: si dejara pasar un aro malo o se cortara sola, todos los chequeos de teclado
// darían verde sin medir nada. Acá se la prueba con páginas armadas a mano, sin pasar por el panel.

const GOOD_RING = "outline: 3px solid #0033cc; outline-offset: 3px;";

/** Una página con tres botones; `buttons` son los atributos de cada uno. */
async function openButtons(page: Page, buttons: string[]): Promise<void> {
  await page.setContent(
    `<style>body{background:#fff} button{${GOOD_RING} margin:12px}</style>${buttons
      .map((attributes, index) => `<button ${attributes}>Botón ${index + 1}</button>`)
      .join("")}`,
  );
}

test("a page where every button has a good ring has no problems", async ({ page }) => {
  await openButtons(page, ["", "", ""]);

  expect(await focusRingProblems(page)).toEqual([]);
});

test("a ring that is too faint against the background is reported with its contrast", async ({ page }) => {
  // Dorado sobre blanco: el aro de la tarjeta del ingreso antes de arreglarlo.
  await openButtons(page, ["", 'style="outline-color: #ffc93c"', ""]);

  const problems = await focusRingProblems(page);

  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("Botón 2");
  expect(problems[0]).toMatch(/contrasta \d\.\d\d:1 \(mínimo 3:1\)/);
});

test("an element with no ring, or with a thin one, is reported", async ({ page }) => {
  await openButtons(page, ['style="outline: none"', 'style="outline-width: 1px"', ""]);

  const problems = await focusRingProblems(page);

  expect(problems).toHaveLength(2);
  expect(problems[0]).toContain("Botón 1");
  expect(problems[1]).toContain("Botón 2");
});

test("it keeps going when an element it already measured leaves the page: a new one never reuses its number", async ({
  page,
}) => {
  // Al enfocar el botón 2 desaparece el botón 1 (ya medido). Si la numeración fuera "cuántos elementos
  // tienen número ahora", el botón 2 recibiría el 0 del primero, la revisión creería que dio la vuelta
  // y nunca llegaría al botón 3, que no tiene aro.
  await openButtons(page, ["", `onfocus="document.querySelector('button').remove()"`, 'style="outline: none"']);

  const problems = await focusRingProblems(page);

  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("Botón 3");
});

test("a page where Tab reaches nothing does not pass: a check that measured nothing proves nothing", async ({ page }) => {
  await page.setContent("<p>Solo texto, nada para enfocar.</p>");

  const problems = await focusRingProblems(page, { maxTabPresses: 8 });

  expect(problems).toEqual(["Tab no llegó a ningún elemento: la revisión no midió nada"]);
});
