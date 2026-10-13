import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

const LOCALES = ["es", "pt", "en"] as const;
/** Nombre accesible de la navegación principal en cada idioma. */
const MAIN_NAV_LABELS = {
  es: "Principal",
  pt: "Principal",
  en: "Main",
} as const;
const SCROLL_WIDTHS = [320, 375, 768, 1024, 1440] as const;
const AXE_WIDTHS = [375, 1440] as const;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = ["serious", "critical"];
const VIEWPORT_HEIGHT = 900;
const PHONE_WIDTH = 375;
const MAX_TAB_PRESSES = 12;
const SUBPIXEL_TOLERANCE = 0.01;
/** Chrome redondea a píxel entero el final del scroll: el último link puede pasarse hasta 0,5 px. */
const SCROLL_END_TOLERANCE = 0.5;
/** Punto de toque dentro del link, lejos del borde, visible aun en el último. */
const NAV_LINK_TAP_INSET = 8;

async function openHome(page: Page, locale: string, width: number) {
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
  await page.goto(`/${locale}`);
  await page.evaluate(() => document.fonts.ready);
}

/** Violaciones serias o críticas de axe en la página abierta (mismos tags en todos los tests). */
async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

  return results.violations
    .filter(({ impact }) => impact && BLOCKING_IMPACTS.includes(impact))
    .map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      targets: nodes.map(({ target }) => target),
    }));
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

/**
 * El aro de foco (ancho + separación) tiene que entrar entero en el contenedor
 * con scroll, que recorta lo que sobresale de su borde.
 */
async function expectOutlineInside(link: Locator, scroller: Locator) {
  const reach = await link.evaluate((node) => {
    const { outlineWidth, outlineOffset } = getComputedStyle(node);
    return parseFloat(outlineWidth) + parseFloat(outlineOffset);
  });
  const linkBox = await link.boundingBox();
  const scrollerBox = await scroller.boundingBox();

  expect(reach).toBeGreaterThan(0);
  expect(linkBox).not.toBeNull();
  expect(scrollerBox).not.toBeNull();
  if (!linkBox || !scrollerBox) return;

  expect(linkBox.x - reach).toBeGreaterThanOrEqual(
    scrollerBox.x - SUBPIXEL_TOLERANCE,
  );
  expect(linkBox.y - reach).toBeGreaterThanOrEqual(
    scrollerBox.y - SUBPIXEL_TOLERANCE,
  );
  expect(linkBox.x + linkBox.width + reach).toBeLessThanOrEqual(
    scrollerBox.x + scrollerBox.width + SCROLL_END_TOLERANCE,
  );
  expect(linkBox.y + linkBox.height + reach).toBeLessThanOrEqual(
    scrollerBox.y + scrollerBox.height + SUBPIXEL_TOLERANCE,
  );
}

/**
 * Las verificaciones de abajo miran la página completa: este test asegura que
 * la franja de jugadores y el muro de Reviews están en ella (sin tarjetas, el
 * muro no existe y las verificaciones no lo cubrirían en silencio).
 */
test.describe("page under test", () => {
  for (const locale of LOCALES) {
    test(`includes the players strip and the reviews wall at /${locale}`, async ({
      page,
    }) => {
      await openHome(page, locale, PHONE_WIDTH);

      await expect(
        page.locator("section[aria-labelledby='players-label']"),
      ).toBeVisible();
      await expect(page.locator("#reviews")).toBeVisible();
      await expect(
        page.locator("#reviews [data-direction]").first().getByRole("link").first(),
      ).toBeAttached();
    });
  }
});

test.describe("responsive layout", () => {
  for (const locale of LOCALES) {
    for (const width of SCROLL_WIDTHS) {
      test(`no horizontal scroll on /${locale} at ${width}px`, async ({
        page,
      }) => {
        await openHome(page, locale, width);

        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));

        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      });
    }
  }
});

