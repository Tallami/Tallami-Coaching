import { expect, test } from "@playwright/test";

/**
 * Los tres íconos que el navegador pide: el vector (`icon.svg`), el `.ico` de
 * siempre (buscadores, navegadores viejos) y el de la pantalla de inicio de iOS.
 * Se prueba lo que la página enlaza, que es lo que sigue un navegador.
 */
const ICON_LINKS = [
  {
    name: "SVG icon",
    selector: "link[rel='icon'][type='image/svg+xml']",
    contentType: /^image\/svg\+xml/,
  },
  {
    name: "favicon.ico",
    selector: "link[rel='icon'][href^='/favicon.ico']",
    contentType: /^image\/(x-icon|vnd\.microsoft\.icon)/,
  },
  {
    name: "apple touch icon",
    selector: "link[rel='apple-touch-icon']",
    contentType: /^image\/png/,
  },
] as const;

/** Pedidos directos que no pasan por la página: lo que hacen buscadores y herramientas. */
const DIRECT_PATHS = [
  { path: "/favicon.ico", contentType: /^image\/(x-icon|vnd\.microsoft\.icon)/ },
  { path: "/icon.svg", contentType: /^image\/svg\+xml/ },
  { path: "/apple-icon.png", contentType: /^image\/png/ },
] as const;

test.describe("app icons", () => {
  for (const { name, selector, contentType } of ICON_LINKS) {
    test(`/es links the ${name} and it is served`, async ({ page, request }) => {
      await page.goto("/es");

      const link = page.locator(selector);
      await expect(link).toHaveCount(1);

      const href = await link.getAttribute("href");
      expect(href).not.toBeNull();
      const response = await request.get(href ?? "");

      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toMatch(contentType);
      expect((await response.body()).length).toBeGreaterThan(0);
    });
  }

  test("the apple touch icon announces its 180x180 size", async ({ page }) => {
    await page.goto("/es");

    await expect(page.locator("link[rel='apple-touch-icon']")).toHaveAttribute(
      "sizes",
      "180x180",
    );
  });

  for (const { path, contentType } of DIRECT_PATHS) {
    test(`GET ${path} answers 200 with the right type`, async ({ request }) => {
      const response = await request.get(path);

      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toMatch(contentType);
    });
  }
});
