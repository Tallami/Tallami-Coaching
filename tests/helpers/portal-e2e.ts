// Ayudas de los e2e del portal del alumno: entrar con el proveedor de prueba (el servidor
// OAuth falso de `mock-oauth-server.mjs`) desde el navegador de un test, y armar navegadores
// de otros alumnos. Las usan los e2e del ingreso (`portal-auth.spec.ts`), de las invitaciones
// (`portal-invites.spec.ts`) y los de la página del portal (`portal-page.spec.ts`).
//
// Cada test entra con su propio alumno del proveedor de prueba (`uniqueProviderStudent`): los
// tests corren en paralelo sobre la misma base y ninguna identidad se comparte ni se reutiliza,
// así un test que falla a medias no deja a nadie vinculado para el reintento ni para el siguiente.

import { randomUUID } from "node:crypto";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";
import { E2E_PORTS, e2eBaseUrl } from "./admin-server";
import { expect, test, uniqueTestIp } from "./admin";

/** La cookie de sesión del alumno y la del ingreso a medio camino (los valores reales viven en `src/portal`). */
export const STUDENT_COOKIE = "tallami_alumno";
export const FLOW_COOKIE = "tallami_alumno_oauth";

/** Un token de 32 bytes al azar en base64url: una sesión, el `state`, el verificador o una invitación. */
export const URL_SAFE_32_BYTES = /^[A-Za-z0-9_-]{43}$/;

/** Lo que manda el navegador cuando el ingreso empieza con un clic dentro del propio sitio. */
export const FROM_THE_SITE = { "sec-fetch-site": "same-origin" } as const;

/** La cookie con la que un test elige al alumno del proveedor de prueba cuando el navegador no puede mandar `login_hint`. */
const MOCK_STUDENT_COOKIE = "mock_oauth_student";
const MOCK_OAUTH_URL = e2eBaseUrl(E2E_PORTS.oauth);

/** Un alumno del proveedor de prueba por test (letras minúsculas, números y guiones, como pide el servidor falso). */
export function uniqueProviderStudent(): string {
  return `alumno-${randomUUID().slice(0, 8)}`;
}

export interface SignInOptions {
  locale?: string;
  /** El alumno del proveedor de prueba; por defecto uno nuevo. */
  student?: string;
  /** El alumno dice que no en el proveedor (`error=access_denied`). */
  deny?: boolean;
  /** El token de una invitación, como llega en el link (`?invitacion=…`). */
  invitation?: string;
  /** Encabezados del pedido que empieza el ingreso; por defecto, un clic dentro del sitio. */
  headers?: Record<string, string>;
}

/**
 * Empieza el ingreso con el proveedor de prueba desde `request` (que guarda la cookie del flujo) y
 * devuelve la dirección de autorización, con el alumno elegido por `login_hint`.
 */
export async function startSignIn(
  request: APIRequestContext,
  { locale = "es", student = uniqueProviderStudent(), deny = false, invitation, headers = FROM_THE_SITE }: SignInOptions = {},
): Promise<URL> {
  const query = new URLSearchParams({ locale });
  if (invitation) query.set("invitacion", invitation);
  const response = await request.get(`/api/portal/auth/test?${query}`, { headers, maxRedirects: 0 });
  expect(response.status()).toBe(302);
  const authorize = new URL(response.headers().location);
  authorize.searchParams.set("login_hint", student);
  if (deny) authorize.searchParams.set("deny", "1");
  return authorize;
}

/** Pasa por el proveedor de prueba y devuelve la dirección de vuelta a la que manda, sin seguirla. */
export async function callbackUrlFrom(request: APIRequestContext, authorize: URL): Promise<string> {
  const response = await request.get(authorize.toString(), { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  return response.headers().location;
}

/**
 * Entra con el proveedor de prueba en el navegador de `page`, como un alumno de verdad, y devuelve
 * la dirección del portal a la que volvió (con `?invitacion=…` si hubo invitación).
 */
export async function signIn(page: Page, options: SignInOptions = {}): Promise<URL> {
  const authorize = await startSignIn(page.request, options);
  await page.goto(authorize.toString());
  await expect(page).toHaveURL(new RegExp(`/${options.locale ?? "es"}/portal(\\?|$)`));
  return new URL(page.url());
}

export async function cookieNamed(context: BrowserContext, name: string) {
  return (await context.cookies()).find((cookie) => cookie.name === name);
}

/** Otro navegador (otro contexto, con su cookie y su IP para el límite de intentos): el de un alumno. */
export async function newStudentBrowser(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    extraHTTPHeaders: { "x-forwarded-for": uniqueTestIp() },
  });
  return { context, page: await context.newPage() };
}

/**
 * Para el ingreso que hace el navegador solo (sin pasar por `startSignIn`): el navegador no puede
 * agregar `login_hint` a la redirección que le manda el sitio, así que el alumno del proveedor de
 * prueba se elige con una cookie del contexto. Sin esto el proveedor no deja entrar a nadie.
 */
export async function chooseProviderStudent(context: BrowserContext, student: string): Promise<void> {
  await context.addCookies([{ name: MOCK_STUDENT_COOKIE, value: student, url: MOCK_OAUTH_URL }]);
}
