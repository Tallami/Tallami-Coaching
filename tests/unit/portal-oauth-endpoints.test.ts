import { eq } from "drizzle-orm";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import { customers, portalAccounts, portalInvites, portalSessions } from "@/db/schema";
import { SITE_URL } from "@/lib/site-url";
import { accountForCustomer } from "@/portal/accounts";
import { createInvite, redeemInvite } from "@/portal/invites";
import { handleCallback, handleLogout, handleSignInStart, type PortalAuthDeps } from "@/portal/oauth/endpoints";
import { FLOW_COOKIE, readFlowCookie } from "@/portal/oauth/flow";
import { PORTAL_OAUTH_FLOW_MS, PORTAL_SESSION_MS } from "@/portal/policy";
import { PORTAL_COOKIE, createPortalSession, readPortalSession, revokePortalSession } from "@/portal/sessions";
import { createTestDb } from "../helpers/db";
import { insertTestAccount, insertTestCustomer } from "../helpers/portal";

const SECRET = "secreto-del-portal-de-prueba-de-mas-de-32-caracteres";
const ISSUER = "http://localhost:3199";
const ORIGIN = "http://localhost:3100";
const PROFILE = { sub: "alumno-1", name: "Alumno Uno", email: "alumno-1@example.com" };
const INVITE = "i".repeat(43);
const DAY_MS = 24 * 60 * 60 * 1000;
/** Lo que manda el navegador cuando el ingreso empieza con un clic en la página del portal. */
const FROM_PORTAL = { "sec-fetch-site": "same-origin" };

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  for (const name of [
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "VERCEL",
    "VERCEL_ENV",
    "DATABASE_URL",
  ]) {
    vi.stubEnv(name, "");
  }
  vi.stubEnv("PORTAL_SESSION_SECRET", SECRET);
  vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", ISSUER);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.delete(portalAccounts); // las cuentas arrastran sus sesiones (on delete cascade)
  await db.delete(customers); // los alumnos arrastran sus invitaciones (on delete cascade)
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** El proveedor de prueba visto desde el servidor: `/token` y `/userinfo` contestan como el servidor OAuth falso. */
function providerFetch({ profile = PROFILE as unknown, tokenStatus = 200 } = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === `${ISSUER}/token`) {
      return tokenStatus === 200
        ? Response.json({ access_token: "token-de-acceso", token_type: "Bearer", expires_in: 3600 })
        : Response.json({ error: "invalid_grant" }, { status: tokenStatus });
    }
    if (url === `${ISSUER}/userinfo`) return Response.json(profile);
    return new Response("no existe", { status: 404 });
  });
}

function deps(overrides: Partial<PortalAuthDeps> = {}): PortalAuthDeps {
  return { getDb: async () => db, fetch: providerFetch(), ...overrides };
}

/** Un pedido como lo arma Next: con el encabezado `host` de la dirección. */
function request(url: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(url, { ...init, headers: { host: new URL(url).host, ...init.headers } });
}

/**
 * Empieza un ingreso con el proveedor de prueba y devuelve la cookie del flujo y el `state` que viajó al proveedor.
 * `headers` son los del pedido: una invitación solo vale si el ingreso empieza en la página del portal (`FROM_PORTAL`).
 */
async function begin(query = "?locale=es", now?: Date, headers: Record<string, string> = {}) {
  const response = await handleSignInStart(
    request(`${ORIGIN}/api/portal/auth/test${query}`, { headers }),
    "test",
    now ? { now: () => now } : {},
  );
  const location = new URL(response.headers.get("location") ?? "");
  return { response, location, cookie: response.cookies.get(FLOW_COOKIE)?.value ?? "", state: location.searchParams.get("state") ?? "" };
}

