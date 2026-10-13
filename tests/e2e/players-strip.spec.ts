import { expect, test, type Locator, type Page } from "@playwright/test";
import { readPlayerEntries } from "../helpers/players-source";

const GOLD = "rgb(255, 201, 60)";
const HERO = "section[aria-labelledby='hero-title']";
const LABEL_ES = "Trabajé con";

const STRIP_LABELS = [
  ["/es", "Trabajé con"],
  ["/pt", "Trabalhei com"],
  ["/en", "Worked with"],
] as const;

/** Los jugadores de `src/content/players.ts`, en el orden en que se muestran. */
const PLAYERS = readPlayerEntries();
const PLAYER_NAMES = PLAYERS.map(({ name }) => name);
const PLAYERS_WITH_PHOTO = PLAYERS.filter(({ hasPhoto }) => hasPhoto).length;

const PHONE_VIEWPORT = { width: 375, height: 812 };
/** Ancho en que el contenido de la página queda centrado y con márgenes laterales. */
const WIDE_VIEWPORT = { width: 1440, height: 900 };
/** Redondeo de Chrome al ubicar el contenido centrado. */
const ALIGNMENT_TOLERANCE_PX = 1;
const MIN_TARGET_SIZE = 44;
/** Intervalo corto y acotado para comprobar que la fila no se mueve. */
const STILL_INTERVAL_MS = 500;
/** Menos de medio píxel: lo que Chrome puede variar al redondear sin moverse. */
const STILL_TOLERANCE_PX = 0.5;
const MOVING_TIMEOUT_MS = 3_000;
const MAX_TAB_PRESSES = 20;
const SUBPIXEL_TOLERANCE = 0.01;
/** Ancho mínimo del aro de foco que se ve (el de la página es de 3 px). */
const MIN_RING_WIDTH = 3;
/** Una fila de 375 px con un aro de 3 px tiene miles de píxeles dorados; esto es un piso holgado. */
const MIN_GOLD_RING_PIXELS = 500;

/**
 * La sección de la franja. Con "reducir movimiento" la fila también es una
 * región con el mismo nombre; por eso se pide la sección y no solo el rol.
 */
function stripOf(page: Page): Locator {
  return page.locator("section[aria-labelledby='players-label']");
}

function playerListOf(page: Page): Locator {
  return stripOf(page).getByRole("list", { name: LABEL_ES });
}

/** El texto que cada item tiene directamente, sin el de los elementos de adentro. */
async function ownTextOf(items: Locator): Promise<string[]> {
  return items.evaluateAll((nodes) =>
    nodes.map((node) =>
      Array.from(node.childNodes)
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent)
        .join("")
        .trim(),
    ),
  );
}

/** Fila visible de la franja: el contenedor que recorta el movimiento. */
function rowOf(page: Page): Locator {
  return stripOf(page).locator("[data-direction]");
}

/** Posición horizontal de la lista visible, medida tras pintar dos cuadros. */
async function listX(list: Locator): Promise<number> {
  return list.evaluate(async (node) => {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    return node.getBoundingClientRect().x;
  });
}

async function expectStill(list: Locator) {
  const before = await listX(list);
  await list.page().waitForTimeout(STILL_INTERVAL_MS);
  const after = await listX(list);

  expect(Math.abs(after - before)).toBeLessThanOrEqual(STILL_TOLERANCE_PX);
}

async function expectMoving(list: Locator) {
  const start = await listX(list);

  await expect
    .poll(() => listX(list), { timeout: MOVING_TIMEOUT_MS })
    .not.toBeCloseTo(start, 0);
}

/**
 * Activa el botón hasta que su texto pasa a `expected`: una activación antes
 * de que React hidrate la página se pierde, y repetirla no lo alterna dos
 * veces porque solo se vuelve a activar si el texto todavía no cambió.
 */
async function toggleTo(
  button: Locator,
  expected: string,
  activate: () => Promise<void> = () => button.click(),
) {
  await expect(async () => {
    if ((await button.textContent()) !== expected) {
      await activate();
    }
    await expect(button).toHaveText(expected, { timeout: 1_000 });
  }).toPass();
  // Es un botón de acción, no de estado: el nombre dice qué hace al tocarlo.
  await expect(button).toHaveAccessibleName(expected);
  await expect(button).not.toHaveAttribute("aria-pressed");
}

