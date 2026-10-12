import { expect, test } from "@playwright/test";

const ROOT_REDIRECTS = [
  ["pt-BR", "/pt"],
  ["es-MX", "/es"],
  ["en-US", "/en"],
  ["fr-FR", "/es"],
] as const;

const HTML_LANGS = [
  ["/es", "es"],
  ["/pt", "pt-BR"],
  ["/en", "en"],
] as const;

const NOT_FOUND_PAGES = [
  {
    path: "/es/no-existe",
    title: "No encontramos esta página",
    back: "Volver al inicio",
    home: "/es",
  },
  {
    path: "/pt/nao-existe",
    title: "Não encontramos esta página",
    back: "Voltar ao início",
    home: "/pt",
  },
  {
    path: "/en/missing",
    title: "We couldn't find this page",
    back: "Back to home",
    home: "/en",
  },
] as const;

for (const [browserLocale, path] of ROOT_REDIRECTS) {
  test.describe(`browser in ${browserLocale}`, () => {
    test.use({ locale: browserLocale });

    test(`root redirects ${browserLocale} visitors to ${path}`, async ({
      page,
    }) => {
      await page.goto("/");

      await expect(page).toHaveURL(new RegExp(`${path}$`));
    });
  });
}

for (const [path, lang] of HTML_LANGS) {
  test(`html lang matches the locale at ${path}`, async ({ page }) => {
    await page.goto(path);

    await expect(page.locator("html")).toHaveAttribute("lang", lang);
  });
}

for (const { path, title, back, home } of NOT_FOUND_PAGES) {
  test(`unknown path ${path} shows the localized 404`, async ({ page }) => {
    const response = await page.goto(path);

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: back })).toHaveAttribute(
      "href",
      home,
    );
  });
}

test.describe("unsupported locale prefix", () => {
  test.use({ locale: "fr-FR" });

  test("ends in the Spanish 404", async ({ page }) => {
    const response = await page.goto("/fr");

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "No encontramos esta página",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Volver al inicio" }),
    ).toHaveAttribute("href", "/es");
  });
});