/** La vuelta del proveedor. `session` es la cookie `tallami_alumno` que el navegador ya tenía, si tenía. */
function callbackRequest(
  params: Record<string, string>,
  cookie?: string,
  provider = "test",
  session?: string,
): NextRequest {
  const url = new URL(`${ORIGIN}/api/portal/auth/${provider}/callback`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const cookies = [
    cookie === undefined ? null : `${FLOW_COOKIE}=${cookie}`,
    session === undefined ? null : `${PORTAL_COOKIE}=${session}`,
  ].filter((part) => part !== null);
  return request(url.toString(), { headers: cookies.length > 0 ? { cookie: cookies.join("; ") } : {} });
}

function expectFlowCookieCleared(response: NextResponse): void {
  expect(response.cookies.get(FLOW_COOKIE)).toMatchObject({ value: "", maxAge: 0, path: "/api/portal/auth" });
}

/** Una falla: vuelve al portal con el aviso, sin sesión, y la cookie del flujo se borra igual. */
async function expectFailure(response: NextResponse, locale = "es"): Promise<void> {
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`/${locale}/portal?ingreso=fallido`);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.cookies.get(PORTAL_COOKIE)).toBeUndefined();
  expectFlowCookieCleared(response);
  expect(await db.select().from(portalSessions)).toEqual([]);
}

describe("GET /api/portal/auth/[provider]", () => {
  test("is a 404 for an unknown provider and for one without credentials", async () => {
    for (const provider of ["nada", "TEST", "discord", "google", ""]) {
      const response = await handleSignInStart(request(`${ORIGIN}/api/portal/auth/${provider}`), provider);
      expect(response.status, provider).toBe(404);
      expect(response.cookies.get(FLOW_COOKIE), provider).toBeUndefined();
    }
  });

  test("is a 404 while the portal is not configured (without its secret)", async () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", "");

    const response = await handleSignInStart(request(`${ORIGIN}/api/portal/auth/test?locale=es`), "test");

    expect(response.status).toBe(404);
    expect(response.cookies.get(FLOW_COOKIE)).toBeUndefined();
  });

  test("sends the browser to the provider, coming back to this server, with a short flow cookie and no cache", async () => {
    const { response, location } = await begin();

    expect(response.status).toBe(302);
    expect(`${location.origin}${location.pathname}`).toBe(`${ISSUER}/authorize`);
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/portal/auth/test/callback`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.cookies.get(FLOW_COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/api/portal/auth",
      maxAge: PORTAL_OAUTH_FLOW_MS / 1000,
      secure: false,
    });
  });

  test("the flow cookie is Secure everywhere but plain http on localhost", async () => {
    const response = await handleSignInStart(request("https://tallami.example/api/portal/auth/test?locale=es"), "test");

    expect(response.cookies.get(FLOW_COOKIE)?.secure).toBe(true);
  });

  test("keeps the language and a well-formed invite in the flow; anything else becomes Spanish and no invite", async () => {
    const good = await begin(`?locale=pt&invitacion=${INVITE}`, undefined, FROM_PORTAL);
    expect(readFlowCookie(good.cookie, "test")).toMatchObject({ locale: "pt", inviteToken: INVITE });

    const bad = await begin("?locale=fr&invitacion=corta", undefined, FROM_PORTAL);
    expect(readFlowCookie(bad.cookie, "test")).toMatchObject({ locale: "es", inviteToken: null });

    const none = await begin("", undefined, FROM_PORTAL);
    expect(readFlowCookie(none.cookie, "test")).toMatchObject({ locale: "es", inviteToken: null });
  });
});

describe("the invite of the address counts only when the sign-in starts on the portal itself", () => {
  /** El ingreso con una invitación bien formada; devuelve lo que quedó en la cookie del flujo. */
  async function startedWith(headers: Record<string, string>) {
    const started = await begin(`?locale=pt&invitacion=${INVITE}`, undefined, headers);
    expect(started.response.status).toBe(302);
    return readFlowCookie(started.cookie, "test");
  }

  test("a click on the portal page (Sec-Fetch-Site: same-origin) keeps the invite", async () => {
    expect(await startedWith(FROM_PORTAL)).toMatchObject({ locale: "pt", inviteToken: INVITE });
  });

  test.each(["cross-site", "same-site", "none"])(
    "Sec-Fetch-Site: %s drops the invite, but the sign-in goes on in its language",
    async (site) => {
      const flow = await startedWith({ "sec-fetch-site": site });

      expect(flow).toMatchObject({ locale: "pt", inviteToken: null });
    },
  );

  test("without Sec-Fetch-Site, a Referer of this same origin keeps the invite", async () => {
    expect(await startedWith({ referer: `${ORIGIN}/es/portal?invitacion=${INVITE}` })).toMatchObject({
      inviteToken: INVITE,
    });
  });

  test("without Sec-Fetch-Site, the Referer is the portal page without the token (what the page sends once it took it off the bar): the invite of the start address is kept", async () => {
    // La página saca el token de la barra, así que el Referer de un clic ya no lo trae: el token viaja en la
    // dirección de inicio (el `href` del botón), y alcanza con que el Referer sea del propio sitio.
    for (const referer of [`${ORIGIN}/es/portal`, `${ORIGIN}/pt/portal?ingreso=fallido`]) {
      expect(await startedWith({ referer }), referer).toMatchObject({ locale: "pt", inviteToken: INVITE });
    }
  });

  test("without Sec-Fetch-Site, a Referer of another site that names the portal page does not keep the invite", async () => {
    for (const referer of ["https://evil.example/es/portal", `https://evil.example/es/portal?volver=${ORIGIN}/es/portal`]) {
      expect(await startedWith({ referer }), referer).toMatchObject({ inviteToken: null });
    }
  });

  test("without Sec-Fetch-Site, no Referer, one of another origin or one that is not an address drops the invite", async () => {
    const cases: Record<string, string>[] = [
      {},
      { referer: "https://evil.example/es/portal" },
      { referer: "http://localhost.evil.example:3100/es/portal" },
      { referer: "https://localhost:3100/es/portal" },
      { referer: "no es una dirección" },
      { referer: "" },
    ];
    for (const headers of cases) {
      expect(await startedWith(headers), JSON.stringify(headers)).toMatchObject({ inviteToken: null });
    }
  });

  test("Sec-Fetch-Site decides over the Referer: a cross-site request with a forged same-origin Referer drops the invite", async () => {
    const flow = await startedWith({ "sec-fetch-site": "cross-site", referer: `${ORIGIN}/es/portal` });

    expect(flow).toMatchObject({ inviteToken: null });
  });
});

