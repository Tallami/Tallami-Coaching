// Interés por servicio, lado público: los botones de reserva avisan con un
// beacon anónimo y siguen siendo enlaces normales; `/api/interest` valida y
// limita. Qué queda guardado y cómo se ve en el panel lo prueba
// `admin-services.spec.ts`. Cada test navega con su propia IP (`test` de
// `helpers/admin`), así el límite por minuto no se pisa entre tests en paralelo.

import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../helpers/admin";
import { whenInteractive } from "../helpers/admin-ui";
import { INTEREST_PATH as ENDPOINT, watchBeacons } from "../helpers/beacons";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Los cinco botones del menú, en el orden de la pizarra. Temporada Pro lo prueba `admin-services.spec.ts`. */
const MENU_ITEMS = ["vodRecorded", "vodLive", "lesson", "gamePlan", "tournament"] as const;
const LOCALES = ["es", "pt", "en"] as const;

const bodyOf = (item: string, locale: string) => JSON.stringify({ item, locale });

function menuLink(page: Page, index: number) {
  return page.locator("#services li").nth(index).getByRole("link");
}

test.describe("the service buttons of the public site", () => {
  for (const locale of LOCALES) {
    test(`clicking Reservar on a service sends one beacon and still goes to #services (${locale})`, async ({
      page,
      context,
    }) => {
      const watch = await watchBeacons(page);
      await page.goto(`/${locale}`);
      await page.waitForLoadState("networkidle");
      // Cargar la página no manda nada.
      expect(watch.requests(), "nothing is sent on load").toEqual([]);
      const cookiesOnLoad = await context.cookies();

      for (const [index, item] of MENU_ITEMS.entries()) {
        const link = menuLink(page, index);
        await whenInteractive(link);
        const answered = page.waitForResponse((response) => new URL(response.url()).pathname === ENDPOINT);

        await link.click();

        const response = await answered;
        expect(response.status(), item).toBe(204);
        expect(response.headers()["set-cookie"], item).toBeUndefined();
        await expect(page).toHaveURL(new RegExp(`/${locale}#services$`));
      }
      // Cinco botones, cinco clics, cinco avisos con su servicio e idioma: ni uno más.
      await expect
        .poll(() => watch.bodies())
        .toEqual(MENU_ITEMS.map((item) => bodyOf(item, locale)));
      expect(watch.requests()).toHaveLength(MENU_ITEMS.length);
      // El aviso no deja cookies (las que ya tenía la página, como la del idioma, quedan igual).
      expect(await context.cookies()).toEqual(cookiesOnLoad);
    });
  }

  test("the link keeps its href and markup, so it also works for crawlers and assistive tech", async ({ page }) => {
    await page.goto("/es");

    const links = page.locator("#services li a, #services .stage a");
    await expect(links).toHaveCount(6);
    for (const href of await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))) {
      expect(href).toBe("#services");
    }
    // Un enlace común: sin `role=button`, sin `onclick` en el HTML ni `aria-` agregado.
    const extra = await links.evaluateAll((nodes) =>
      nodes.flatMap((node) => node.getAttributeNames().filter((name) => /^(on|role|aria-|target|rel)/.test(name))),
    );
    expect(extra).toEqual([]);
  });

  test("ctrl+click opens the link in a new tab like any link, and still counts as interest", async ({
    page,
    context,
  }) => {
    const watch = await watchBeacons(page);
    await page.goto("/es");
    const link = menuLink(page, 2);
    await whenInteractive(link);

    const [opened] = await Promise.all([context.waitForEvent("page"), link.click({ modifiers: ["Control"] })]);

    await expect(opened).toHaveURL(/\/es#services$/);
    // La pestaña de origen no se movió.
    expect(new URL(page.url()).hash).toBe("");
    await expect.poll(() => watch.bodies()).toEqual([bodyOf("lesson", "es")]);
    expect(watch.requests()).toHaveLength(1);
  });

  test("a middle click opens a new tab and counts once", async ({ page, context }) => {
    const watch = await watchBeacons(page);
    await page.goto("/pt");
    const link = menuLink(page, 3);
    await whenInteractive(link);

    const [opened] = await Promise.all([context.waitForEvent("page"), link.click({ button: "middle" })]);

    await expect(opened).toHaveURL(/\/pt#services$/);
    expect(new URL(page.url()).hash).toBe("");
    await expect.poll(() => watch.bodies()).toEqual([bodyOf("gamePlan", "pt")]);
    expect(watch.requests()).toHaveLength(1);
  });

  test("the keyboard works: Enter on a focused button follows the link and counts once", async ({ page }) => {
    const watch = await watchBeacons(page);
    await page.goto("/en");
    const link = menuLink(page, 4);
    await whenInteractive(link);

    await link.focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/en#services$/);
    await expect.poll(() => watch.bodies()).toEqual([bodyOf("tournament", "en")]);
    expect(watch.requests()).toHaveLength(1);
  });

  test("without sendBeacon the fetch fallback sends the same JSON click and the server accepts it", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "sendBeacon", { value: undefined, configurable: true });
    });
    await page.goto("/pt");
    const link = menuLink(page, 1);
    await whenInteractive(link);
    const sent = page.waitForRequest((request) => new URL(request.url()).pathname === ENDPOINT);
    const answered = page.waitForResponse((response) => new URL(response.url()).pathname === ENDPOINT);

    await link.click();

    const request = await sent;
    expect(request.method()).toBe("POST");
    expect(request.headers()["content-type"]).toBe("application/json");
    expect(request.postData()).toBe(bodyOf("vodLive", "pt"));
    expect((await answered).status()).toBe(204);
    await expect(page).toHaveURL(/\/pt#services$/);
  });

  test("a click that cannot reach the server still follows the link", async ({ page }) => {
    await page.route(`**${ENDPOINT}`, (route) => route.abort());
    await page.goto("/es");
    const link = menuLink(page, 0);
    await whenInteractive(link);

    await link.click();

    await expect(page).toHaveURL(/\/es#services$/);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the link still goes to #services", async ({ page }) => {
      const watch = await watchBeacons(page);
      await page.goto("/es");

      await menuLink(page, 1).click();

      await expect(page).toHaveURL(/\/es#services$/);
      expect(watch.requests()).toEqual([]);
    });
  });
});

