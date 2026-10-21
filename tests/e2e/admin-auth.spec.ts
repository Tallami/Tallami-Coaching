import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  ADMIN_COOKIE,
  ADMIN_TEST_OLD_PASSWORD_HASH,
  ADMIN_TEST_PASSWORD,
  expect,
  loginAndReadSessionCookie,
  loginAsAdmin,
  signTestToken,
  test,
  uniqueTestIp,
} from "../helpers/admin";

const LOGIN_URL = /\/admin\/login(\?|$)/;
const LOCKED_AFTER = 5;
/** Lo máximo que dura una sesión (y su cookie): 8 horas. */
const SESSION_SECONDS = 8 * 60 * 60;
/** Un endpoint del panel (no una página): el CSV de ventas. */
const EXPORT_PATH = "/admin/ventas/exportar";
/** La línea bajo el título del resumen: solo aparece con la sesión iniciada. */
const PANEL_MARKER = "Cuánto ganás, qué se vende y qué tenés pendiente.";

/** El aviso del formulario (la página tiene otro `role="alert"`: el anunciador de rutas de Next). */
function loginAlert(page: Page) {
  return page.locator("#login-error");
}

/**
 * GET con la dirección tal cual, sin que el cliente la normalice (Playwright
 * resuelve `//admin` como otro sitio y arregla `/a/../b`).
 */
