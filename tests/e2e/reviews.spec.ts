import { expect, test, type Locator, type Page } from "@playwright/test";
import { TWEET_IDS } from "../../src/content/tweets";
import {
  COACH_HANDLE,
  idsNewestFirst,
  readFixture,
} from "../helpers/tweet-fixtures";

const GOLD = "rgb(255, 201, 60)";
const MENTION_BLUE = "rgb(157, 178, 255)";
/** Nombre accesible de cada tarjeta: empieza con `Reviews.cardLabel` (es). */
const CARD_NAME = /^Tweet de .+ en X/;
const STATUS_URL = /^https:\/\/x\.com\/\w+\/status\/(\d+)$/;
/** Un @usuario en el texto de un tweet (no el medio de un mail). */
const MENTION = /(?<![\w@])@\w+/g;

/**
 * Orden del muro con las copias guardadas de `src/content/tweet-snapshots`: del
 * más nuevo al más viejo, los pares arriba y los impares abajo. Sale de los
 * mismos archivos que lee la web, así que sumar un tweet no obliga a tocar
 * esta lista.
 */
const NEWEST_FIRST = idsNewestFirst(TWEET_IDS);
const TOP_ROW_IDS = NEWEST_FIRST.filter((_, index) => index % 2 === 0);
const BOTTOM_ROW_IDS = NEWEST_FIRST.filter((_, index) => index % 2 === 1);

const NEWEST_TWEET = readFixture(NEWEST_FIRST[0]);
const NEWEST_MENTIONS = NEWEST_TWEET.text.match(MENTION) ?? [];
const COACH_MENTION = NEWEST_MENTIONS.find(
  (mention) => mention.toLowerCase() === `@${COACH_HANDLE}`,
);
/** Otra mención que no sea el coach ni el autor (el encabezado de la tarjeta ya muestra su usuario). */
const OTHER_MENTION = NEWEST_MENTIONS.find((mention) =>
  ![COACH_HANDLE, NEWEST_TWEET.user.screen_name].some(
    (handle) => mention.toLowerCase() === `@${handle.toLowerCase()}`,
  ),
);
/** El primer tweet del muro que trae foto: su tarjeta lleva avatar y foto. */
const PHOTO_TWEET_ID = NEWEST_FIRST.find(
  (id) => (readFixture(id).photos ?? []).length > 0,
);

/**
 * Un emoji de cada tipo, con el tweet grabado de donde sale: el más nuevo
 * (🥲, un emoji reciente) y el de Tisco (🇦🇷, una bandera). Se identifican por
 * su ID y no por posición, así sumar un tweet más nuevo no rompe el test.
 */