describe("Discord and Google start only on the public address of the site", () => {
  beforeEach(() => {
    vi.stubEnv("DISCORD_CLIENT_ID", "id-de-discord");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secreto-de-discord");
    vi.stubEnv("GOOGLE_CLIENT_ID", "id-de-google");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secreto-de-google");
  });

  test.each(["discord", "google"])(
    "%s on another host: a redirect to the same path and query on the public address, without the flow cookie",
    async (provider) => {
      const query = `?locale=pt&invitacion=${INVITE}`;

      const response = await handleSignInStart(
        request(`${ORIGIN}/api/portal/auth/${provider}${query}`, { headers: FROM_PORTAL }),
        provider,
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(`${SITE_URL}/api/portal/auth/${provider}${query}&redirigido=1`);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.cookies.get(FLOW_COOKIE)).toBeUndefined();
    },
  );

  test("on a host that only looks like the public one, it redirects too", async () => {
    const site = new URL(SITE_URL);
    const lookalike = `${site.protocol}//${site.hostname}.evil.example${site.port ? `:${site.port}` : ""}`;

    const response = await handleSignInStart(request(`${lookalike}/api/portal/auth/discord?locale=es`), "discord");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${SITE_URL}/api/portal/auth/discord?locale=es&redirigido=1`);
    expect(response.cookies.get(FLOW_COOKIE)).toBeUndefined();
  });

  test.each(["discord", "google"])(
    "%s: a second hop that arrives marked on a host that is not the public one is a 404, not one more redirect",
    async (provider) => {
      // Un servidor de adelante que devuelve la dirección pública a la otra (con `www`, por ejemplo) armaría un bucle.
      const first = await handleSignInStart(request(`${ORIGIN}/api/portal/auth/${provider}?locale=es`), provider);
      const bounced = new URL(first.headers.get("location") ?? "");
      expect(bounced.origin).toBe(new URL(SITE_URL).origin);

      const second = await handleSignInStart(
        request(`${ORIGIN}${bounced.pathname}${bounced.search}`),
        provider,
      );

      expect(second.status).toBe(404);
      expect(second.headers.get("location")).toBeNull();
      expect(second.headers.get("cache-control")).toContain("no-store");
      expect(second.cookies.get(FLOW_COOKIE)).toBeUndefined();
    },
  );

  test("the marker on the public address does not get in the way: the sign-in starts", async () => {
    const response = await handleSignInStart(
      request(`${SITE_URL}/api/portal/auth/google?locale=en&redirigido=1`),
      "google",
    );

    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location") ?? "").origin).toBe("https://accounts.google.com");
    expect(readFlowCookie(response.cookies.get(FLOW_COOKIE)?.value, "google")).toMatchObject({ locale: "en" });
  });

  test("on the public address it starts the sign-in: the flow cookie, and the provider coming back to the public address", async () => {
    const response = await handleSignInStart(request(`${SITE_URL}/api/portal/auth/google?locale=en`), "google");

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe(`${SITE_URL}/api/portal/auth/google/callback`);
    expect(response.cookies.get(FLOW_COOKIE)?.value).toBeTruthy();
    expect(readFlowCookie(response.cookies.get(FLOW_COOKIE)?.value, "google")).toMatchObject({ locale: "en" });
  });

  test("the test provider keeps the host of the request", async () => {
    const response = await handleSignInStart(request(`${ORIGIN}/api/portal/auth/test?locale=es`), "test");

    expect(new URL(response.headers.get("location") ?? "").searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/portal/auth/test/callback`,
    );
    expect(response.cookies.get(FLOW_COOKIE)?.value).toBeTruthy();
  });

  test("an unknown provider is still a 404 on another host (no redirect for what does not exist)", async () => {
    const response = await handleSignInStart(request(`${ORIGIN}/api/portal/auth/nada`), "nada");

    expect(response.status).toBe(404);
  });
});