function rawGet(
  baseURL: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  body: string;
  location?: string;
  headers: IncomingHttpHeaders;
}> {
  const { hostname, port } = new URL(baseURL);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path, method: "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
          location: res.headers.location,
          headers: res.headers,
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

async function submitPassword(page: Page, password: string): Promise<void> {
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
}

test.describe("without a session", () => {
  for (const path of ["/admin", "/admin/ventas", "/admin/servicios"]) {
    test(`admin pages redirect to login without a session: ${path}`, async ({
      page,
      request,
    }) => {
      const response = await request.get(path, { maxRedirects: 0 });

      expect(response.status()).toBe(307);
      expect(response.headers().location).toContain(
        `/admin/login?next=${encodeURIComponent(path)}`,
      );

      await page.goto(path);
      await expect(page).toHaveURL(LOGIN_URL);
      await expect(
        page.getByRole("heading", { name: "Panel de Tallami" }),
      ).toBeVisible();
    });
  }

  test("remembers where you were going and goes back there after the login", async ({
    page,
  }) => {
    await page.goto("/admin/ventas?mes=2026-10");

    await expect(page).toHaveURL(/next=%2Fadmin%2Fventas%3Fmes%3D2026-10/);
    await submitPassword(page, ADMIN_TEST_PASSWORD);

    await expect(page).toHaveURL(/\/admin\/ventas\?mes=2026-10$/);
  });

  test("a forged cookie does not open the panel", async ({ context, page, request }) => {
    const forged = {
      "free text": "una-cookie-inventada",
      "signed with another secret": await signTestToken({
        secret: "otro-secreto-que-no-es-el-del-panel-0123456789",
      }),
      "expired": await signTestToken({ expiresInSeconds: -60 }),
      "for another audience": await signTestToken({ audience: "otro-sitio" }),
      "signed with another algorithm": await signTestToken({ alg: "HS512" }),
      // Firmada con el secreto correcto, pero con el claim de otra contraseña: la
      // sesión de antes de que Tallami cambiara la contraseña.
      "from before the password changed": await signTestToken({
        passwordHash: ADMIN_TEST_OLD_PASSWORD_HASH,
      }),
      "from before the password claim existed": await signTestToken({ passwordHash: null }),
      "without a signature": [
        Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url"),
        Buffer.from(
          JSON.stringify({
            aud: "tallami-admin",
            exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
          }),
        ).toString("base64url"),
        "",
      ].join("."),
    };

    for (const [label, value] of Object.entries(forged)) {
      const response = await request.get("/admin", {
        maxRedirects: 0,
        headers: { cookie: `${ADMIN_COOKIE}=${value}` },
      });
      expect(response.status(), label).toBe(307);
      expect(response.headers().location, label).toContain("/admin/login");

      await context.clearCookies();
      await context.addCookies([
        { name: ADMIN_COOKIE, value, domain: "localhost", path: "/admin" },
      ]);
      await page.goto("/admin");
      await expect(page, label).toHaveURL(LOGIN_URL);
      await expect(page.getByText(PANEL_MARKER), label).toHaveCount(0);
    }
  });

  test("the cookie of a real login opens the panel, so the forged ones above fail for the right reason", async ({
    context,
    page,
  }) => {
    const value = await loginAndReadSessionCookie(page);
    // Solo con esa cookie, puesta a mano en un navegador sin nada más.
    await context.clearCookies();
    await context.addCookies([{ name: ADMIN_COOKIE, value, domain: "localhost", path: "/admin" }]);

    await page.goto("/admin");

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(PANEL_MARKER)).toBeVisible();
  });

  test("a well-signed token whose session is not in the database ends at the login", async ({
    context,
    page,
    request,
  }) => {
    // La firma, la audiencia, el vencimiento y la contraseña son buenos: el `proxy` la deja pasar.
    // Lo que la frena es `requireAdmin()`, que no encuentra esa sesión en la base.
    const value = await signTestToken();
    await context.addCookies([{ name: ADMIN_COOKIE, value, domain: "localhost", path: "/admin" }]);

    await page.goto("/admin");
    await expect(page).toHaveURL(LOGIN_URL);
    await expect(page.getByText(PANEL_MARKER)).toHaveCount(0);

    // Lo mismo en una ruta que no es una página.
    const exported = await request.get(EXPORT_PATH, {
      maxRedirects: 0,
      headers: { cookie: `${ADMIN_COOKIE}=${value}` },
    });
    expect(exported.status()).toBe(307);
    expect(exported.headers().location).toContain("/admin/login");
    expect(await exported.text()).not.toContain("Fecha de cobro");
  });

  for (const path of ["/%61dmin", "/%61dmin/ventas", "/admin%2Fventas", "//admin", "/admin/", "/ADMIN"]) {
    test(`another spelling of the panel address does not skip the check: ${path}`, async ({
      baseURL,
    }) => {
      const response = await rawGet(baseURL!, path);

      expect(response.body).not.toContain(PANEL_MARKER);
      expect([307, 308, 404]).toContain(response.status);
    });
  }

  for (const path of ["/admin/x.csv", "/admin/ventas/2026.10.csv", "/admin/clientes/ana.perez"]) {
    test(`panel addresses with a dot are guarded too: ${path}`, async ({ baseURL }) => {
      const response = await rawGet(baseURL!, path);

      expect(response.status).toBe(307);
      expect(response.location).toContain("/admin/login?next=");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-robots-tag"]).toContain("noindex");
      expect(response.body).not.toContain(PANEL_MARKER);
    });
  }

  for (const path of ["/admin.rsc", "/admin/login.segments/_tree.segment.rsc"]) {
    test(`the transport form of a panel address does not skip the proxy: ${path}`, async ({
      baseURL,
    }) => {
      const response = await rawGet(baseURL!, path);

      expect(response.body).not.toContain(PANEL_MARKER);
      expect(response.headers["x-robots-tag"]).toContain("noindex");
    });
  }

  // Solo `.rsc` y `.segments/…/….segment.rsc` son formas de transporte para Next: una dirección
  // que empieza como el login pero no termina así es del panel y pide sesión.
  for (const path of ["/admin/login.segments/lo-que-sea", "/admin/setup.segments/lo-que-sea"]) {
    test(`an address that only looks like a door needs a session: ${path}`, async ({ baseURL }) => {
      const response = await rawGet(baseURL!, path);

      expect(response.status).toBe(307);
      expect(response.location).toContain("/admin/login?next=");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toContain(PANEL_MARKER);
    });
  }

  test("server actions without a valid session answer 401, never data", async ({ request }) => {
    const action = { "next-action": "00deadbeef", "content-type": "text/plain;charset=UTF-8" };

    const anonymous = await request.post("/admin", { headers: action, data: "[]" });
    const forged = await request.post("/admin", {
      headers: { ...action, cookie: `${ADMIN_COOKIE}=falsa` },
      data: "[]",
    });

    expect(anonymous.status()).toBe(401);
    expect(forged.status()).toBe(401);
    expect(await anonymous.text()).toBe("");
  });

  test("/admin/setup sends you to the login when everything is configured", async ({
    page,
  }) => {
    await page.goto("/admin/setup");

    await expect(page).toHaveURL(LOGIN_URL);
  });
});

