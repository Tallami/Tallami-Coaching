import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  ADMIN_COOKIE,
  ADMIN_TEST_PASSWORD,
  expect,
  loginAsAdmin,
  signTestToken,
  test,
  uniqueTestIp,
} from "../helpers/admin";

const LOGIN_URL = /\/admin\/login(\?|$)/;
const LOCKED_AFTER = 5;
const SESSION_SECONDS = 12 * 60 * 60;
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

  test("a valid token opens the panel, so the forged ones above fail for the right reason", async ({
    context,
    page,
  }) => {
    await context.addCookies([
      {
        name: ADMIN_COOKIE,
        value: await signTestToken(),
        domain: "localhost",
        path: "/admin",
      },
    ]);

    await page.goto("/admin");

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByText(PANEL_MARKER)).toBeVisible();
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
      expect(response?.headers()["set-cookie"]).toBeUndefined();
      await expect(page.locator('a[href*="admin"]')).toHaveCount(0);
      expect(await page.content()).not.toMatch(/href="[^"]*\/admin/);
    });
  }

  test("the panel has no language prefix and does not turn into /es/admin", async ({
    request,
  }) => {
    const response = await request.get("/admin/login", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(await response.text()).toContain('lang="es"');
  });
});
