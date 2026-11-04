// Los pesos por dólar que carga Tallami en el panel y los dos precios de la
// portada. El servidor es compartido y los tests corren en paralelo: todo test
// que necesita un valor guarda siempre el mismo (1500), así no se pisan.

import type { Page } from "@playwright/test";
import { expect, loginAsAdmin, test } from "../helpers/admin";

const SHARED_RATE = "1500";

async function saveRate(page: Page, rate: string): Promise<void> {
  await loginAsAdmin(page);
  await page.goto("/admin/configuracion");
  await page.getByLabel("Valor en pesos").fill(rate);
  await page.getByRole("button", { name: "Guardar pesos por dólar" }).click();
  await expect(page).toHaveURL(/pesos=guardado/);
}

test.describe("pesos por dólar", () => {
  test("saving 1500 in the panel shows the peso prices on the home, in each language", async ({ page }) => {
    await saveRate(page, SHARED_RATE);

    // El caché se invalida con la acción: la portada ya muestra el valor.
    await expect
      .poll(async () => {
        await page.goto("/es");
        return page.getByTestId("price-ars").first().textContent();
      })
      .toBe("ARS 45.000");

    const ars = page.getByTestId("price-ars");
    await expect(ars).toHaveCount(5);
    await expect(page.locator("#services li").first().getByTestId("price-ars")).toHaveText("ARS 45.000");
    await expect(page.locator("#services .stage").getByTestId("price-ars")).toHaveText("ARS 3.750.000");

    await page.goto("/en");
    await expect(page.locator("#services li").first().getByTestId("price-ars")).toHaveText("ARS 45,000");
    await expect(page.locator("#services .stage").getByTestId("price-ars")).toHaveText("ARS 3,750,000");
  });

  test("the peso price is as big as the dollar price", async ({ page }) => {
    await saveRate(page, SHARED_RATE);
    await expect
      .poll(async () => {
        await page.goto("/es");
        return page.getByTestId("price-ars").count();
      })
      .toBe(5);

    const sizes = await page.locator("#services").evaluate((section) =>
      [...section.querySelectorAll('[data-testid="price"]')].map((usd) => {
        const ars = usd.parentElement!.querySelector('[data-testid="price-ars"]')!;
        return [getComputedStyle(usd).fontSize, getComputedStyle(ars).fontSize];
      }),
    );

    expect(sizes).toHaveLength(5);
    for (const [usd, ars] of sizes) expect(ars).toBe(usd);
  });

  test("an invalid value is refused with a message and saves nothing", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/configuracion");
    await page.getByLabel("Valor en pesos").fill("abc");
    await page.getByRole("button", { name: "Guardar pesos por dólar" }).click();

    await expect(page).toHaveURL(/pesos=invalido/);
    await expect(page.getByText("Ese valor no sirve")).toBeVisible();
  });
});
