import { expect, test } from "@playwright/test";

const GOLD = "rgb(255, 201, 60)";
const ZONE = "rgb(36, 87, 197)";

const HERO_TITLES = [
  ["/es", "Entrená con el coach detrás de 3 títulos de FNCS"],
  ["/pt", "Treine com o coach por trás de 3 títulos da FNCS"],
  ["/en", "Train with the coach behind 3 FNCS titles"],
] as const;

const HERO_ROLES = [
  ["/es", "Coach de Fortnite competitivo, Argentina"],
  ["/pt", "Coach de Fortnite competitivo, Argentina"],
  ["/en", "Competitive Fortnite coach, Argentina"],
] as const;

const LAN_TITLE = "Campeonatos presenciales";

const LAN_ITEMS_ES = [
  "5º Esports World Cup Reload",
  "9º Esports World Cup ESL",
  "11º FNCS Globals 2025",
  "12º FNCS Globals 2025",
  "14º FNCS Globals 2026",
  "22º FNCS Globals 2024",
];

const ONLINE_LISTS = [
  {
    path: "/es",
    title: "Campeonatos online",
    first: ["1º", "FNCS", "CH6S1", "K1ng, Fazer y Phzin"],
    fourth: ["1º", "Reload Elite Series", "Phzin y Edson"],
  },
  {
    path: "/pt",
    title: "Campeonatos online",
    first: ["1º", "FNCS", "CH6S1", "K1ng, Fazer e Phzin"],
    fourth: ["1º", "Reload Elite Series", "Phzin e Edson"],
  },
  {
    path: "/en",
    title: "Online championships",
    first: ["1st", "FNCS", "CH6S1", "K1ng, Fazer, and Phzin"],
    fourth: ["1st", "Reload Elite Series", "Phzin and Edson"],
  },
] as const;

const EARNINGS_TEXTS = ["45.300", "45,300", "CH5S4"] as const;
const LOCALE_PATHS = ["/es", "/pt", "/en"] as const;
const PHONE_VIEWPORT = { width: 375, height: 812 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

test.describe("hero", () => {
  for (const [path, title] of HERO_TITLES) {
    test(`hero headline is localized at ${path}`, async ({ page }) => {
      await page.goto(path);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    });
  }

  test("hero has no results counters", async ({ page }) => {
    await page.goto("/es");

    const hero = page.locator("section[aria-labelledby='hero-title']");

    await expect(
      page.getByRole("group", { name: "Resumen de resultados como coach" }),
    ).toHaveCount(0);
    await expect(hero.locator("strong")).toHaveCount(0);
    await expect(hero).not.toContainText("primeros puestos");
  });

  for (const [path, role] of HERO_ROLES) {
    test(`hero lower third names the role without freelance at ${path}`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(
        page
          .locator("section[aria-labelledby='hero-title']")
          .getByText(role, { exact: true }),
      ).toBeVisible();
    });
  }

  test("hero buttons point to the services and results sections", async ({
    page,
  }) => {
    await page.goto("/es");

    const hero = page.locator("section[aria-labelledby='hero-title']");

    await expect(
      hero.getByRole("link", { name: "Ver servicios y precios" }),
    ).toHaveAttribute("href", "#services");
    await expect(
      hero.getByRole("link", { name: "Ver resultados" }),
    ).toHaveAttribute("href", "#results");
  });

  test("hero photo has localized alt text", async ({ page }) => {
    await page.goto("/en");

    await expect(
      page.getByRole("img", {
        name: "Tallami smiling with headphones on a tournament stage",
      }),
    ).toBeVisible();
  });
});