/** Tab hasta que el foco cae en `target`; falla si no llega en el tope. */
async function tabTo(page: Page, target: Locator) {
  for (let press = 0; press < MAX_TAB_PRESSES; press += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

/** Nombres de las animaciones CSS activas dentro de la franja. */
async function animationNames(strip: Locator): Promise<string[]> {
  return strip.evaluate((root) =>
    [root, ...root.querySelectorAll("*")]
      .map((node) => getComputedStyle(node).animationName)
      .filter((name) => name !== "none"),
  );
}

/**
 * Los jugadores no son focusables. Para probar lo que necesita una fila con
 * links (el muro de reviews), se vuelven focusables el primero o el último de
 * cada copia; la copia del loop no tiene que recibir el foco igual.
 */
async function makeItemsFocusable(strip: Locator, position: "first" | "last") {
  await strip.evaluate((root, pick) => {
    for (const list of root.querySelectorAll("ul")) {
      const item =
        pick === "first" ? list.firstElementChild : list.lastElementChild;
      item?.setAttribute("tabindex", "0");
    }
  }, position);
}

/** Lleva la animación de la franja a una fracción de su recorrido. */
async function seekAnimation(strip: Locator, fraction: number) {
  await strip.evaluate((root, at) => {
    for (const animation of root.getAnimations({ subtree: true })) {
      const { duration } = animation.effect?.getComputedTiming() ?? {};
      if (typeof duration === "number") {
        animation.currentTime = duration * at;
      }
    }
  }, fraction);
}

/** Caja del elemento más el alcance de su aro de foco (ancho + separación). */
async function focusRingBox(item: Locator) {
  return item.evaluate((node) => {
    const { outlineWidth, outlineOffset } = getComputedStyle(node);
    const reach = parseFloat(outlineWidth) + parseFloat(outlineOffset);
    const box = node.getBoundingClientRect();
    return {
      reach,
      left: box.left - reach,
      right: box.right + reach,
    };
  });
}

async function rowBox(page: Page) {
  return rowOf(page).evaluate((node) => {
    const { left, right } = node.getBoundingClientRect();
    return { left, right };
  });
}

/** Píxeles dorados (el color del aro de foco) en una captura PNG. */
async function countGoldPixels(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) return 0;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let gold = 0;
    for (let at = 0; at < data.length; at += 4) {
      if (data[at] > 230 && data[at + 1] > 180 && data[at + 1] < 220 && data[at + 2] < 100) {
        gold += 1;
      }
    }
    return gold;
  }, png.toString("base64"));
}

