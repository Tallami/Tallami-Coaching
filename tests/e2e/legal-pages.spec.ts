import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PRIVACY } from "../../src/content/legal/privacy";
import { REFUNDS } from "../../src/content/legal/refunds";
import { TERMS } from "../../src/content/legal/terms";
import en from "../../messages/en.json" with { type: "json" };
import es from "../../messages/es.json" with { type: "json" };
import pt from "../../messages/pt.json" with { type: "json" };

// Términos, reembolsos y privacidad en los tres idiomas: responden, se indexan con su propio título,
// están en el sitemap y se llega a ellas desde el pie y desde la pantalla de confirmación. También
// las preguntas frecuentes nuevas y lo que la portada ya no promete.

const LOCALES = ["es", "pt", "en"] as const;
const CATALOGS = { es, pt, en } as const;
const PAGES = [
  { path: "terminos", key: "terms", documents: TERMS },
  { path: "reembolsos", key: "refunds", documents: REFUNDS },
  { path: "privacidad", key: "privacy", documents: PRIVACY },
] as const;
const HREFLANGS = [
  ["es", "es"],
  ["pt-BR", "pt"],
  ["en", "en"],
  ["x-default", "es"],
] as const;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const SEVERE = new Set(["serious", "critical"]);
const SITE_NAME = "Tallami Coaching";

/** Las preguntas frecuentes de `/es`, en el orden y con el texto del diseño. */
const SPANISH_FAQ = [
  ["¿Cómo compro?", "Elegís el servicio y entrás con Discord o Google. Confirmás el precio y pagás en Mercado Pago. Tu compra aparece en el Portal de alumnos cuando se confirma el pago."],
  ["¿Qué pasa después de pagar?", "Te escribo por el chat de tu portal para coordinar. Todo lo que te entrego queda guardado ahí."],
  ["¿Cómo pago desde mi país?", "Por ahora se paga con Mercado Pago, desde Argentina. Si estás en otro país, escribime y vemos cómo hacerlo."],
  ["¿Por qué veo dólares y pesos?", "El precio se fija en dólares. En Argentina pagás en pesos y ves el monto exacto antes de confirmar."],
  ["¿Puedo entrenar si tengo menos de 18 años?", "Sí, desde los 13. El pago lo hace un adulto responsable, y la sesión es con vos."],
  ["¿Cómo agendo la sesión?", "Coordinamos día y hora por el chat de tu portal. Para hablar en vivo te paso mi Discord."],
  ["¿Qué te mando para un VOD review?", "Si es offline, pegás los códigos de replay en tu compra, en el portal, y veo las partidas en el juego. Si es en vivo, las vemos juntos en la sesión."],
  ["¿Cuándo recibo mi VOD review?", "El de 3 partidas, en 72 horas desde que me pasás los códigos. El de torneo completo, en 96 horas. El video queda en tu portal."],
  ["¿Y si no puedo ir a la sesión?", "Avisame con 24 horas y la cambiamos sin costo. Si no avisás y pasan 15 minutos del inicio, la sesión cuenta como usada. Si el que falta soy yo, elegís otra fecha o te devuelvo todo."],
  ["¿Me puedo arrepentir de la compra?", "Sí. Tenés 10 días desde la compra para pedir el reembolso, salvo que ya te haya entregado el servicio. Usá el Botón de arrepentimiento, al pie de la página. Te devuelvo por Mercado Pago lo que pagaste en pesos."],
  ["¿Me garantizás resultados?", "No. Te doy análisis y un plan de trabajo, pero el resultado depende de tu juego y de cada torneo. Los resultados de esta web son de jugadores con los que trabajé."],
  ["¿Cómo entro a la Temporada Pro?", "Mandás una aplicación corta y hablamos. Si encajamos, te paso un link de pago."],
  ["¿Cómo te contacto?", "Desde el formulario de contacto, de lunes a viernes de 10 a 18, hora de Argentina."],
] as const;

async function blockingViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return results.violations.filter(({ impact }) => SEVERE.has(impact ?? "")).map(({ id }) => id);
}

