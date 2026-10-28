import { eq } from "drizzle-orm";
import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import { portalAccounts, portalSessions } from "@/db/schema";
import { handleCallback, handleLogout, handleSignInStart, type PortalAuthDeps } from "@/portal/oauth/endpoints";
import { FLOW_COOKIE, readFlowCookie } from "@/portal/oauth/flow";
import { PORTAL_OAUTH_FLOW_MS, PORTAL_SESSION_MS } from "@/portal/policy";
import { PORTAL_COOKIE, createPortalSession, readPortalSession, revokePortalSession } from "@/portal/sessions";
import { createTestDb } from "../helpers/db";
import { insertTestAccount } from "../helpers/portal";

const SECRET = "secreto-del-portal-de-prueba-de-mas-de-32-caracteres";
const ISSUER = "http://localhost:3199";
const ORIGIN = "http://localhost:3100";
const PROFILE = { sub: "alumno-1", name: "Alumno Uno", email: "alumno-1@example.com" };
const INVITE = "i".repeat(43);
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Empieza un ingreso con el proveedor de prueba y devuelve la cookie del flujo y el `state` que viajó al proveedor. */
async function begin(query = "?locale=es", now?: Date) {
  const response = await handleSignInStart(
    request(`${ORIGIN}/api/portal/auth/test${query}`),
    "test",
    now ? { now: () => now } : {},
  );
  const location = new URL(response.headers.get("location") ?? "");
  return { response, location, cookie: response.cookies.get(FLOW_COOKIE)?.value ?? "", state: location.searchParams.get("state") ?? "" };
}

function callbackRequest(params: Record<string, string>, cookie?: string, provider = "test"): NextRequest {
  const url = new URL(`${ORIGIN}/api/portal/auth/${provider}/callback`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return request(url.toString(), { headers: cookie === undefined ? {} : { cookie: `${FLOW_COOKIE}=${cookie}` } });
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
    const good = await begin(`?locale=pt&invitacion=${INVITE}`);
    expect(readFlowCookie(good.cookie, "test")).toMatchObject({ locale: "pt", inviteToken: INVITE });

    const bad = await begin("?locale=fr&invitacion=corta");
    expect(readFlowCookie(bad.cookie, "test")).toMatchObject({ locale: "es", inviteToken: null });

    const none = await begin("");
    expect(readFlowCookie(none.cookie, "test")).toMatchObject({ locale: "es", inviteToken: null });
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

  // La Tarea 3 (invitaciones) completa este test cuando agrega `redeemInvite` en la vuelta.
  test.todo("redeems the invite of the flow for the account before opening the session (Task 3: redeemInvite)");
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
