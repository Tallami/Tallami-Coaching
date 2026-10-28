import { randomUUID } from "node:crypto";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { ADMIN_COOKIE, expect, loginAndReadSessionCookie, test } from "../helpers/admin";

// El ingreso de los alumnos con el proveedor de prueba: el servidor OAuth falso de
// `tests/helpers/mock-oauth-server.mjs` (puerto 3110), que vuelve enseguida con un
// código. Todavía no hay página del portal (la arma la Tarea 5): los tests miran
// a dónde vuelve el ingreso y qué cookies quedan, no lo que muestra la página.

const STUDENT_COOKIE = "tallami_alumno";
const FLOW_COOKIE = "tallami_alumno_oauth";
const FAILED = "ingreso=fallido";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;
const URL_SAFE_32_BYTES = /^[A-Za-z0-9_-]{43}$/;

/** Un alumno nuevo del proveedor de prueba por test: los tests corren en paralelo sobre la misma base. */
function uniqueStudent(): string {
  return `alumno-${randomUUID().slice(0, 8)}`;
}

interface SignInOptions {
  locale?: string;
  student?: string;
  /** El alumno dice que no en el proveedor (`error=access_denied`). */
  deny?: boolean;
}

/**
 * Empieza el ingreso con el proveedor de prueba desde `request` (que guarda la
 * cookie del flujo) y devuelve la dirección de autorización, con el alumno elegido.
 */