test.describe("login", () => {
  test("wrong password shows an error and five failures lock the form", async ({
    browser,
    page,
  }) => {
    // Cada intento parte de un formulario limpio: así el aviso que se espera es
    // el de ese intento y no el que quedó del anterior.
    for (let attempt = 1; attempt <= LOCKED_AFTER; attempt += 1) {
      await page.goto("/admin/login");
      await submitPassword(page, `clave-incorrecta-${attempt}`);
      await expect(loginAlert(page)).toHaveText("Contraseña incorrecta.");
      await expect(page).toHaveURL(/error=invalid/);
    }

    // Sexto intento: ni la contraseña correcta entra mientras dura el bloqueo.
    await page.goto("/admin/login");
    await submitPassword(page, ADMIN_TEST_PASSWORD);
    await expect(loginAlert(page)).toContainText("Demasiados intentos");
    await expect(page).toHaveURL(/error=blocked/);
    await page.goto("/admin");
    await expect(page).toHaveURL(LOGIN_URL);

    // El bloqueo es por IP: otra persona (otra IP) sí puede entrar.
    const elsewhere = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() },
    });
    const otherPage = await elsewhere.newPage();
    await loginAsAdmin(otherPage);
    await elsewhere.close();
  });

  test("an ipv6 visitor cannot dodge the lock by changing address inside their /64", async ({
    browser,
  }) => {
    const group = () => Math.floor(Math.random() * 0xffff).toString(16);
    const prefix = `2001:db8:${group()}:${group()}`;

    // Cinco intentos fallidos, cada uno desde otra dirección del mismo /64.
    for (let attempt = 1; attempt <= LOCKED_AFTER; attempt += 1) {
      const context = await browser.newContext({
        extraHTTPHeaders: { "x-forwarded-for": `${prefix}::${attempt}` },
      });
      const page = await context.newPage();
      await page.goto("/admin/login");
      await submitPassword(page, `clave-incorrecta-${attempt}`);
      await expect(loginAlert(page)).toHaveText("Contraseña incorrecta.");
      await context.close();
    }

    // Una dirección más del mismo /64: bloqueada, ni con la contraseña correcta.
    const sameBlock = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": `${prefix}:1234:5678:9abc:def0` },
    });
    const blockedPage = await sameBlock.newPage();
    await blockedPage.goto("/admin/login");
    await submitPassword(blockedPage, ADMIN_TEST_PASSWORD);
    await expect(loginAlert(blockedPage)).toContainText("Demasiados intentos");
    await expect(blockedPage).toHaveURL(/error=blocked/);
    await sameBlock.close();

    // Otro /64 no tiene nada que ver.
    const elsewhere = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": `2001:db8:${group()}:${group()}::1` },
    });
    await loginAsAdmin(await elsewhere.newPage());
    await elsewhere.close();
  });

  test("a wrong password and a blocked ip never say what is configured", async ({ page }) => {
    await page.goto("/admin/login");
    await submitPassword(page, "incorrecta");

    const message = (await loginAlert(page).textContent()) ?? "";
    expect(message).not.toMatch(/hash|secret|variable|env|config/i);
  });

  test("right password opens the panel and logout closes it", async ({ context, page }) => {
    await loginAsAdmin(page);

    await expect(page.getByRole("heading", { name: "Resumen", exact: true })).toBeVisible();
    await expect(page.getByText(PANEL_MARKER)).toBeVisible();

    // Con la sesión iniciada el login no pide la contraseña de nuevo.
    await page.goto("/admin/login");
    await expect(page).toHaveURL(/\/admin$/);

    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(LOGIN_URL);
    expect((await context.cookies()).some(({ name }) => name === ADMIN_COOKIE)).toBe(false);

    await page.goto("/admin");
    await expect(page).toHaveURL(LOGIN_URL);
  });

  test("after Salir the old cookie stops working, even though its signature and expiry are still good", async ({
    context,
    page,
    request,
  }) => {
    const oldCookie = await loginAndReadSessionCookie(page);
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(LOGIN_URL);

    await context.addCookies([{ name: ADMIN_COOKIE, value: oldCookie, domain: "localhost", path: "/admin" }]);
    await page.goto("/admin");
    await expect(page).toHaveURL(LOGIN_URL);
    await expect(page.getByText(PANEL_MARKER)).toHaveCount(0);

    const exported = await request.get(EXPORT_PATH, {
      maxRedirects: 0,
      headers: { cookie: `${ADMIN_COOKIE}=${oldCookie}` },
    });
    expect(exported.status()).toBe(307);
    expect(exported.headers().location).toContain("/admin/login");
  });

  test("cookie is httpOnly, SameSite=Strict and scoped to /admin", async ({ context, page }) => {
    await loginAsAdmin(page);

    const cookie = (await context.cookies()).find(({ name }) => name === ADMIN_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/admin" });
    // Sobre http://localhost no puede llevar Secure (en Vercel siempre lo lleva).
    expect(cookie?.secure).toBe(false);
    const lifetime = (cookie?.expires ?? 0) - Date.now() / 1000;
    expect(lifetime).toBeGreaterThan(SESSION_SECONDS - 120);
    expect(lifetime).toBeLessThanOrEqual(SESSION_SECONDS);

    // JavaScript de la página no la ve, y el sitio público no la recibe.
    expect(await page.evaluate(() => document.cookie)).not.toContain(ADMIN_COOKIE);
    const publicCookies = await context.cookies("http://localhost:3100/es");
    expect(publicCookies.some(({ name }) => name === ADMIN_COOKIE)).toBe(false);
  });

  test("the next parameter only accepts paths inside the panel", async ({ page }) => {
    for (const hostile of ["//evil.example/x", "https://evil.example/", "/es", "/\\evil.example"]) {
      await page.goto(`/admin/login?next=${encodeURIComponent(hostile)}`);
      await submitPassword(page, ADMIN_TEST_PASSWORD);

      await expect(page, hostile).toHaveURL(/^http:\/\/localhost:3100\/admin$/);
      await page.getByRole("button", { name: "Salir" }).click();
      await expect(page).toHaveURL(LOGIN_URL);
    }
  });

  test("the login form is accessible", async ({ page }) => {
    await page.goto("/admin/login");
    await submitPassword(page, "incorrecta");
    await expect(loginAlert(page)).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();

    expect(
      results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((n) => n.target) })),
    ).toEqual([]);
  });
});