describe("GET /api/portal/auth/[provider]/callback", () => {
  test("opens a 30-day session for the account of that identity and goes back to the portal in the language of the sign-in", async () => {
    const { cookie, state } = await begin("?locale=pt");

    const response = await handleCallback(callbackRequest({ code: "codigo", state }, cookie), "test", deps());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/pt/portal");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expectFlowCookieCleared(response);

    const session = response.cookies.get(PORTAL_COOKIE);
    expect(session).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: PORTAL_SESSION_MS / 1000,
      secure: false,
    });
    const opened = await readPortalSession(db, session?.value);
    const [account] = await db.select().from(portalAccounts);
    expect(opened?.accountId).toBe(account.id);
    expect(account).toMatchObject({
      provider: "test",
      providerUserId: "alumno-1",
      displayName: "Alumno Uno",
      email: "alumno-1@example.com",
    });
  });

  test("sends the code with the verifier of the flow and the same return address to the provider", async () => {
    const { cookie, state } = await begin();
    const fetch = providerFetch();

    await handleCallback(callbackRequest({ code: "codigo", state }, cookie), "test", deps({ fetch }));

    const [, init] = fetch.mock.calls[0];
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("code")).toBe("codigo");
    expect(body.get("code_verifier")).toBe(readFlowCookie(cookie, "test")?.codeVerifier);
    expect(body.get("redirect_uri")).toBe(`${ORIGIN}/api/portal/auth/test/callback`);
  });

  test("the same identity signing in again is the same account", async () => {
    for (let i = 0; i < 2; i += 1) {
      const { cookie, state } = await begin();
      await handleCallback(callbackRequest({ code: `codigo-${i}`, state }, cookie), "test", deps());
    }

    expect(await db.select().from(portalAccounts)).toHaveLength(1);
    expect(await db.select().from(portalSessions)).toHaveLength(2);
  });

  test("fails without the flow cookie (another browser, or the cookie already used), without calling the provider", async () => {
    const { state } = await begin();
    const fetch = providerFetch();

    await expectFailure(await handleCallback(callbackRequest({ code: "codigo", state }), "test", deps({ fetch })));
    expect(fetch).not.toHaveBeenCalled();
  });

  test("fails with a state that is not the one of the flow (another tab started another sign-in)", async () => {
    const first = await begin();
    const second = await begin();
    const fetch = providerFetch();

    const response = await handleCallback(
      callbackRequest({ code: "codigo", state: first.state }, second.cookie),
      "test",
      deps({ fetch }),
    );

    await expectFailure(response);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("fails with a state changed by hand, missing, or without a code", async () => {
    const { cookie, state } = await begin();
    const changed = `${state.slice(0, -1)}${state.endsWith("A") ? "B" : "A"}`;

    const cases: Record<string, string>[] = [{ code: "codigo", state: changed }, { code: "codigo" }, { state }, { code: "", state }];
    for (const params of cases) {
      await expectFailure(await handleCallback(callbackRequest(params, cookie), "test", deps()));
    }
  });

  test("fails when the provider comes back with an error (the student cancelled), in the language of the sign-in", async () => {
    const { cookie, state } = await begin("?locale=en");
    const fetch = providerFetch();

    const response = await handleCallback(
      callbackRequest({ error: "access_denied", state }, cookie),
      "test",
      deps({ fetch }),
    );

    await expectFailure(response, "en");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("fails when the flow expired (10 minutes after it started)", async () => {
    const started = new Date();
    const { cookie, state } = await begin("?locale=es", started);
    const later = new Date(started.getTime() + PORTAL_OAUTH_FLOW_MS);

    await expectFailure(
      await handleCallback(callbackRequest({ code: "codigo", state }, cookie), "test", deps({ now: () => later })),
    );
  });

  test("fails when the flow was started for another provider", async () => {
    vi.stubEnv("DISCORD_CLIENT_ID", "id-de-discord");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secreto-de-discord");
    const { cookie, state } = await begin();

    await expectFailure(
      await handleCallback(callbackRequest({ code: "codigo", state }, cookie, "discord"), "discord", deps()),
    );
  });

  test("fails with a tampered flow cookie", async () => {
    const { cookie, state } = await begin();
    const [payload] = cookie.split(".");

    await expectFailure(
      await handleCallback(callbackRequest({ code: "codigo", state }, `${payload}.firma-falsa`), "test", deps()),
    );
  });

  test("fails for an unknown provider in the address", async () => {
    const { cookie, state } = await begin();

    await expectFailure(
      await handleCallback(callbackRequest({ code: "codigo", state }, cookie, "nada"), "nada", deps()),
    );
  });

  test.each([400, 500])("fails when the provider rejects the code (%i), without creating an account", async (tokenStatus) => {
    const { cookie, state } = await begin();

    await expectFailure(
      await handleCallback(
        callbackRequest({ code: "codigo", state }, cookie),
        "test",
        deps({ fetch: providerFetch({ tokenStatus }) }),
      ),
    );
    expect(await db.select().from(portalAccounts)).toEqual([]);
  });

  test("fails when the profile does not identify anyone", async () => {
    const { cookie, state } = await begin();

    await expectFailure(
      await handleCallback(
        callbackRequest({ code: "codigo", state }, cookie),
        "test",
        deps({ fetch: providerFetch({ profile: { name: "Sin id" } }) }),
      ),
    );
  });

  test("fails when the database does not answer, and logs only the name of the error", async () => {
    const { cookie, state } = await begin();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleCallback(callbackRequest({ code: "codigo", state }, cookie), "test", {
      ...deps(),
      getDb: async () => {
        throw new Error("postgres://usuario:clave@host/base no responde");
      },
    });

    await expectFailure(response);
    const logged = error.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("Error");
    expect(logged).not.toContain("clave@host");
  });

  test("after signing in, deletes the sessions that ended more than a day ago", async () => {
    const otherAccount = await insertTestAccount(db);
    const oldToken = await createPortalSession(db, otherAccount, new Date(Date.now() - 3 * DAY_MS));
    await revokePortalSession(db, oldToken, new Date(Date.now() - 2 * DAY_MS));
    const { cookie, state } = await begin();

    await handleCallback(callbackRequest({ code: "codigo", state }, cookie), "test", deps());

    expect(await db.select().from(portalSessions).where(eq(portalSessions.accountId, otherAccount))).toEqual([]);
  });

  test("a cleanup that fails does not block the sign-in, and logs only the name of the error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // La base contesta todo menos los `delete` de la limpieza.
    const brokenCleanup = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "delete") {
          return () => {
            throw new Error("detalle interno de la base");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const { cookie, state } = await begin();

    const response = await handleCallback(callbackRequest({ code: "codigo", state }, cookie), "test", {
      ...deps(),
      getDb: async () => brokenCleanup,
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/es/portal");
    expect(await readPortalSession(db, response.cookies.get(PORTAL_COOKIE)?.value)).not.toBeNull();
    const logged = error.mock.calls.flat().map(String).join("\n");
    expect(logged).toContain("Error");
    expect(logged).not.toContain("detalle interno");
  });

});

describe("signing in again in a browser that already has a student session", () => {
  test("closes the previous session of the browser when the new one opens, and only that one", async () => {
    const otherAccount = await insertTestAccount(db);
    const previous = await createPortalSession(db, otherAccount);
    const bystander = await createPortalSession(db, otherAccount);
    const { cookie, state } = await begin();

    const response = await handleCallback(callbackRequest({ code: "codigo", state }, cookie, "test", previous), "test", deps());

    expect(response.status).toBe(303);
    expect(await readPortalSession(db, previous)).toBeNull();
    expect(await readPortalSession(db, bystander)).not.toBeNull();
    expect(await readPortalSession(db, response.cookies.get(PORTAL_COOKIE)?.value)).not.toBeNull();
  });

  test("the same account signing in again also closes the session it had in that browser", async () => {
    const first = await begin();
    const firstResponse = await handleCallback(callbackRequest({ code: "uno", state: first.state }, first.cookie), "test", deps());
    const oldSession = firstResponse.cookies.get(PORTAL_COOKIE)?.value ?? "";
    const second = await begin();

    const secondResponse = await handleCallback(
      callbackRequest({ code: "dos", state: second.state }, second.cookie, "test", oldSession),
      "test",
      deps(),
    );

    expect(await readPortalSession(db, oldSession)).toBeNull();
    expect(await readPortalSession(db, secondResponse.cookies.get(PORTAL_COOKIE)?.value)).not.toBeNull();
  });

  test("does not touch the sessions of other browsers of the same account", async () => {
    const first = await begin();
    const firstResponse = await handleCallback(callbackRequest({ code: "uno", state: first.state }, first.cookie), "test", deps());
    const otherBrowser = firstResponse.cookies.get(PORTAL_COOKIE)?.value ?? "";
    const second = await begin();

    await handleCallback(callbackRequest({ code: "dos", state: second.state }, second.cookie), "test", deps());

    expect(await readPortalSession(db, otherBrowser)).not.toBeNull();
  });

  test("a sign-in that fails leaves the previous session open", async () => {
    const previous = await createPortalSession(db, await insertTestAccount(db));
    const { cookie } = await begin();

    const response = await handleCallback(
      callbackRequest({ code: "codigo", state: "x".repeat(43) }, cookie, "test", previous),
      "test",
      deps(),
    );

    expect(response.headers.get("location")).toBe("/es/portal?ingreso=fallido");
    expect(await readPortalSession(db, previous)).not.toBeNull();
  });

  test("a cookie with something that is not a session is ignored", async () => {
    const { cookie, state } = await begin();

    const response = await handleCallback(
      callbackRequest({ code: "codigo", state }, cookie, "test", "no-es-una-sesion"),
      "test",
      deps(),
    );

    expect(response.headers.get("location")).toBe("/es/portal");
    expect(await readPortalSession(db, response.cookies.get(PORTAL_COOKIE)?.value)).not.toBeNull();
  });
});

describe("the invite of the sign-in", () => {
  /** Ingresa con el proveedor de prueba, empezando desde la página del portal con `invite`, y devuelve la respuesta de la vuelta. */
  async function signInWithInvite(invite: string, { locale = "es", profile = PROFILE as unknown } = {}) {
    const { cookie, state } = await begin(`?locale=${locale}&invitacion=${invite}`, undefined, FROM_PORTAL);
    return handleCallback(callbackRequest({ code: "codigo", state }, cookie), "test", deps({ fetch: providerFetch({ profile }) }));
  }

  async function onlyInvite() {
    const [invite] = await db.select().from(portalInvites);
    return invite;
  }

  test("redeems it for the account of the identity before opening the session, and tells the portal", async () => {
    const customerId = await insertTestCustomer(db);
    const invite = await createInvite(db, customerId);

    const response = await signInWithInvite(invite, { locale: "pt" });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/pt/portal?invitacion=vinculada");
    const account = await accountForCustomer(db, customerId);
    expect(account).toMatchObject({ provider: "test", displayName: "Alumno Uno" });
    expect(await readPortalSession(db, response.cookies.get(PORTAL_COOKIE)?.value)).toEqual({ accountId: account?.id });
    expect(response.cookies.get(PORTAL_COOKIE)).toBeDefined();
    expectFlowCookieCleared(response);
    expect(await onlyInvite()).toMatchObject({ usedByAccountId: account?.id });
    expect((await onlyInvite()).usedAt).not.toBeNull();
  });

  const INVALID_INVITES: [string, (customerId: string) => Promise<string>][] = [
    ["one nobody created", async () => "n".repeat(43)],
    [
      "one that was already used",
      async (customerId) => {
        const used = await createInvite(db, customerId);
        await redeemInvite(db, used, await insertTestAccount(db));
        return used;
      },
    ],
    ["one that expired", (customerId) => createInvite(db, customerId, new Date(Date.now() - 15 * DAY_MS))],
  ];

  test.each(INVALID_INVITES)("%s: the student still signs in and the portal is told it is invalid", async (_label, prepare) => {
    const invite = await prepare(await insertTestCustomer(db));

    const response = await signInWithInvite(invite);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/es/portal?invitacion=invalida");
    expect(await readPortalSession(db, response.cookies.get(PORTAL_COOKIE)?.value)).not.toBeNull();
    const [account] = await db.select().from(portalAccounts).where(eq(portalAccounts.providerUserId, PROFILE.sub));
    expect(account.customerId).toBeNull();
  });

  test("a student that already has an account: nothing is overwritten, the portal is told it is taken and the invite stays unused", async () => {
    const customerId = await insertTestCustomer(db);
    const owner = await insertTestAccount(db, { customerId });
    const invite = await createInvite(db, customerId);

    const response = await signInWithInvite(invite);

    expect(response.headers.get("location")).toBe("/es/portal?invitacion=ocupada");
    expect(response.cookies.get(PORTAL_COOKIE)).toBeDefined();
    expect((await accountForCustomer(db, customerId))?.id).toBe(owner);
    expect(await onlyInvite()).toMatchObject({ usedAt: null, usedByAccountId: null });
  });

  test("an account that is already linked to another student: nothing is overwritten, the portal is told it is taken", async () => {
    const otherCustomer = await insertTestCustomer(db, "Otro alumno");
    const customerId = await insertTestCustomer(db);
    const { cookie, state } = await begin();
    // La cuenta de esta identidad ya existe y es de otro alumno.
    await handleCallback(callbackRequest({ code: "codigo", state }, cookie), "test", deps());
    const [account] = await db.select().from(portalAccounts);
    await db.update(portalAccounts).set({ customerId: otherCustomer }).where(eq(portalAccounts.id, account.id));
    const invite = await createInvite(db, customerId);

    const response = await signInWithInvite(invite);

    expect(response.headers.get("location")).toBe("/es/portal?invitacion=ocupada");
    expect((await accountForCustomer(db, otherCustomer))?.id).toBe(account.id);
    expect(await accountForCustomer(db, customerId)).toBeNull();
    expect(await onlyInvite()).toMatchObject({ usedAt: null });
  });

  test("opening the same invite a second time, with another account, is invalid", async () => {
    const customerId = await insertTestCustomer(db);
    const invite = await createInvite(db, customerId);

    const first = await signInWithInvite(invite);
    const second = await signInWithInvite(invite, { profile: { sub: "alumno-2", name: "Alumno Dos" } });

    expect(first.headers.get("location")).toBe("/es/portal?invitacion=vinculada");
    expect(second.headers.get("location")).toBe("/es/portal?invitacion=invalida");
    const [linked] = await db.select().from(portalAccounts).where(eq(portalAccounts.customerId, customerId));
    expect(linked.providerUserId).toBe("alumno-1");
  });

  test("an invite from a link that was not clicked on the portal is not redeemed: the sign-in goes on without it", async () => {
    const customerId = await insertTestCustomer(db);
    const invite = await createInvite(db, customerId);
    const { cookie, state } = await begin(`?locale=es&invitacion=${invite}`, undefined, { "sec-fetch-site": "cross-site" });

    const response = await handleCallback(callbackRequest({ code: "codigo", state }, cookie), "test", deps());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/es/portal");
    expect(response.cookies.get(PORTAL_COOKIE)).toBeDefined();
    expect(await accountForCustomer(db, customerId)).toBeNull();
    expect(await onlyInvite()).toMatchObject({ usedAt: null });
  });

  test("a sign-in that fails does not redeem the invite", async () => {
    const customerId = await insertTestCustomer(db);
    const invite = await createInvite(db, customerId);
    const { cookie } = await begin(`?locale=es&invitacion=${invite}`, undefined, FROM_PORTAL);

    const response = await handleCallback(callbackRequest({ code: "codigo", state: "x".repeat(43) }, cookie), "test", deps());

    await expectFailure(response);
    expect(await onlyInvite()).toMatchObject({ usedAt: null });
    expect(await db.select().from(portalAccounts)).toEqual([]);
  });

  test("if the database fails while redeeming, the sign-in fails with no session, and only the name of the error is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const invite = await createInvite(db, await insertTestCustomer(db));
    const brokenRedeem = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return () => {
            throw new Error("detalle interno de la base");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const { cookie, state } = await begin(`?locale=es&invitacion=${invite}`, undefined, FROM_PORTAL);

    const response = await handleCallback(callbackRequest({ code: "codigo", state }, cookie), "test", {
      ...deps(),
      getDb: async () => brokenRedeem,
    });

    await expectFailure(response);
    expect(error.mock.calls.flat().map(String).join("\n")).not.toContain("detalle interno");
    expect(await onlyInvite()).toMatchObject({ usedAt: null });
  });

  test("without an invite the portal address carries no query", async () => {
    const { cookie, state } = await begin();

    const response = await handleCallback(callbackRequest({ code: "codigo", state }, cookie), "test", deps());

    expect(response.headers.get("location")).toBe("/es/portal");
  });
});

describe("POST /api/portal/auth/logout", () => {
  function logoutRequest(query: string, headers: Record<string, string> = {}): NextRequest {
    return request(`${ORIGIN}/api/portal/auth/logout${query}`, { method: "POST", headers });
  }

  test("closes the session in the database, deletes the cookie and goes back to the portal in the language asked", async () => {
    const token = await createPortalSession(db, await insertTestAccount(db));

    const response = await handleLogout(logoutRequest("?locale=en", { cookie: `${PORTAL_COOKIE}=${token}` }), deps());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/en/portal");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.cookies.get(PORTAL_COOKIE)).toMatchObject({ value: "", maxAge: 0, path: "/" });
    expect(await readPortalSession(db, token)).toBeNull();
  });

  test("without a session, or with a language that is not of the site, still goes back to the portal in Spanish", async () => {
    for (const query of ["", "?locale=fr", "?locale=//evil.example"]) {
      const response = await handleLogout(logoutRequest(query), deps());
      expect(response.status, query).toBe(303);
      expect(response.headers.get("location"), query).toBe("/es/portal");
    }
  });

  test("a request sent by another site does not close anything", async () => {
    const token = await createPortalSession(db, await insertTestAccount(db));

    const response = await handleLogout(
      logoutRequest("?locale=es", { cookie: `${PORTAL_COOKIE}=${token}`, "sec-fetch-site": "cross-site" }),
      deps(),
    );

    expect(response.status).toBe(403);
    expect(response.cookies.get(PORTAL_COOKIE)).toBeUndefined();
    expect(await readPortalSession(db, token)).not.toBeNull();
  });

  test("if the database does not answer, the cookie is deleted anyway and only the name of the error is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await handleLogout(logoutRequest("?locale=es", { cookie: `${PORTAL_COOKIE}=${"t".repeat(43)}` }), {
      getDb: async () => {
        throw new Error("postgres://usuario:clave@host/base no responde");
      },
    });

    expect(response.status).toBe(303);
    expect(response.cookies.get(PORTAL_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
    expect(error.mock.calls.flat().map(String).join("\n")).not.toContain("clave@host");
  });
});