async function startSignIn(
  request: APIRequestContext,
  { locale = "es", student = uniqueStudent(), deny = false }: SignInOptions = {},
): Promise<URL> {
  const response = await request.get(`/api/portal/auth/test?locale=${locale}`, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  const authorize = new URL(response.headers().location);
  authorize.searchParams.set("login_hint", student);
  if (deny) authorize.searchParams.set("deny", "1");
  return authorize;
}

/** Pasa por el proveedor de prueba y devuelve la dirección de vuelta a la que manda, sin seguirla. */
async function callbackUrlFrom(request: APIRequestContext, authorize: URL): Promise<string> {
  const response = await request.get(authorize.toString(), { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  return response.headers().location;
}

async function cookieNamed(context: BrowserContext, name: string) {
  return (await context.cookies()).find((cookie) => cookie.name === name);
}

/** Entra con el proveedor de prueba en el navegador de `page`, como un alumno de verdad. */
async function signInInBrowser(page: Page, options: SignInOptions = {}): Promise<void> {
  const authorize = await startSignIn(page.request, options);
  await page.goto(authorize.toString());
  await expect(page).toHaveURL(new RegExp(`/${options.locale ?? "es"}/portal$`));
}

test.describe("students sign in with the test provider", () => {
  test("the sign-in ends at /es/portal with the student cookie: httpOnly, SameSite=Lax, the whole site, 30 days", async ({
    page,
    context,
  }) => {
    await signInInBrowser(page);

    const session = await cookieNamed(context, STUDENT_COOKIE);
    expect(session).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", secure: false });
    expect(session?.value).toMatch(URL_SAFE_32_BYTES);
    expect(session?.expires ?? 0).toBeGreaterThan(Date.now() / 1000 + THIRTY_DAYS_SECONDS - 60);
    // La cookie del flujo es de un solo uso: la vuelta la borra.
    expect(await cookieNamed(context, FLOW_COOKIE)).toBeUndefined();
  });

  test("it comes back in the language it started in", async ({ page }) => {
    await signInInBrowser(page, { locale: "pt" });
  });

  test("the start sends the browser to the provider with state and PKCE, and keeps them in a short cookie of its own", async ({
    page,
    context,
    baseURL,
  }) => {
    const response = await page.request.get("/api/portal/auth/test?locale=es", { maxRedirects: 0 });

    expect(response.status()).toBe(302);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const authorize = new URL(response.headers().location);
    expect(`${authorize.origin}${authorize.pathname}`).toBe("http://localhost:3110/authorize");
    expect(authorize.searchParams.get("response_type")).toBe("code");
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${baseURL}/api/portal/auth/test/callback`);
    expect(authorize.searchParams.get("scope")).toBe("openid email profile");
    expect(authorize.searchParams.get("state")).toMatch(URL_SAFE_32_BYTES);
    expect(authorize.searchParams.get("code_challenge")).toMatch(URL_SAFE_32_BYTES);
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");

    const flow = await cookieNamed(context, FLOW_COOKIE);
    expect(flow).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/api/portal/auth", secure: false });
    const secondsLeft = (flow?.expires ?? 0) - Date.now() / 1000;
    expect(secondsLeft).toBeGreaterThan(9 * 60);
    expect(secondsLeft).toBeLessThanOrEqual(10 * 60 + 1);
  });

  test("a provider that is not configured, or that does not exist, is a 404", async ({ request }) => {
    for (const path of ["/api/portal/auth/discord", "/api/portal/auth/google", "/api/portal/auth/nada"]) {
      const response = await request.get(`${path}?locale=es`, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
    }
  });
});

test.describe("a sign-in that comes back wrong goes back to the portal with a notice and no session", () => {
  test("a state changed by hand", async ({ page, context }) => {
    const callback = new URL(await callbackUrlFrom(page.request, await startSignIn(page.request)));
    callback.searchParams.set("state", "x".repeat(43));

    const response = await page.request.get(callback.toString(), { maxRedirects: 0 });

    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe(`/es/portal?${FAILED}`);
    expect(await cookieNamed(context, STUDENT_COOKIE)).toBeUndefined();
    expect(await cookieNamed(context, FLOW_COOKIE)).toBeUndefined();
  });

  test("the return address of a sign-in that was already used", async ({ page, context, request }) => {
    const callback = await callbackUrlFrom(page.request, await startSignIn(page.request));
    const first = await page.request.get(callback, { maxRedirects: 0 });
    expect(first.status()).toBe(303);
    expect(first.headers().location).toBe("/es/portal");
    const session = (await cookieNamed(context, STUDENT_COOKIE))?.value;
    expect(session).toMatch(URL_SAFE_32_BYTES);

    // En otro navegador (alguien que copió el link): ni cookie del flujo ni sesión.
    const elsewhere = await request.get(callback, { maxRedirects: 0 });
    expect(elsewhere.status()).toBe(303);
    expect(elsewhere.headers().location).toBe(`/es/portal?${FAILED}`);
    expect((await request.storageState()).cookies.map(({ name }) => name)).not.toContain(STUDENT_COOKIE);

    // En el mismo navegador, con otro ingreso empezado (botón atrás, otra pestaña): el state ya no es ese.
    await startSignIn(page.request);
    const replay = await page.request.get(callback, { maxRedirects: 0 });
    expect(replay.status()).toBe(303);
    expect(replay.headers().location).toBe(`/es/portal?${FAILED}`);
    expect(await cookieNamed(context, FLOW_COOKIE)).toBeUndefined();
    expect((await cookieNamed(context, STUDENT_COOKIE))?.value).toBe(session);
  });

  test("the student cancels at the provider (error=access_denied), in the language of the sign-in", async ({
    page,
    context,
  }) => {
    const authorize = await startSignIn(page.request, { locale: "pt", deny: true });

    await page.goto(authorize.toString());

    await expect(page).toHaveURL(new RegExp(`/pt/portal\\?${FAILED}$`));
    expect(await cookieNamed(context, STUDENT_COOKIE)).toBeUndefined();
    expect(await cookieNamed(context, FLOW_COOKIE)).toBeUndefined();
  });

  test("a language that is not of the site comes back in Spanish", async ({ page }) => {
    const authorize = await startSignIn(page.request, { locale: "https://evil.example", deny: true });

    await page.goto(authorize.toString());

    await expect(page).toHaveURL(new RegExp(`/es/portal\\?${FAILED}$`));
  });

  test("coming back without having started (no flow cookie)", async ({ request }) => {
    const response = await request.get(`/api/portal/auth/test/callback?code=codigo&state=${"s".repeat(43)}`, {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe(`/es/portal?${FAILED}`);
  });
});

test.describe("signing out", () => {
  test("only a POST signs out: it deletes the cookie and goes back to the portal in the language asked", async ({
    page,
    context,
  }) => {
    await signInInBrowser(page);

    // Un GET (un link, una imagen de otro sitio) no cierra nada.
    const get = await page.request.get("/api/portal/auth/logout?locale=en", { maxRedirects: 0 });
    expect(get.status()).toBe(405);
    expect(await cookieNamed(context, STUDENT_COOKIE)).toBeDefined();

    const response = await page.request.post("/api/portal/auth/logout?locale=en", { maxRedirects: 0 });

    expect(response.status()).toBe(303);
    expect(response.headers().location).toBe("/en/portal");
    expect(await cookieNamed(context, STUDENT_COOKIE)).toBeUndefined();
  });
});

test.describe("the student session and the panel session never mix", () => {
  test("the student cookie does not open /admin, not even under the name of the panel cookie", async ({
    page,
    context,
  }) => {
    await signInInBrowser(page);
    const studentToken = (await cookieNamed(context, STUDENT_COOKIE))?.value ?? "";

    const asStudent = await page.request.get("/admin", { maxRedirects: 0 });
    expect(asStudent.status()).toBe(307);
    expect(asStudent.headers().location).toContain("/admin/login");

    await context.addCookies([{ name: ADMIN_COOKIE, value: studentToken, domain: "localhost", path: "/admin" }]);
    const disguised = await page.request.get("/admin", { maxRedirects: 0 });
    expect(disguised.status()).toBe(307);
    expect(disguised.headers().location).toContain("/admin/login");
  });

  test("the panel cookie never travels to the portal, and the panel login leaves no student session", async ({
    page,
    context,
    baseURL,
  }) => {
    await loginAndReadSessionCookie(page);

    for (const path of ["/es/portal", "/api/portal/auth/logout", "/api/portal/auth/test/callback"]) {
      const names = (await context.cookies(`${baseURL}${path}`)).map(({ name }) => name);
      expect(names, path).not.toContain(ADMIN_COOKIE);
      expect(names, path).not.toContain(STUDENT_COOKIE);
    }
  });
});