for (const locale of LOCALES) {
  for (const { path, documents } of PAGES) {
    const document = documents[locale];

    test(`/${locale}/${path} answers 200, with its own title, its sections, its date and its canonical`, async ({ page }) => {
      const response = await page.goto(`/${locale}/${path}`);

      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle(`${document.title} · ${SITE_NAME}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(document.title);
      await expect(page.locator(`main time[datetime="${document.updatedOn}"]`)).toBeVisible();
      await expect(page.locator("main section h2")).toHaveText(document.sections.map(({ heading }) => new RegExp(`${escapeRegExp(heading)}$`)));
      await expect(page.locator("meta[name=description]")).toHaveAttribute("content", document.description);
      // Se indexa: nada de `noindex`, y su canonical y sus idiomas son los de esta página.
      await expect(page.locator("meta[name=robots]")).toHaveCount(0);
      await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", new RegExp(`/${locale}/${path}$`));
      for (const [hreflang, target] of HREFLANGS) {
        await expect(page.locator(`link[rel=alternate][hreflang="${hreflang}"]`)).toHaveAttribute("href", new RegExp(`/${target}/${path}$`));
      }
    });

    test(`/${locale}/${path} has no serious or critical axe violations on a phone`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 900 });
      await page.goto(`/${locale}/${path}`);
      expect(await blockingViolations(page)).toEqual([]);
    });
  }

  test(`the footer of /${locale} links the three legal pages`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const footer = page.getByRole("contentinfo");

    for (const { path, key } of PAGES) {
      await expect(footer.getByRole("link", { name: CATALOGS[locale].Footer[key], exact: true })).toHaveAttribute("href", `/${locale}/${path}`);
    }
  });
}

test("the legal pages are prerendered, like the rest of the public site", async ({ request }) => {
  for (const { path } of PAGES) {
    const response = await request.get(`/es/${path}`);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["x-nextjs-prerender"], path).toContain("1");
  }
});

test("the legal pages have no serious axe violations on a wide screen, and no horizontal scroll at 320px", async ({ page }) => {
  for (const { path } of PAGES) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/es/${path}`);
    expect(await blockingViolations(page), path).toEqual([]);

    await page.setViewportSize({ width: 320, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test("the index of a legal page takes you to each section", async ({ page }) => {
  await page.goto("/es/terminos");
  const index = page.getByRole("navigation", { name: es.Legal.contents });
  const last = TERMS.es.sections.at(-1)?.heading ?? "";

  await expect(index.getByRole("link")).toHaveCount(TERMS.es.sections.length);
  await index.getByRole("link", { name: last }).click();
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(`${escapeRegExp(last)}$`) })).toBeInViewport();
});

test("the purchase screen links the three legal pages, and each one opens", async ({ page }) => {
  for (const { path, documents } of PAGES) {
    await page.goto("/es/comprar/vod-3-partidas");
    const legal = page.getByRole("navigation", { name: es.Checkout.legal.label });
    const link = legal.getByRole("link", { name: es.Checkout.legal[PAGES.find((entry) => entry.path === path)?.key ?? "terms"], exact: true });

    await expect(link).toHaveAttribute("href", `/es/${path}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/es/${path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(documents.es.title);
  }
});

test("the sitemap lists the three legal pages in the three languages, with their alternates", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();

  for (const { path } of PAGES) {
    for (const locale of LOCALES) {
      expect(xml).toMatch(new RegExp(`<loc>[^<]+/${locale}/${path}</loc>`));
    }
    for (const [hreflang, target] of HREFLANGS) {
      expect(xml).toMatch(new RegExp(`hreflang="${hreflang}"\\s+href="[^"]+/${target}/${path}"`));
    }
  }
});

test("the FAQ of /es has the thirteen questions of the design, in order", async ({ page }) => {
  await page.goto("/es");
  const items = page.locator("#faq details");

  await expect(items).toHaveCount(SPANISH_FAQ.length);
  await expect(items.locator("summary")).toHaveText(SPANISH_FAQ.map(([question]) => question));
  await expect(items.locator("p")).toHaveText(SPANISH_FAQ.map(([, answer]) => answer));
});

test("/es no longer promises Pix, PayPal, crypto, a Discord role or a booking link", async ({ page }) => {
  await page.goto("/es");
  // `textContent` también lee las respuestas cerradas de las preguntas frecuentes.
  const text = (await page.locator("body").textContent()) ?? "";

  for (const promise of [/\bPix\b/, /PayPal/, /\bcripto\b/i, /rol en Discord/, /link que te llega/]) {
    expect(text).not.toMatch(promise);
  }
  await expect(page.locator("#services")).toContainText(es.Services.payments);
});

test("the privacy checkbox of the Temporada Pro application links the privacy policy", async ({ page }) => {
  for (const locale of LOCALES) {
    await page.goto(`/${locale}/temporada-pro`);
    await expect(page.getByRole("link", { name: CATALOGS[locale].Pro.form.privacyLink, exact: true })).toHaveAttribute("href", `/${locale}/privacidad`);
  }
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