test.describe("players strip", () => {
  for (const [path, label] of STRIP_LABELS) {
    test(`strip sits right after the hero with the worked-with label at ${path}`, async ({
      page,
    }) => {
      await page.goto(path);

      const next = page.locator(`${HERO} + section`);

      await expect(next).toHaveAccessibleName(label);
      await expect(next.getByRole("list", { name: label })).toBeVisible();

      const caption = next.getByText(label, { exact: true });

      await expect(caption).toHaveCSS("color", GOLD);
      await expect(caption).toHaveCSS("text-transform", "uppercase");
    });
  }

  test("screen readers get each player once", async ({ page }) => {
    await page.goto("/es");

    const list = playerListOf(page);

    // El nombre es el texto propio del item: la inicial de quien no tiene foto
    // es decoración (`aria-hidden`) y no se cuenta.
    expect(await ownTextOf(stripOf(page).getByRole("listitem"))).toEqual(PLAYER_NAMES);
    // Los nombres de jugador no se traducen.
    await expect(list).toHaveAttribute("translate", "no");
    // Fotos locales y decorativas: el nombre ya está al lado.
    await expect(list.locator("img")).toHaveCount(PLAYERS_WITH_PHOTO);
    for (const image of await list.locator("img").all()) {
      await expect(image).toHaveAttribute("alt", "");
    }
    // La foto es opcional: quien no la tiene muestra su inicial, también decorativa.
    for (const [index, item] of (await list.getByRole("listitem").all()).entries()) {
      const { hasPhoto, name } = PLAYERS[index];
      const initial = item.locator("span[aria-hidden='true']");

      await expect(item.locator("img")).toHaveCount(hasPhoto ? 1 : 0);
      await expect(initial).toHaveCount(hasPhoto ? 0 : 1);
      if (!hasPhoto) await expect(initial).toHaveText(name.charAt(0));
    }
  });

  test("loop copies are hidden and not focusable", async ({ page }) => {
    await page.goto("/es");

    const strip = stripOf(page);
    const copy = strip.locator("[inert]");

    await expect(copy).toHaveCount(1);
    await expect(copy).toHaveAttribute("aria-hidden", "true");
    await expect(copy.locator("li")).toHaveCount(PLAYER_NAMES.length);

    await makeItemsFocusable(strip, "first");
    const visibleFirst = playerListOf(page).getByRole("listitem").first();
    const copyFirst = copy.locator("li").first();

    await tabTo(page, visibleFirst);
    await page.keyboard.press("Tab");

    await expect(copyFirst).not.toBeFocused();
    expect(
      await strip.evaluate((root) => root.contains(document.activeElement)),
    ).toBe(false);
  });

  test("pause button stops the motion and is easy to tap", async ({ page }) => {
    await page.goto("/es");

    const strip = stripOf(page);
    const list = playerListOf(page);
    const button = strip.getByRole("button");

    await expect(button).toHaveText("Pausar");
    await expect(button).toHaveAccessibleName("Pausar");
    await expect(button).not.toHaveAttribute("aria-pressed");
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.width).toBeGreaterThanOrEqual(MIN_TARGET_SIZE);
    expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET_SIZE);

    expect(await animationNames(strip)).not.toEqual([]);
    await expectMoving(list);

    await toggleTo(button, "Reanudar");
    // Sin el puntero sobre la fila, lo único que la frena es el botón.
    await page.mouse.move(0, 0);
    await expectStill(list);

    await toggleTo(button, "Pausar");
    await expectMoving(list);
  });

  test("keyboard users can pause and resume with the button", async ({
    page,
  }) => {
    await page.goto("/es");

    const button = stripOf(page).getByRole("button");
    const list = playerListOf(page);
    const pressSpace = () => page.keyboard.press("Space");

    await tabTo(page, button);
    // El foco en el botón no frena nada: si no, no se vería reanudar.
    await expectMoving(list);

    await toggleTo(button, "Reanudar", pressSpace);
    await expectStill(list);

    await toggleTo(button, "Pausar", pressSpace);
    await expect(button).toBeFocused();
    await expectMoving(list);
  });

  test("hover and keyboard focus pause the motion", async ({ page }) => {
    await page.goto("/es");

    const strip = stripOf(page);
    const list = playerListOf(page);
    const viewport = page.viewportSize();

    await strip.scrollIntoViewIfNeeded();
    await expectMoving(list);

    const box = await list.boundingBox();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (!box || !viewport) return;

    await page.mouse.move(viewport.width / 2, box.y + box.height / 2);
    await expectStill(list);

    await page.mouse.move(0, 0);
    await expectMoving(list);

    await makeItemsFocusable(strip, "first");
    const item = list.getByRole("listitem").first();

    await tabTo(page, item);
    await expect(strip.getByRole("button")).toHaveText("Pausar");
    await expectStill(list);
  });

  for (const position of ["first", "last"] as const) {
    test(`keyboard focus shows the ${position} item whole inside the row`, async ({
      page,
    }) => {
      await page.setViewportSize(PHONE_VIEWPORT);
      await page.goto("/es");

      const strip = stripOf(page);
      const list = playerListOf(page);
      const item =
        position === "first"
          ? list.getByRole("listitem").first()
          : list.getByRole("listitem").last();

      await makeItemsFocusable(strip, position);
      // Primero, a mitad del recorrido: fuera de la vista por la izquierda.
      // Último, al principio: fuera de la vista por la derecha.
      await seekAnimation(strip, position === "first" ? 0.5 : 0);

      const before = await focusRingBox(item);
      const row = await rowBox(page);
      const isOutside =
        before.right <= row.left + SUBPIXEL_TOLERANCE ||
        before.left >= row.right - SUBPIXEL_TOLERANCE;
      expect(isOutside).toBe(true);

      await tabTo(page, item);
      await expectStill(list);

      const after = await focusRingBox(item);
      expect(after.reach).toBeGreaterThan(0);
      expect(after.left).toBeGreaterThanOrEqual(row.left - SUBPIXEL_TOLERANCE);
      expect(after.right).toBeLessThanOrEqual(row.right + SUBPIXEL_TOLERANCE);
      // Con el foco del teclado adentro, el fundido de los bordes no lo tapa.
      expect(
        await rowOf(page).evaluate((node) => getComputedStyle(node).maskImage),
      ).toBe("none");
    });
  }

  for (const viewport of [
    { width: PHONE_VIEWPORT.width, height: PHONE_VIEWPORT.height },
    WIDE_VIEWPORT,
  ]) {
    test(`reduced motion starts the strip where its label starts at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize(viewport);
      await page.goto("/es");

      const labelLeft = await stripOf(page)
        .getByText(LABEL_ES, { exact: true })
        .evaluate((node) => node.getBoundingClientRect().left);
      const firstPlayerLeft = await playerListOf(page)
        .getByRole("listitem")
        .first()
        .evaluate((node) => node.getBoundingClientRect().left);

      expect(Math.abs(firstPlayerLeft - labelLeft)).toBeLessThanOrEqual(
        ALIGNMENT_TOLERANCE_PX,
      );
    });
  }

  test("reduced motion keeps the strip still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto("/es");

    const strip = stripOf(page);
    const list = playerListOf(page);
    const row = rowOf(page);

    expect(await animationNames(strip)).toEqual([]);
    await expectStill(list);

    // Sin movimiento no hace falta botón ni copia del loop.
    await expect(strip.getByRole("button")).toBeHidden();
    await expect(strip.locator("[inert]")).toBeHidden();

    // La fila se desliza a mano, también con el teclado.
    await expect(row).toHaveCSS("overflow-x", "auto");
    const before = await row.evaluate((node) => node.scrollLeft);
    await tabTo(page, row);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => row.evaluate((node) => node.scrollLeft))
      .toBeGreaterThan(before);
  });

  for (const viewport of [PHONE_VIEWPORT, WIDE_VIEWPORT]) {
    test(`reduced motion: the focused row shows a whole gold ring and a name at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize(viewport);
      await page.goto("/es");

      const row = rowOf(page);

      // La fila es lo único que el teclado puede enfocar en la franja: tiene
      // que anunciarse con un rol y el nombre de la franja.
      await expect(row).toHaveAttribute("role", "region");
      await expect(row).toHaveAccessibleName(LABEL_ES);
      await expect(
        page.getByRole("region", { name: LABEL_ES }).and(page.locator("[data-direction]")),
      ).toHaveCount(1);

      await tabTo(page, row);

      // El fundido de los bordes no tapa el aro (WCAG 2.4.7).
      await expect(row).toHaveCSS("mask-image", "none");
      const ring = await row.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          style: style.outlineStyle,
          color: style.outlineColor,
          width: parseFloat(style.outlineWidth),
          offset: parseFloat(style.outlineOffset),
        };
      });
      expect(ring.style).not.toBe("none");
      expect(ring.color).toBe(GOLD);
      expect(ring.width).toBeGreaterThanOrEqual(MIN_RING_WIDTH);
      // La fila llega de borde a borde en un celular: el aro va adentro.
      expect(ring.offset + ring.width).toBeLessThanOrEqual(0);

      expect(await countGoldPixels(page, await row.screenshot())).toBeGreaterThan(
        MIN_GOLD_RING_PIXELS,
      );
    });
  }

  test("reduced motion fades only the right edge, so the first player is whole", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(WIDE_VIEWPORT);
    await page.goto("/es");

    const mask = await rowOf(page).evaluate((node) => getComputedStyle(node).maskImage);

    // El primer tramo del degradado es opaco: la izquierda no se atenúa.
    expect(mask).toMatch(/^linear-gradient\(90deg, rgb\(0, 0, 0\)/);
    expect(mask).toMatch(/rgba\(0, 0, 0, 0\)\)$/);
  });

  test("with motion the row is not a region nor a tab stop", async ({ page }) => {
    await page.goto("/es");

    const row = rowOf(page);

    // El botón responde cuando la página ya se hidrató: recién ahí se decide
    // si la fila se vuelve focusable.
    await toggleTo(stripOf(page).getByRole("button"), "Reanudar");
    await expect(row).not.toHaveAttribute("role");
    await expect(row).not.toHaveAttribute("tabindex");
    await expect(row).not.toHaveAttribute("aria-labelledby");
    await expect(page.getByRole("region", { name: LABEL_ES })).toHaveCount(1);
  });

  test("reduced motion: an absolutely positioned child cannot widen the page", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto("/es");

    // Sin la animación, la pista deja de ser el bloque contenedor de lo que
    // se posiciona de forma absoluta: lo tiene que ser la copia.
    const { scrollWidth, clientWidth } = await page.evaluate(() => {
      const copy = document.querySelector("[data-direction] > div > div");
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;left:2000px;width:10px;height:10px";
      copy?.append(probe);
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });

    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
