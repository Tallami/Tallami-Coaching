import { expect, test } from "@playwright/test";
import { FNCS_TITLES } from "../../src/content/results";
import en from "../../messages/en.json" with { type: "json" };
import es from "../../messages/es.json" with { type: "json" };
import pt from "../../messages/pt.json" with { type: "json" };

const SITE_NAME = "Tallami Coaching";
const THEME_COLOR = "#0B1433";
const HERO_PHOTO_WIDTH = "1920";
const HERO_PHOTO_HEIGHT = "1201";

const LOCALES = [
  { path: "/es", messages: es, ogLocale: "es_AR" },
  { path: "/pt", messages: pt, ogLocale: "pt_BR" },
  { path: "/en", messages: en, ogLocale: "en_US" },
] as const;

const FREELANCE = /freelanc/i;

/** La descripción lleva `{count}`: el número sale de `src/content/results.ts`. */
function metaDescription(message: string): string {
  return message.replace("{count}", String(FNCS_TITLES));
}

/** hreflang → final de la URL; el idioma por defecto es `es`. */
const HREFLANG_ALTERNATES = [
  ["es", "/es"],
  ["pt-BR", "/pt"],
  ["en", "/en"],
  ["x-default", "/es"],
] as const;

test.describe("localized metadata", () => {
  for (const { path } of LOCALES) {
    test(`${path} declares canonical and hreflang alternates`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(page.locator("link[rel=canonical]")).toHaveAttribute(
        "href",
        new RegExp(`${path}$`),
      );
      for (const [hreflang, suffix] of HREFLANG_ALTERNATES) {
        await expect(
          page.locator(`link[rel=alternate][hreflang="${hreflang}"]`),
        ).toHaveAttribute("href", new RegExp(`${suffix}$`));
      }
    });
  }

  for (const { path, messages, ogLocale } of LOCALES) {
    test(`${path} has its own title, description and og:locale`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(page).toHaveTitle(messages.Metadata.title);
      await expect(page.locator("meta[name=description]")).toHaveAttribute(
        "content",
        metaDescription(messages.Metadata.description),
      );
      await expect(page.locator("meta[property='og:locale']")).toHaveAttribute(
        "content",
        ogLocale,
      );
    });
  }

  for (const { path } of LOCALES) {
    test(`no text or metadata says freelance at ${path}`, async ({ page }) => {
      await page.goto(path);

      const bodyText = await page.locator("body").innerText();
      const description = await page
        .locator("meta[name=description]")
        .getAttribute("content");

      expect(bodyText).not.toMatch(FREELANCE);
      expect(description ?? "").not.toMatch(FREELANCE);
      await expect(
        page.locator("meta[property='og:description']"),
      ).not.toHaveAttribute("content", FREELANCE);
    });
  }

  test("response headers do not repeat hreflang with other codes", async ({
    request,
  }) => {
    for (const { path } of LOCALES) {
      const response = await request.get(path);

      expect(response.headers()["link"] ?? "").not.toContain("hreflang");
    }
  });

  test("english title differs from the spanish one", async ({ page }) => {
    await page.goto("/es");
    const spanishTitle = await page.title();

    await page.goto("/en");
    const englishTitle = await page.title();

    expect(englishTitle).not.toBe("");
    expect(englishTitle).not.toBe(spanishTitle);
  });

  test("open graph card carries the hero photo with size and alt", async ({
    page,
    request,
  }) => {
    await page.goto("/en");

    const og = (property: string) =>
      page.locator(`meta[property='${property}']`);

    await expect(og("og:type")).toHaveAttribute("content", "website");
    await expect(og("og:site_name")).toHaveAttribute("content", SITE_NAME);
    await expect(og("og:title")).toHaveAttribute("content", en.Metadata.title);
    await expect(og("og:description")).toHaveAttribute(
      "content",
      metaDescription(en.Metadata.description),
    );
    await expect(og("og:image:width")).toHaveAttribute(
      "content",
      HERO_PHOTO_WIDTH,
    );
    await expect(og("og:image:height")).toHaveAttribute(
      "content",
      HERO_PHOTO_HEIGHT,
    );
    await expect(og("og:image:alt")).toHaveAttribute(
      "content",
      en.Hero.imageAlt,
    );

    // La URL es absoluta contra SITE_URL; se pide por la ruta al servidor de prueba.
    const imageUrl = await og("og:image").getAttribute("content");
    const response = await request.get(new URL(imageUrl ?? "").pathname);

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/");
  });

  test("theme color matches the stage background", async ({ page }) => {
    await page.goto("/es");

    await expect(page.locator("meta[name=theme-color]")).toHaveAttribute(
      "content",
      THEME_COLOR,
    );
  });
});

test.describe("crawler files", () => {
  test("sitemap lists the three locales with hreflang alternates", async ({
    request,
  }) => {
    const response = await request.get("/sitemap.xml");

    expect(response.status()).toBe(200);
    const xml = await response.text();

    for (const { path } of LOCALES) {
      expect(xml).toMatch(new RegExp(`<loc>[^<]+${path}</loc>`));
    }
    for (const [hreflang, suffix] of HREFLANG_ALTERNATES) {
      expect(xml).toMatch(
        new RegExp(`hreflang="${hreflang}"\\s+href="[^"]+${suffix}"`),
      );
    }
  });

  test("robots allows the public site, closes the admin panel and points to the sitemap", async ({
    request,
  }) => {
    const response = await request.get("/robots.txt");

    expect(response.status()).toBe(200);
    const text = await response.text();

    expect(text).toMatch(/User-Agent: \*/i);
    expect(text).toMatch(/Allow: \//i);
    // Solo el panel está cerrado: un `Disallow: /` a secas bloquearía todo el sitio.
    expect(text).not.toMatch(/^Disallow: \/\s*$/im);
    expect(text).toMatch(/^Disallow: \/admin\s*$/im);
    expect(text).toMatch(/Sitemap: \S+\/sitemap\.xml/i);
  });
});