const TWEMOJI_CASES = [
  { tweetId: "2104290558906868129", alt: "🥲", file: "1f972" },
  { tweetId: "1964780083618685407", alt: "🇦🇷", file: "1f1e6-1f1f7" },
] as const;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Lo que X escribe tal cual en el texto: hasta el primer salto de línea, `&` o link. */
function plainTextStart(text: string): string {
  return text.split(/[&\n]|https?:\/\//)[0].trim();
}

const LOCALE_COPY = [
  {
    path: "/es",
    nav: "Principal",
    before: "Resultados",
    after: "Servicios",
    lede: "Tweets de mis jugadores con su puesto y lo que ganaron. Tocá cualquiera para verlo en X.",
  },
  {
    path: "/pt",
    nav: "Principal",
    before: "Resultados",
    after: "Serviços",
    lede: "Tweets dos meus jogadores com a colocação e o que ganharam. Toque em qualquer um para ver no X.",
  },
  {
    path: "/en",
    nav: "Main",
    before: "Results",
    after: "Services",
    lede: "Tweets from my players with their placement and what they won. Tap any one to see it on X.",
  },
] as const;

type Direction = "left" | "right";

const PHONE_VIEWPORT = { width: 375, height: 812 };
const MIN_TARGET_SIZE = 44;
/** Intervalo corto y acotado para comprobar que una fila no se mueve. */
const STILL_INTERVAL_MS = 500;
/** Menos de medio píxel: lo que Chrome puede variar al redondear sin moverse. */
const STILL_TOLERANCE_PX = 0.5;
const MOVING_TIMEOUT_MS = 3_000;
const MAX_TAB_PRESSES = 20;
const SUBPIXEL_TOLERANCE = 0.01;
/** Ancho en que el contenido de la página queda centrado y con márgenes laterales. */
const WIDE_VIEWPORT = { width: 1440, height: 900 };
/** Redondeo de Chrome al ubicar el contenido centrado. */
const ALIGNMENT_TOLERANCE_PX = 1;

function wallOf(page: Page): Locator {
  return page.locator("#reviews");
}

/** Fila visible: el contenedor que recorta el movimiento. */
function rowOf(page: Page, direction: Direction): Locator {
  return wallOf(page).locator(`[data-direction='${direction}']`);
}

/** Lista visible de una fila (la primera; la segunda es la copia del loop). */
function listOf(page: Page, direction: Direction): Locator {
  return rowOf(page, direction).locator("ul").first();
}

/** Tarjetas que lee un lector de pantalla: las copias del loop quedan afuera. */
function cardsOf(page: Page, direction: Direction): Locator {
  return rowOf(page, direction).getByRole("link", { name: CARD_NAME });
}

async function hrefsOf(links: Locator): Promise<(string | null)[]> {
  return links.evaluateAll((anchors) =>
    anchors.map((anchor) => anchor.getAttribute("href")),
  );
}

function idOf(href: string | null): string | undefined {
  return href?.match(STATUS_URL)?.[1];
}

/** Posición horizontal de la lista, medida tras pintar dos cuadros. */
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

async function expectBothStill(page: Page) {
  await expectStill(listOf(page, "left"));
  await expectStill(listOf(page, "right"));
}

async function expectBothMoving(page: Page) {
  await expectMoving(listOf(page, "left"));
  await expectMoving(listOf(page, "right"));
}

/**
 * Activa el botón hasta que su texto pasa a `expected`: una activación antes
 * de que React hidrate la página se pierde, y repetirla no lo alterna dos
 * veces porque solo se vuelve a activar si el texto todavía no cambió.
 */
async function toggleTo(button: Locator, expected: string) {
  await expect(async () => {
    if ((await button.textContent()) !== expected) {
      await button.click();
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

/** Nombres de las animaciones CSS activas dentro del muro. */
async function animationNames(wall: Locator): Promise<string[]> {
  return wall.evaluate((root) =>
    [root, ...root.querySelectorAll("*")]
      .map((node) => getComputedStyle(node).animationName)
      .filter((name) => name !== "none"),
  );
}

/** Lleva todas las animaciones del muro a una fracción de su recorrido. */
async function seekAnimation(wall: Locator, fraction: number) {
  await wall.evaluate((root, at) => {
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
    return { reach, left: box.left - reach, right: box.right + reach };
  });
}

async function rowBox(page: Page, direction: Direction) {
  return rowOf(page, direction).evaluate((node) => {
    const { left, right } = node.getBoundingClientRect();
    return { left, right };
  });
}

test.describe("reviews wall", () => {
  test("reviews sit between results and services in the page", async ({
    page,
  }) => {
    await page.goto("/es");

    const order = await page.evaluate(() => {
      const [results, reviews, services] = ["#results", "#reviews", "#services"]
        .map((selector) => document.querySelector(selector));
      const follows = (from: Element | null, to: Element | null) =>
        Boolean(
          from &&
            to &&
            from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      return {
        resultsBeforeReviews: follows(results, reviews),
        reviewsBeforeServices: follows(reviews, services),
      };
    });

    expect(order).toEqual({
      resultsBeforeReviews: true,
      reviewsBeforeServices: true,
    });
    await expect(
      wallOf(page).getByRole("heading", { level: 2, name: "Reviews" }),
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "Reviews" })).toHaveAttribute(
      "id",
      "reviews",
    );
  });

  for (const copy of LOCALE_COPY) {
    test(`title, lede and nav link are in place at ${copy.path}`, async ({
      page,
    }) => {
      await page.goto(copy.path);

      await expect(
        wallOf(page).getByRole("heading", { level: 2, name: "Reviews" }),
      ).toBeVisible();
      await expect(wallOf(page).getByText(copy.lede, { exact: true })).toBeVisible();

      const links = page
        .getByRole("navigation", { name: copy.nav })
        .getByRole("link");
      const labels = await links.allTextContents();
      const hrefs = await hrefsOf(links);
      const reviews = labels.indexOf("Reviews");

      expect(reviews).toBeGreaterThan(-1);
      expect(hrefs[reviews]).toBe("#reviews");
      expect(labels[reviews - 1]).toBe(copy.before);
      expect(labels[reviews + 1]).toBe(copy.after);
    });
  }

  test("each tweet appears once for screen readers and links to X", async ({
    page,
  }) => {
    await page.goto("/es");

    // Las copias del loop son `aria-hidden`: no cuentan en el árbol de accesibilidad.
    const links = page.getByRole("link", { name: CARD_NAME });
    await expect(links).toHaveCount(TWEET_IDS.length);

    const cards = await links.evaluateAll((anchors) =>
      anchors.map((anchor) => ({
        href: anchor.getAttribute("href"),
        target: anchor.getAttribute("target"),
        rel: anchor.getAttribute("rel"),
      })),
    );
    for (const { href, target, rel } of cards) {
      expect(href).toMatch(STATUS_URL);
      expect(target).toBe("_blank");
      expect(rel).toContain("noopener");
    }
    expect(cards.map(({ href }) => idOf(href)).sort()).toEqual(
      [...TWEET_IDS].sort(),
    );

    // El nombre del link trae el autor y también el texto del tweet.
    await expect(links.first()).toHaveAccessibleName(
      new RegExp(`^Tweet de ${escapeRegExp(NEWEST_TWEET.user.name)} en X`),
    );
    await expect(links.first()).toHaveAccessibleName(
      new RegExp(escapeRegExp(plainTextStart(NEWEST_TWEET.text))),
    );
  });

  test("newest tweet comes first and rows alternate", async ({ page }) => {
    await page.goto("/es");

    const top = (await hrefsOf(cardsOf(page, "left"))).map(idOf);
    const bottom = (await hrefsOf(cardsOf(page, "right"))).map(idOf);

    expect(top[0]).toBe(NEWEST_FIRST[0]);
    expect(top).toEqual(TOP_ROW_IDS);
    expect(bottom).toEqual(BOTTOM_ROW_IDS);
  });

  test("card photos go through the image optimizer, lazily, without alt text", async ({
    page,
  }) => {
    test.skip(!PHOTO_TWEET_ID, "Ningún tweet de la lista trae foto");
    await page.goto("/es");

    // Sin los emojis del texto: son imágenes de Twemoji, con su propio `alt`.
    const images = wallOf(page)
      .locator(`a[href$='/status/${PHOTO_TWEET_ID}']`)
      .first()
      .locator("img:not([src*='/twemoji@'])");

    await expect(images).toHaveCount(2);
    for (const image of await images.all()) {
      await expect(image).toHaveAttribute("alt", "");
      await expect(image).toHaveAttribute(
        "src",
        /^\/_next\/image\?url=https%3A%2F%2Fpbs\.twimg\.com%2F/,
      );
    }
    // El avatar va primero; la foto del tweet carga en diferido.
    await expect(images.nth(1)).toHaveAttribute("loading", "lazy");
  });

  // Los emojis son imágenes de Twemoji (en Windows 10 los nuevos salen como
  // cuadraditos y las banderas como letras). No se espera a que carguen: si la
  // imagen falla, el navegador muestra el `alt`, que es el emoji.
  for (const { tweetId, alt, file } of TWEMOJI_CASES) {
    test(`emoji ${alt} of tweet ${tweetId} is a Twemoji image`, async ({ page }) => {
      await page.goto("/es");

      const card = wallOf(page).locator(`a[href$='/status/${tweetId}']`).first();
      const emoji = card.locator(`img[alt='${alt}']`);

      await expect(emoji).toHaveCount(1);
      await expect(emoji).toHaveAttribute(
        "src",
        new RegExp(`^https://cdn\\.jsdelivr\\.net/gh/jdecked/twemoji@[\\d.]+/assets/svg/${file}\\.svg$`),
      );
      await expect(emoji).toHaveAttribute("loading", "lazy");
      await expect(emoji).toHaveAttribute("draggable", "false");
      // Sigue siendo parte del nombre del link: el lector lee el emoji.
      await expect(card).toHaveAccessibleName(new RegExp(escapeRegExp(alt)));
    });
  }

  test("an emoji image sits inline with the text, a bit taller than the letters", async ({
    page,
  }) => {
    await page.goto("/es");

    const card = wallOf(page)
      .locator(`a[href$='/status/${TWEMOJI_CASES[0].tweetId}']`)
      .first();
    const emoji = card.locator(`img[alt='${TWEMOJI_CASES[0].alt}']`);

    const style = await emoji.evaluate((node) => {
      const { display, verticalAlign, fontSize } = getComputedStyle(node);
      const { width, height } = node.getBoundingClientRect();
      return { display, verticalAlign, fontSize: parseFloat(fontSize), width, height };
    });

    expect(style.display).toBe("inline-block");
    expect(style.width).toBeCloseTo(style.fontSize * 1.15, 1);
    expect(style.height).toBeCloseTo(style.fontSize * 1.15, 1);
    expect(style.verticalAlign).not.toBe("baseline");
  });

  test("coach mention is highlighted in gold", async ({ page }) => {
    await page.goto("/es");

    // El tweet más nuevo es la primera tarjeta; todos etiquetan al coach.
    const card = cardsOf(page, "left").first();

    expect(COACH_MENTION, "el tweet más nuevo etiqueta al coach").toBeDefined();
    const coach = card.getByText(COACH_MENTION ?? "", { exact: true });

    await expect(coach).toHaveCSS("color", GOLD);
    await expect(coach).toHaveCSS("font-weight", "700");

    // Cualquier otra mención va en azul (si el tweet no etiqueta a nadie más, no hay qué mirar).
    if (OTHER_MENTION) {
      await expect(card.getByText(OTHER_MENTION, { exact: true })).toHaveCSS(
        "color",
        MENTION_BLUE,
      );
    }
  });

  test("loop copies are hidden and not focusable", async ({ page }) => {
    await page.goto("/es");

    const wall = wallOf(page);
    const copies = wall.locator("[inert]");

    // Una copia por fila, en el mismo orden que las filas.
    await expect(copies).toHaveCount(2);
    const rowIds = [TOP_ROW_IDS, BOTTOM_ROW_IDS];
    for (const [index, copy] of (await copies.all()).entries()) {
      await expect(copy).toHaveAttribute("aria-hidden", "true");
      await expect(copy.locator("li")).toHaveCount(rowIds[index].length);
    }

    // Tab desde el botón recorre todas las tarjetas visibles y sale del muro
    // sin entrar en ninguna copia.
    await wall.getByRole("button").focus();
    const visited: (string | null)[] = [];
    for (let press = 0; press < TWEET_IDS.length; press += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => ({
        href: document.activeElement?.getAttribute("href") ?? null,
        isInsideCopy: Boolean(document.activeElement?.closest("[inert]")),
      }));
      expect(focused.isInsideCopy).toBe(false);
      visited.push(focused.href);
    }
    expect(visited.map(idOf)).toEqual([...TOP_ROW_IDS, ...BOTTOM_ROW_IDS]);

    await page.keyboard.press("Tab");
    expect(
      await wall.evaluate((root) => root.contains(document.activeElement)),
    ).toBe(false);
  });

  test("pause button stops both rows", async ({ page }) => {
    await page.goto("/es");

    const wall = wallOf(page);
    const button = wall.getByRole("button");

    await expect(button).toHaveText("Pausar");
    await expect(button).toHaveAccessibleName("Pausar");
    await expect(button).not.toHaveAttribute("aria-pressed");
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.width).toBeGreaterThanOrEqual(MIN_TARGET_SIZE);
    expect(box.height).toBeGreaterThanOrEqual(MIN_TARGET_SIZE);

    expect(await animationNames(wall)).not.toEqual([]);
    await expectBothMoving(page);

    await toggleTo(button, "Reanudar");
    // Sin el puntero sobre una fila, lo único que las frena es el botón.
    await page.mouse.move(0, 0);
    await expectBothStill(page);

    await toggleTo(button, "Pausar");
    await expectBothMoving(page);
  });

  test("hovering a row pauses both rows", async ({ page }) => {
    await page.goto("/es");

    await expectBothMoving(page);

    await rowOf(page, "right").hover();
    await expectBothStill(page);

    // Fuera de las filas: el título de la sección.
    await wallOf(page).getByRole("heading", { level: 2 }).hover();
    await expectBothMoving(page);
  });

  test.describe("on a touch screen", () => {
    test.use({ hasTouch: true });

    test("a tap on a row does not leave the wall frozen", async ({ page }) => {
      await page.setViewportSize(PHONE_VIEWPORT);
      await page.goto("/es");

      const wall = wallOf(page);

      // Sin mouse no hay puntero que "salga" de la fila: el `:hover` de un
      // toque queda pegado hasta el próximo, y no puede frenar el muro.
      expect(
        await page.evaluate(() => matchMedia("(hover: hover)").matches),
      ).toBe(false);
      await expectBothMoving(page);

      await wall.scrollIntoViewIfNeeded();
      const box = await rowOf(page, "right").boundingBox();
      expect(box).not.toBeNull();
      if (!box) return;
      // En el borde de arriba de la fila, donde no hay ninguna tarjeta (un
      // toque en una abre X en otra pestaña).
      await page.touchscreen.tap(box.x + box.width / 2, box.y + 2);
      expect(
        await rowOf(page, "right").evaluate((row) => row.matches(":hover")),
      ).toBe(true);

      await expectBothMoving(page);

      // El botón sigue siendo la forma de pausar con el dedo.
      await toggleTo(wall.getByRole("button"), "Reanudar");
      await expectBothStill(page);
    });
  });

  const FOCUS_CASES: { row: Direction; position: "first" | "last"; at: number }[] =
    [
      // Primera tarjeta a mitad de recorrido: fuera de la vista por la izquierda.
      { row: "left", position: "first", at: 0.5 },
      // Última tarjeta al comienzo: fuera de la vista por la derecha.
      { row: "left", position: "last", at: 0 },
      { row: "right", position: "first", at: 0.5 },
      { row: "right", position: "last", at: 0 },
    ];

  for (const { row, position, at } of FOCUS_CASES) {
    test(`keyboard focus pauses the wall and shows the ${position} card of the ${row}-moving row whole`, async ({
      page,
    }) => {
      await page.setViewportSize(PHONE_VIEWPORT);
      await page.goto("/es");

      const wall = wallOf(page);
      const cards = cardsOf(page, row);
      const card = position === "first" ? cards.first() : cards.last();

      await seekAnimation(wall, at);

      const before = await focusRingBox(card);
      const box = await rowBox(page, row);
      const isOutside =
        before.right <= box.left + SUBPIXEL_TOLERANCE ||
        before.left >= box.right - SUBPIXEL_TOLERANCE;
      expect(isOutside).toBe(true);

      await wall.getByRole("button").focus();
      await tabTo(page, card);
      // Frena las dos filas, y el botón sigue diciendo "Pausar": frena el foco.
      await expect(wall.getByRole("button")).toHaveText("Pausar");
      await expectBothStill(page);

      const after = await focusRingBox(card);
      expect(after.reach).toBeGreaterThan(0);
      expect(after.left).toBeGreaterThanOrEqual(box.left - SUBPIXEL_TOLERANCE);
      expect(after.right).toBeLessThanOrEqual(box.right + SUBPIXEL_TOLERANCE);
      // Con el foco del teclado adentro, el fundido de los bordes no la tapa.
      expect(
        await rowOf(page, row).evaluate((node) => getComputedStyle(node).maskImage),
      ).toBe("none");
    });
  }

  for (const viewport of [
    { width: PHONE_VIEWPORT.width, height: PHONE_VIEWPORT.height },
    WIDE_VIEWPORT,
  ]) {
    test(`reduced motion starts each row where the heading starts at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize(viewport);
      await page.goto("/es");

      const headingLeft = await wallOf(page)
        .locator("h2")
        .evaluate((node) => node.getBoundingClientRect().left);

      for (const direction of ["left", "right"] as const) {
        const firstCardLeft = await cardsOf(page, direction)
          .first()
          .evaluate((node) => node.getBoundingClientRect().left);

        expect(Math.abs(firstCardLeft - headingLeft)).toBeLessThanOrEqual(
          ALIGNMENT_TOLERANCE_PX,
        );
      }
    });
  }

  test("reduced motion fades only the right edge, so the first card's avatar is whole", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(WIDE_VIEWPORT);
    await page.goto("/es");

    for (const direction of ["left", "right"] as const) {
      const mask = await rowOf(page, direction).evaluate(
        (node) => getComputedStyle(node).maskImage,
      );

      // El primer tramo del degradado es opaco: la izquierda no se atenúa.
      expect(mask).toMatch(/^linear-gradient\(90deg, rgb\(0, 0, 0\)/);
      expect(mask).toMatch(/rgba\(0, 0, 0, 0\)\)$/);
    }
  });

  test("reduced motion keeps the wall still and scrollable", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto("/es");

    const wall = wallOf(page);

    expect(await animationNames(wall)).toEqual([]);
    await expectBothStill(page);

    // La página no se ensancha: lo que sobra de las filas se desliza adentro de ellas.
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

    // Sin movimiento no hace falta botón ni copias del loop.
    await expect(wall.getByRole("button")).toBeHidden();
    for (const copy of await wall.locator("[inert]").all()) {
      await expect(copy).toBeHidden();
    }

    for (const direction of ["left", "right"] as const) {
      const row = rowOf(page, direction);

      await expect(row).toHaveCSS("overflow-x", "auto");
      // Se desliza a mano.
      expect(
        await row.evaluate((node) => node.scrollWidth > node.clientWidth),
      ).toBe(true);
      expect(
        await row.evaluate((node) => {
          node.scrollLeft = 100;
          return node.scrollLeft;
        }),
      ).toBeGreaterThan(0);
      await row.evaluate((node) => {
        node.scrollLeft = 0;
      });
    }

    // Y con el teclado: la última tarjeta de la fila se desliza hasta verse entera.
    const last = cardsOf(page, "left").last();
    const box = await rowBox(page, "left");

    // Desde la primera tarjeta, para no depender de cuántos Tab hay antes del muro.
    await cardsOf(page, "left").first().focus();
    await tabTo(page, last);

    const ring = await focusRingBox(last);
    expect(
      await rowOf(page, "left").evaluate((node) => node.scrollLeft),
    ).toBeGreaterThan(0);
    expect(ring.left).toBeGreaterThanOrEqual(box.left - SUBPIXEL_TOLERANCE);
    expect(ring.right).toBeLessThanOrEqual(box.right + SUBPIXEL_TOLERANCE);
  });
});