test.describe("accessibility", () => {
  for (const locale of LOCALES) {
    for (const width of AXE_WIDTHS) {
      test(`no serious or critical axe violations on /${locale} at ${width}px`, async ({
        page,
      }) => {
        await openHome(page, locale, width);

        expect(await blockingViolations(page)).toEqual([]);
      });
    }
  }

  // Con "reducir movimiento" las filas se vuelven focusables y se anuncian como
  // grupos (ver `MarqueeRow`): otro DOM y otros estilos que revisar.
  test("no serious or critical axe violations on /es at 375px with reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openHome(page, "es", PHONE_WIDTH);
    // La fila de la franja de jugadores se vuelve focusable al hidratar la
    // página: se espera a que lo sea para revisar el DOM final.
    await expect(
      page.locator("section[aria-labelledby='players-label'] [data-direction]"),
    ).toHaveAttribute("tabindex", "0");

    expect(await blockingViolations(page)).toEqual([]);
  });

  test("skip link is the first focusable element and moves focus to main", async ({
    page,
  }) => {
    await page.goto("/es");

    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Saltar al contenido" }),
    ).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#contenido$/);

    // El foco secuencial arranca en `main`: el próximo Tab cae en la portada,
    // no de vuelta en el encabezado.
    await page.keyboard.press("Tab");
    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: "Ver servicios y precios" }),
    ).toBeFocused();
  });

  test("focus outline of the first mobile nav link is not clipped", async ({
    page,
  }) => {
    await openHome(page, "es", PHONE_WIDTH);

    const nav = page.getByRole("navigation", { name: "Principal" });
    const firstLink = nav.getByRole("link").first();

    await tabTo(page, firstLink);
    await expectOutlineInside(firstLink, nav.getByRole("list"));
  });

  for (const locale of LOCALES) {
    test(`last mobile nav link shows its focus outline in full at /${locale}`, async ({
      page,
    }) => {
      await openHome(page, locale, PHONE_WIDTH);

      const nav = page.getByRole("navigation", {
        name: MAIN_NAV_LABELS[locale],
      });
      const scroller = nav.getByRole("list");
      const lastLink = nav.getByRole("link").last();

      await tabTo(page, lastLink);

      // El fundido del borde derecho tapa lo que queda debajo: mientras la
      // lista tiene foco no puede haber máscara.
      expect(
        await scroller.evaluate((list) => getComputedStyle(list).maskImage),
      ).toBe("none");
      await expectOutlineInside(lastLink, scroller);
    });
  }

  test("header controls above the scrollable nav keep their bottom edge tappable", async ({
    page,
  }) => {
    await openHome(page, "es", PHONE_WIDTH);

    const header = page.getByRole("banner");
    const controls = [
      header.getByRole("link", { name: "Tallami." }),
      header.getByRole("navigation", { name: "Idioma" }).getByRole("link"),
      header.getByRole("link", { name: "Reservar", exact: true }),
    ];

    for (const control of controls) {
      for (const element of await control.all()) {
        // El padding de la lista con scroll se monta sobre la fila de arriba:
        // un toque en el borde de abajo del control tiene que llegar al control.
        const isBottomEdgeReachable = await element.evaluate((node) => {
          const { x, width, bottom } = node.getBoundingClientRect();
          const hit = document.elementFromPoint(x + width / 2, bottom - 2);
          return hit !== null && node.contains(hit);
        });

        expect(isBottomEdgeReachable).toBe(true);
      }
    }
  });

  test("every mobile nav link receives taps inside the padded scroller", async ({
    page,
  }) => {
    await openHome(page, "es", PHONE_WIDTH);

    const links = page
      .getByRole("navigation", { name: "Principal" })
      .getByRole("link");

    await expect(links).toHaveCount(5);
    for (const link of await links.all()) {
      const isReachable = await link.evaluate((node, inset) => {
        // Con cinco links, los últimos quedan pasando el borde de la pantalla
        // hasta que la lista se desplaza: se llevan a la vista antes de tocar.
        node.scrollIntoView({
          inline: "nearest",
          block: "nearest",
          behavior: "instant",
        });
        const { x, y, height } = node.getBoundingClientRect();
        const hit = document.elementFromPoint(x + inset, y + height / 2);
        return hit !== null && node.contains(hit);
      }, NAV_LINK_TAP_INSET);

      expect(isReachable).toBe(true);
    }
  });
});