test.describe("search engines", () => {
  test("admin pages are noindex and robots.txt disallows /admin", async ({ page, request }) => {
    const response = await page.goto("/admin/login");

    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      /noindex/,
    );

    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toMatch(/^Disallow: \/admin$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).not.toMatch(/^Disallow: \/\s*$/m);
  });
});

test.describe("public pages", () => {
  for (const path of ["/es", "/pt", "/en"]) {
    test(`public pages stay the same: ${path} answers 200 and never links to /admin`, async ({
      page,
    }) => {
      const response = await page.goto(path);

      expect(response?.status()).toBe(200);
      // `headers()` de Playwright no incluye `set-cookie`: hace falta `allHeaders()`.
      const headers = await response!.allHeaders();
      expect(headers["set-cookie"] ?? "").not.toContain(ADMIN_COOKIE);
      await expect(page.locator('a[href*="admin"]')).toHaveCount(0);
      expect(await page.content()).not.toMatch(/href="[^"]*\/admin/);
    });
  }

  test("after logging in, the public pages neither set nor receive the session cookie", async ({
    page,
  }) => {
    // Control: `allHeaders()` sí deja ver la cookie cuando el servidor la manda (el login).
    await page.goto("/admin/login");
    await page.getByLabel("Contraseña").fill(ADMIN_TEST_PASSWORD);
    const [loginResponse] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("/admin/login")),
      page.getByRole("button", { name: "Ingresar" }).click(),
    ]);
    expect((await loginResponse.allHeaders())["set-cookie"] ?? "").toContain(`${ADMIN_COOKIE}=`);
    await expect(page).toHaveURL(/\/admin$/);

    for (const path of ["/es", "/pt", "/en"]) {
      const response = await page.goto(path);

      expect((await response!.allHeaders())["set-cookie"] ?? "", path).not.toContain(ADMIN_COOKIE);
      // La cookie es de `/admin`: el navegador no la manda al sitio público.
      expect((await response!.request().allHeaders()).cookie ?? "", path).not.toContain(ADMIN_COOKIE);
    }
  });

  test("the panel has no language prefix and does not turn into /es/admin", async ({
    request,
  }) => {
    const response = await request.get("/admin/login", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('lang="es"');
  });
});
