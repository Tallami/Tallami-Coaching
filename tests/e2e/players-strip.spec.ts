import { expect, test, type Locator, type Page } from "@playwright/test";

const GOLD = "rgb(255, 201, 60)";
const HERO = "section[aria-labelledby='hero-title']";
const LABEL_ES = "Trabajé con";

const STRIP_LABELS = [
  ["/es", "Trabajé con"],
  ["/pt", "Trabalhei com"],
  ["/en", "Worked with"],
] as const;

/** Mismo orden que `PLAYERS` en `src/content/players.ts`. */
const PLAYER_NAMES = [
  "K1ng",
  "Fazer",
  "Phzin",
  "Randu",
  "Lewa",
  "Romero",
  "Edson",
  "Tisco",
  "Diguera",
  "Mack",
  "Vadeal",
];

const PHONE_VIEWPORT = { width: 375, height: 812 };
const MIN_TARGET_SIZE = 44;
/** Intervalo corto y acotado para comprobar que la fila no se mueve. */
const STILL_INTERVAL_MS = 500;
/** Menos de medio píxel: lo que Chrome puede variar al redondear sin moverse. */
const STILL_TOLERANCE_PX = 0.5;
const MOVING_TIMEOUT_MS = 3_000;
const MAX_TAB_PRESSES = 20;
const SUBPIXEL_TOLERANCE = 0.01;

function stripOf(page: Page, label: string = LABEL_ES): Locator {
  return page.getByRole("region", { name: label });
}

function playerListOf(page: Page): Locator {
  return stripOf(page).getByRole("list", { name: LABEL_ES });
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

    await expect(stripOf(page).getByRole("listitem")).toHaveText(PLAYER_NAMES);
    // Los nombres de jugador no se traducen.
    await expect(list).toHaveAttribute("translate", "no");
    // Fotos locales y decorativas: el nombre ya está al lado.
    await expect(list.locator("img")).toHaveCount(PLAYER_NAMES.length);
    for (const image of await list.locator("img").all()) {
      await expect(image).toHaveAttribute("alt", "");
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
});
