import { expect, test } from "@playwright/test";
import { SOCIAL_LINKS } from "../../src/content/social";

const STAGE_BACKGROUND = "rgb(11, 20, 51)";
const GOLD = "rgb(255, 201, 60)";
const ZONE = "rgb(36, 87, 197)";

/** Precios del CLAUDE.md en el orden del menú; Temporada Pro va última. */
const SERVICE_PRICE_STARTS = [
  /^USD 30\b/,
  /^USD 45\b/,
  /^USD 40\b/,
  /^USD 120\b/,
  /^USD 150\b/,
];

/** Temporada Pro: precio fijo por equipo; el separador de miles cambia en inglés. */
const PRO_PRICE_START = {
  es: /^USD 2\.500\b/,
  pt: /^USD 2\.500\b/,
  en: /^USD 2,500\b/,
} as const;

function priceStarts(locale: keyof typeof PRO_PRICE_START): RegExp[] {
  return [...SERVICE_PRICE_STARTS, PRO_PRICE_START[locale]];
}

const BOOKING_LINK_NAME = /^(Reservar|Pedir mi plan|Aplicar a Temporada Pro)/;

const LOCALIZED_SERVICES = [
  {
    path: "/pt",
    locale: "pt",
    texts: [
      "por dupla ou trio",
      "por equipe, toda a temporada",
      "Pacote de 4 aulas: USD 140, você economiza USD 20.",
      "Tem menos de 18 anos?",
    ],
  },
  {
    path: "/en",
    locale: "en",
    texts: [
      "per duo or trio",
      "per team, for the whole season",
      "Pack of 4 lessons: USD 140, you save USD 20.",
      "Under 18?",
    ],
  },
] as const;

const LOCALE_PATHS = ["/es", "/pt", "/en"] as const;

const EPIC_NOTICES = [
  ["/es", "No afiliado ni respaldado por Epic Games."],
  ["/pt", "Não afiliado nem endossado pela Epic Games."],
  ["/en", "Not affiliated with or endorsed by Epic Games."],
] as const;

const MINORS_QUESTION = "¿Puedo entrenar si tengo menos de 18 años?";
const MINORS_ANSWER =
  "Sí. El pago lo hace un adulto responsable, y la sesión es con vos.";

function columnCount(gridTemplateColumns: string): number {
  return gridTemplateColumns.split(" ").length;
}

test.describe("services menu", () => {
  test("services list five prices and the pro season last", async ({
    page,
  }) => {
    await page.goto("/es");

    const prices = page.locator("#services [data-testid=price]");

    await expect(prices).toHaveText(priceStarts("es"));
    await expect(prices).toHaveCount(6);
    // Sin porcentaje de premios en ninguna parte de la pizarra.
    await expect(page.locator("#services")).not.toContainText("%");

    await page.goto("/en");
    await expect(
      page.locator("#services [data-testid=price]").last(),
    ).toHaveText(/^USD 2,500\b/);
  });

  for (const path of LOCALE_PATHS) {
    test(`no page offers Academia Tallami at ${path}`, async ({ page }) => {
      await page.goto(path);

      await expect(page.locator("body")).not.toContainText("Academia Tallami");
    });
  }

  test("price units and lesson pack are shown", async ({ page }) => {
    await page.goto("/es");

    const services = page.locator("#services");

    for (const text of [
      "por dúo o trío",
      "por equipo, toda la temporada",
      "Pack de 4 clases: USD 140, ahorrás USD 20.",
    ]) {
      await expect(services).toContainText(text);
    }
  });

  test("pro season shows the team unit and the faq answer", async ({ page }) => {
    await page.goto("/es");

    const card = page.locator("#services .stage");

    await expect(card).toContainText("por equipo, toda la temporada");
    await expect(card).toContainText(
      "Coaching para tu dúo o trío durante toda la temporada. Se entra por aplicación.",
    );

    await page
      .locator("#faq summary", { hasText: "¿Cómo entro a la Temporada Pro?" })
      .click();
    await expect(
      page.getByText(
        "Mandás una aplicación. Si quedás, son USD 2.500 por equipo por toda la temporada.",
        { exact: true },
      ),
    ).toBeVisible();
  });

  test("minors note sits next to prices", async ({ page }) => {
    await page.goto("/es");

    await expect(page.locator("#services")).toContainText(
      "¿Tenés menos de 18 años?",
    );
  });

  test("booking links stay inside the services section until payments exist", async ({
    page,
  }) => {
    await page.goto("/es");

    const links = page
      .locator("#services")
      .getByRole("link", { name: BOOKING_LINK_NAME });

    await expect(links).toHaveCount(6);
    const hrefs = await links.evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute("href")),
    );
    for (const href of hrefs) {
      expect(href).toMatch(/#services$/);
    }
  });

  test("Temporada Pro is a dark card and the last item", async ({ page }) => {
    await page.goto("/es");

    const card = page.locator("#services .stage");

    await expect(card).toHaveCount(1);
    await expect(card).toHaveCSS("background-color", STAGE_BACKGROUND);
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(
      "Temporada Pro",
    );
    await expect(card.locator("[data-testid=price]")).toHaveText(
      PRO_PRICE_START.es,
    );
    await expect(
      page.locator("#services [data-testid=price]").last(),
    ).toHaveText(PRO_PRICE_START.es);
  });

  test("service buttons show their focus ring at once, blue on paper and gold on the Pro card", async ({
    page,
  }) => {
    await page.goto("/es");
    await page.keyboard.press("Tab");

    const ringRightAfterFocus = (selector: string) =>
      page.locator(selector).first().evaluate((element) => {
        (element as HTMLElement).focus();
        return getComputedStyle(element).outlineColor;
      });

    // Sin transición de `outline-color`: el anillo no nace del color del texto.
    expect(await ringRightAfterFocus("#services ul li:first-child a")).toBe(
      ZONE,
    );
    expect(await ringRightAfterFocus("#services .stage a")).toBe(GOLD);
  });

  for (const { path, locale, texts } of LOCALIZED_SERVICES) {
    test(`units, pack and minors note are localized at ${path}`, async ({
      page,
    }) => {
      await page.goto(path);

      for (const text of texts) {
        await expect(page.locator("#services")).toContainText(text);
      }
      await expect(
        page.locator("#services [data-testid=price]"),
      ).toHaveText(priceStarts(locale));
    });
  }

  test("intro column is sticky on desktop and static on tablet", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/es");

    const intro = page
      .locator("#services")
      .getByRole("heading", { level: 2 })
      .locator("..");

    await expect(intro).toHaveCSS("position", "sticky");

    await page.setViewportSize({ width: 900, height: 900 });
    await expect(intro).toHaveCSS("position", "static");
  });
});