test.describe("public pages stay static", () => {
  test("loading a page and scrolling it never calls the API", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) calls.push(request.url());
    });

    for (const locale of LOCALES) {
      await page.goto(`/${locale}`);
      await page.waitForLoadState("networkidle");
      await page.mouse.wheel(0, 4000);
    }

    expect(calls).toEqual([]);
  });

  test("/es, /pt and /en are still prerendered and served from the static cache", async ({ request }) => {
    for (const locale of LOCALES) {
      const response = await request.get(`/${locale}`);
      const headers = response.headers();

      expect(response.status(), locale).toBe(200);
      // Lo que Next manda de una página prerenderizada: servida del cache, con vencimiento de un día.
      // (Next repite este encabezado: "1, 1".)
      expect(headers["x-nextjs-prerender"], `/${locale}`).toContain("1");
      expect(headers["x-nextjs-cache"], `/${locale}`).toMatch(/^(HIT|STALE)$/);
      expect(headers["cache-control"], `/${locale}`).toContain("s-maxage=86400");
    }
  });
});

test.describe("POST /api/interest", () => {
  const post = (request: APIRequestContext, body: unknown, headers: Record<string, string> = {}) =>
    request.post(ENDPOINT, {
      headers: { "user-agent": BROWSER_USER_AGENT, "content-type": "application/json", ...headers },
      data: typeof body === "string" ? body : JSON.stringify(body),
    });

  test("accepts a valid click with 204, an empty body and no caching", async ({ request }) => {
    const response = await post(request, { item: "vodLive", locale: "es" }, { "x-vercel-ip-country": "AR" });

    expect(response.status()).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["set-cookie"]).toBeUndefined();
  });

  test("rejects what is not a click with 400, without echoing it", async ({ request }) => {
    const bad = [
      { item: "other", locale: "es" },
      { item: "coaching-vip-eco", locale: "es" },
      { item: "lesson", locale: "fr" },
      { item: "lesson" },
      { item: "lesson", locale: "es", extra: 1 },
      "esto-no-es-json-eco",
      "[]",
      "",
    ];
    for (const body of bad) {
      const response = await post(request, body);
      expect(response.status(), JSON.stringify(body)).toBe(400);
      expect(response.headers()["cache-control"]).toBe("no-store");
      const text = await response.text();
      expect(text).not.toContain("eco");
    }
  });

  test("accepts application/json with a charset, and refuses any other content-type with 415", async ({ request }) => {
    const body = JSON.stringify({ item: "lesson", locale: "es" });

    const withCharset = await post(request, body, { "content-type": "application/json; charset=utf-8" });
    expect(withCharset.status()).toBe(204);

    // Lo único que un POST entre sitios sin CORS puede mandar: texto plano, formulario o multipart.
    for (const contentType of ["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded"]) {
      const response = await post(request, body, { "content-type": contentType });
      expect(response.status(), contentType).toBe(415);
      expect(response.headers()["cache-control"]).toBe("no-store");
      expect(await response.json()).toEqual({ error: "unsupported_media_type" });
    }
  });

  test("refuses a body over the size limit with 413", async ({ request }) => {
    const response = await post(request, JSON.stringify({ item: "lesson", locale: "es", pad: "x".repeat(5000) }));

    expect(response.status()).toBe(413);
  });

  test("answers 405 to any other method", async ({ request }) => {
    for (const method of ["get", "put", "patch", "delete"] as const) {
      const response = await request[method](ENDPOINT, { headers: { "user-agent": BROWSER_USER_AGENT } });
      expect(response.status(), method).toBe(405);
    }
  });

  test("answers bots with the same 204", async ({ request }) => {
    const response = await post(
      request,
      { item: "lesson", locale: "es" },
      { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
    );

    expect(response.status()).toBe(204);
  });

  test("an IPv6 visitor is one /64: rotating the last 64 bits does not escape the limit", async ({ request }) => {
    const group = () => Math.floor(Math.random() * 0xffff).toString(16);
    const prefix = `2001:db8:${group()}:${group()}`;
    const statuses: number[] = [];
    for (let index = 1; index <= 32; index += 1) {
      const suffix = (index + 0x100).toString(16);
      const response = await post(
        request,
        { item: "vodRecorded", locale: "es" },
        { "x-forwarded-for": `${prefix}:${suffix}:${suffix}:${suffix}:${suffix}` },
      );
      statuses.push(response.status());
    }

    expect(statuses.slice(0, 30).every((status) => status === 204)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
  });

  test("limits a burst: 30 clicks a minute per ip, then 429", async ({ request }) => {
    const statuses: number[] = [];
    for (let index = 0; index < 32; index += 1) {
      statuses.push((await post(request, { item: "gamePlan", locale: "es" })).status());
    }

    expect(statuses.slice(0, 30).every((status) => status === 204)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429]);
  });
});