test.describe("results board", () => {
  test("in-person championships list comes first, ordered by place", async ({
    page,
  }) => {
    await page.goto("/es");

    const results = page.locator("#results");
    const lan = results.getByRole("list", { name: LAN_TITLE });

    await expect(results.locator("h3").first()).toHaveText(LAN_TITLE);
    // Con el espacio entre puesto y torneo: un lector no debería oír "5ºEsports".
    await expect(lan.getByRole("listitem")).toHaveText(LAN_ITEMS_ES);

    await page.goto("/en");

    await expect(
      page.locator("#results").getByRole("heading", {
        level: 3,
        name: "In-person championships",
      }),
    ).toBeVisible();
    await expect(
      page
        .locator("#results")
        .getByRole("list", { name: "In-person championships" })
        .getByRole("listitem")
        .first(),
    ).toHaveText("5th Esports World Cup Reload");
  });

  for (const { path, title, first, fourth } of ONLINE_LISTS) {
    test(`online championships list shows the six wins with players at ${path}`, async ({
      page,
    }) => {
      await page.goto(path);

      const items = page
        .locator("#results")
        .getByRole("list", { name: title })
        .getByRole("listitem");

      await expect(items).toHaveCount(6);
      for (const text of first) {
        await expect(items.first()).toContainText(text);
      }
      for (const text of fourth) {
        await expect(items.nth(3)).toContainText(text);
      }
    });
  }

  for (const path of LOCALE_PATHS) {
    test(`results no longer show the earnings box at ${path}`, async ({
      page,
    }) => {
      await page.goto(path);

      for (const text of EARNINGS_TEXTS) {
        await expect(page.locator("#results")).not.toContainText(text);
      }
    });
  }

  test("player, event and label names opt out of page translation", async ({
    page,
  }) => {
    await page.goto("/es");

    const results = page.locator("#results");
    const firstLan = results
      .getByRole("list", { name: LAN_TITLE })
      .getByRole("listitem")
      .first();
    const firstWin = results
      .getByRole("list", { name: "Campeonatos online" })
      .getByRole("listitem")
      .first();

    // El "y" que une a los jugadores sí se traduce; los nombres no.
    await expect(firstLan.locator("[translate=no]")).toHaveText([
      "Esports World Cup",
      "Reload",
    ]);
    await expect(firstWin.locator("[translate=no]")).toHaveText([
      "FNCS",
      "CH6S1",
      "K1ng",
      "Fazer",
      "Phzin",
    ]);
  });

  test("in-person list sits before the online list on phones", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE_VIEWPORT);
    await page.goto("/es");

    const results = page.locator("#results");
    const lanBox = await results
      .getByRole("list", { name: LAN_TITLE })
      .boundingBox();
    const onlineBox = await results
      .getByRole("list", { name: "Campeonatos online" })
      .boundingBox();

    expect(lanBox).not.toBeNull();
    expect(onlineBox).not.toBeNull();
    if (!lanBox || !onlineBox) return;

    // Una sola columna: presenciales arriba, online debajo.
    expect(lanBox.y).toBeLessThan(onlineBox.y);
    expect(lanBox.x).toBeCloseTo(onlineBox.x, 0);
  });

  test("lists sit side by side on desktop", async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto("/es");

    const results = page.locator("#results");
    const lanBox = await results
      .getByRole("list", { name: LAN_TITLE })
      .boundingBox();
    const onlineBox = await results
      .getByRole("list", { name: "Campeonatos online" })
      .boundingBox();

    expect(lanBox).not.toBeNull();
    expect(onlineBox).not.toBeNull();
    if (!lanBox || !onlineBox) return;

    // Dos columnas: presenciales a la izquierda (más ancha), online a la derecha.
    expect(lanBox.x).toBeLessThan(onlineBox.x);
    expect(lanBox.y).toBeCloseTo(onlineBox.y, 0);
    expect(lanBox.width).toBeGreaterThan(onlineBox.width);
  });
});

test.describe("header", () => {
  test("language switcher moves to the same page in the chosen language", async ({
    page,
  }) => {
    await page.goto("/es");

    const switcher = page.getByRole("navigation", { name: "Idioma" });

    await expect(switcher.getByRole("link", { name: "ES" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await switcher.getByRole("link", { name: "PT" }).click();

    await expect(page).toHaveURL(/\/pt$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Treine com o coach por trás de 3 títulos da FNCS",
    );
    await expect(
      page
        .getByRole("navigation", { name: "Idioma" })
        .getByRole("link", { name: "PT" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("language switcher links carry lang and hreflang", async ({ page }) => {
    await page.goto("/en");

    const switcher = page.getByRole("navigation", { name: "Language" });

    for (const [name, href, lang] of [
      ["ES", "/es", "es"],
      ["PT", "/pt", "pt-BR"],
      ["EN", "/en", "en"],
    ] as const) {
      const link = switcher.getByRole("link", { name, exact: true });

      await expect(link).toHaveAttribute("href", href);
      await expect(link).toHaveAttribute("lang", lang);
      await expect(link).toHaveAttribute("hreflang", lang);
    }
    await expect(switcher.getByRole("link", { name: "EN" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(switcher.getByRole("link", { name: "ES" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  test("main navigation anchors point to the home sections", async ({
    page,
  }) => {
    await page.goto("/es");

    const links = page
      .getByRole("navigation", { name: "Principal" })
      .getByRole("link");

    await expect(links).toHaveText([
      "Resultados",
      "Servicios",
      "Cómo funciona",
      "Preguntas",
    ]);
    const hrefs = await links.evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute("href")),
    );
    expect(hrefs).toEqual(["#results", "#services", "#how-it-works", "#faq"]);
  });

  test("book button and brand link behave per locale", async ({ page }) => {
    await page.goto("/pt");

    await expect(
      page.getByRole("link", { name: "Reservar", exact: true }),
    ).toHaveAttribute("href", "#services");
    await expect(page.getByRole("link", { name: "Tallami." })).toHaveAttribute(
      "href",
      "/pt",
    );
  });
});

test.describe("motion and focus", () => {
  test("lower-third animation is disabled with reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/es");

    await expect(page.getByText("Tomás “Tallami” Allami")).toHaveCSS(
      "animation-name",
      "none",
    );
  });

  test("lower-third animates when motion is allowed", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/es");

    await expect(page.getByText("Tomás “Tallami” Allami")).not.toHaveCSS(
      "animation-name",
      "none",
    );
  });

  test("focus ring is gold on stage surfaces and blue elsewhere", async ({
    page,
  }) => {
    await page.goto("/es");

    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Saltar al contenido" }),
    ).toBeFocused();
    await expect(
      page.getByRole("link", { name: "Saltar al contenido" }),
    ).toHaveCSS("outline-color", ZONE);

    await page.keyboard.press("Tab");
    const brand = page.getByRole("link", { name: "Tallami." });

    await expect(brand).toBeFocused();
    await expect(brand).toHaveCSS("outline-color", GOLD);
    await expect(brand).toHaveCSS("border-top-left-radius", "2px");
  });

  test("hero buttons use the 1rem size and header button the .95rem size", async ({
    page,
  }) => {
    await page.goto("/es");

    await expect(
      page.getByRole("link", { name: "Ver servicios y precios" }),
    ).toHaveCSS("font-size", "16px");
    await expect(
      page.getByRole("link", { name: "Reservar", exact: true }),
    ).toHaveCSS("font-size", "15.2px");
  });
});
