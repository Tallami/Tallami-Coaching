import { expect, test } from "@playwright/test";

const GOLD = "rgb(255, 201, 60)";
const ZONE = "rgb(36, 87, 197)";

const HERO_TITLES = [
  ["/es", "Entrená con el coach detrás de 3 títulos de FNCS"],
  ["/pt", "Treine com o coach por trás de 3 títulos da FNCS"],
  ["/en", "Train with the coach behind 3 FNCS titles"],
] as const;

const FIRST_WIN_ROWS = [
  {
    path: "/es",
    cells: ["1º", "FNCS", "CH6S1", "K1ng, Fazer y Phzin"],
  },
  {
    path: "/pt",
    cells: ["1º", "FNCS", "CH6S1", "K1ng, Fazer e Phzin"],
  },
  {
    path: "/en",
    cells: ["1st", "FNCS", "CH6S1", "K1ng, Fazer, and Phzin"],
  },
] as const;

const OTHER_RESULTS_AND_EARNINGS = [
  {
    path: "/es",
    place: "22º",
    amount: "USD 45.300",
    sentence: "en ganancias de coaching registradas desde CH5S4",
  },
  {
    path: "/pt",
    place: "22º",
    amount: "USD 45.300",
    sentence: "em ganhos de coaching registrados desde CH5S4",
  },
  {
    path: "/en",
    place: "22nd",
    amount: "USD 45,300",
    sentence: "in recorded coaching earnings since CH5S4",
  },
] as const;

test.describe("hero", () => {
  for (const [path, title] of HERO_TITLES) {
    test(`hero headline is localized at ${path}`, async ({ page }) => {
      await page.goto(path);

      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    });
  }

  test("hero counters show FNCS titles and first places", async ({ page }) => {
    await page.goto("/es");

    const group = page.getByRole("group", {
      name: "Resumen de resultados como coach",
    });
    const titles = group.locator("div").filter({ hasText: "títulos de FNCS" });
    const firstPlaces = group
      .locator("div")
      .filter({ hasText: "primeros puestos" });

    await expect(titles.locator("strong")).toHaveText("3");
    await expect(firstPlaces.locator("strong")).toHaveText("6");
  });

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
  for (const { path, cells } of FIRST_WIN_ROWS) {
    test(`lists six first places with players joined for ${path}`, async ({
      page,
    }) => {
      await page.goto(path);

      const rows = page.locator("#results table tbody tr");

      await expect(rows).toHaveCount(6);
      for (const cell of cells) {
        await expect(rows.first()).toContainText(cell);
      }
    });
  }

  test("table has three column headers on desktop", async ({ page }) => {
    await page.goto("/es");

    await expect(
      page.locator("#results").getByRole("columnheader"),
    ).toHaveText(["Puesto", "Torneo", "Jugadores"]);
  });

  for (const { path, place, amount, sentence } of OTHER_RESULTS_AND_EARNINGS) {
    test(`other results and earnings are formatted for ${path}`, async ({
      page,
    }) => {
      await page.goto(path);

      const results = page.locator("#results");
      const others = results.getByRole("list");

      await expect(others.getByRole("listitem")).toHaveCount(6);
      await expect(others).toContainText(place);
      await expect(others).toContainText("Globals");
      await expect(results.locator("strong", { hasText: "USD" })).toHaveText(
        amount,
      );
      await expect(results).toContainText(sentence);
    });
  }

  test("results table stacks into a grid on phone width", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/es");

    const firstRow = page.locator("#results table tbody tr").first();

    await expect(firstRow).toHaveCSS("display", "grid");
    await expect(page.locator("#results table thead")).toBeHidden();
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