test.describe("how it works", () => {
  test("how it works has four steps", async ({ page }) => {
    await page.goto("/es");

    const steps = page.locator("#how-it-works ol > li");

    await expect(steps).toHaveCount(4);
    await expect(steps.getByRole("heading", { level: 3 })).toHaveText([
      "Elegís el servicio",
      "Pagás",
      "Agendás",
      "Entrenás",
    ]);
  });

  test("steps run in 4 columns, then 2 at 900px, then 1 at 640px", async ({
    page,
  }) => {
    await page.goto("/es");
    const route = page.locator("#how-it-works ol");

    for (const [width, columns] of [
      [1440, 4],
      [901, 4],
      [900, 2],
      [641, 2],
      [640, 1],
      [375, 1],
    ] as const) {
      await page.setViewportSize({ width, height: 900 });
      const template = await route.evaluate(
        (element) => getComputedStyle(element).gridTemplateColumns,
      );
      expect(columnCount(template), `${width}px`).toBe(columns);
    }
  });
});

test.describe("faq", () => {
  test("faq answers open with the keyboard", async ({ page }) => {
    await page.goto("/es");

    const summary = page.locator("#faq summary", { hasText: MINORS_QUESTION });
    const answer = page.getByText(MINORS_ANSWER, { exact: true });

    await expect(answer).toBeHidden();
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(answer).toBeVisible();

    await page.keyboard.press("Space");
    await expect(answer).toBeHidden();
  });

  test("faq lists four native details, closed by default", async ({ page }) => {
    await page.goto("/es");

    const items = page.locator("#faq details");

    await expect(items).toHaveCount(4);
    await expect(page.locator("#faq details[open]")).toHaveCount(0);
  });

  test("Temporada Pro answer takes the price from the data", async ({
    page,
  }) => {
    await page.goto("/en");

    const summary = page.locator("#faq summary", {
      hasText: "How do I join Temporada Pro?",
    });

    await summary.click();
    await expect(
      page.getByText(
        "If you're accepted, it's USD 2,500 per team for the whole season.",
      ),
    ).toBeVisible();
  });
});

test.describe("footer", () => {
  test("footer shows social links and the Epic disclaimer per locale", async ({
    page,
  }) => {
    for (const [path, notice] of EPIC_NOTICES) {
      await page.goto(path);

      const footer = page.getByRole("contentinfo");
      const links = footer.getByRole("link");

      await expect(footer).toContainText(notice);
      await expect(links).toHaveCount(SOCIAL_LINKS.length);
      await expect(links).toHaveText(SOCIAL_LINKS.map(({ label }) => label));
      const hrefs = await links.evaluateAll((anchors) =>
        anchors.map((anchor) => anchor.getAttribute("href")),
      );
      expect(hrefs, path).toEqual(SOCIAL_LINKS.map(({ href }) => href));
    }
  });

  test("footer is a dark surface outside main", async ({ page }) => {
    await page.goto("/es");

    await expect(page.locator("main footer")).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toHaveCSS(
      "background-color",
      STAGE_BACKGROUND,
    );
  });
});
