import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  FLOW_COOKIE,
  FLOW_COOKIE_PATH,
  exchangeAndFetchIdentity,
  flowCookieOptions,
  inviteTokenFrom,
  pkceChallenge,
  portalLocale,
  readFlowCookie,
  startFlow,
  type StartFlowInput,
} from "@/portal/oauth/flow";
import { DISCORD_OAUTH } from "@/portal/oauth/providers";
import { PORTAL_OAUTH_FLOW_MS } from "@/portal/policy";

const SECRET = "secreto-del-portal-de-prueba-de-mas-de-32-caracteres";
const NOW = new Date("2026-10-28T10:00:00.000Z");
const REDIRECT_URI = "https://tallami.example/api/portal/auth/discord/callback";
const INVITE = "i".repeat(43);
const URL_SAFE_32_BYTES = /^[A-Za-z0-9_-]{43}$/;

beforeEach(() => {
  for (const name of [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "PORTAL_OAUTH_TEST_ISSUER",
    "VERCEL",
    "VERCEL_ENV",
    "ADMIN_SESSION_SECRET",
  ]) {
    vi.stubEnv(name, "");
  }
  vi.stubEnv("PORTAL_SESSION_SECRET", SECRET);
  vi.stubEnv("DISCORD_CLIENT_ID", "id-de-discord");
  vi.stubEnv("DISCORD_CLIENT_SECRET", "secreto-de-discord");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function start(overrides: Partial<StartFlowInput> = {}) {
  return startFlow({ provider: "discord", locale: "es", redirectUri: REDIRECT_URI, now: NOW, ...overrides });
}

function after(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

describe("startFlow", () => {
  test("points to the authorization endpoint of the provider with the code flow, the client, the return address and the scopes", () => {
    const url = new URL(start().authorizationUrl);

    expect(`${url.origin}${url.pathname}`).toBe(DISCORD_OAUTH.authorizationUrl);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("id-de-discord");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("scope")).toBe("identify email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  test("never puts the client secret in the address", () => {
    expect(start().authorizationUrl).not.toContain("secreto-de-discord");
  });

  test("generates a different state and code verifier every time, and the state in the address is the one in the cookie", () => {
    const flows = [start(), start(), start()].map(({ authorizationUrl, cookieValue }) => ({
      urlState: new URL(authorizationUrl).searchParams.get("state"),
      data: readFlowCookie(cookieValue, "discord", NOW),
    }));

    for (const { urlState, data } of flows) {
      expect(data?.state).toMatch(URL_SAFE_32_BYTES);
      expect(data?.codeVerifier).toMatch(URL_SAFE_32_BYTES);
      expect(urlState).toBe(data?.state);
    }
    expect(new Set(flows.map(({ data }) => data?.state)).size).toBe(3);
    expect(new Set(flows.map(({ data }) => data?.codeVerifier)).size).toBe(3);
  });

  test("sends the S256 code challenge of the verifier it keeps (RFC 7636)", () => {
    const { authorizationUrl, cookieValue } = start();
    const verifier = readFlowCookie(cookieValue, "discord", NOW)?.codeVerifier ?? "";
    const expected = createHash("sha256").update(verifier).digest("base64url");

    expect(new URL(authorizationUrl).searchParams.get("code_challenge")).toBe(expected);
    // El verificador nunca viaja al proveedor en este paso: solo su hash.
    expect(authorizationUrl).not.toContain(verifier);
  });

  test("the cookie carries the provider, the locale, the invite and a 10-minute expiry", () => {
    const data = readFlowCookie(start({ locale: "pt", inviteToken: INVITE }).cookieValue, "discord", NOW);

    expect(data).toMatchObject({
      provider: "discord",
      locale: "pt",
      inviteToken: INVITE,
      expiresAt: NOW.getTime() + PORTAL_OAUTH_FLOW_MS,
    });
    expect(readFlowCookie(start().cookieValue, "discord", NOW)?.inviteToken).toBeNull();
  });

  test("refuses to start without the portal secret or with a provider that is not enabled", () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", "");
    expect(() => start()).toThrow();

    vi.stubEnv("PORTAL_SESSION_SECRET", SECRET);
    expect(() => start({ provider: "google" })).toThrow();
  });
});

describe("pkceChallenge", () => {
  test("is the example of RFC 7636 (appendix B)", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("readFlowCookie", () => {
  test("accepts the cookie it signed, for its provider, before it expires", () => {
    const { cookieValue } = start();

    expect(readFlowCookie(cookieValue, "discord", NOW)).not.toBeNull();
    expect(readFlowCookie(cookieValue, "discord", after(PORTAL_OAUTH_FLOW_MS - 1))).not.toBeNull();
  });

  test("rejects it at 10 minutes, and after", () => {
    const { cookieValue } = start();

    expect(readFlowCookie(cookieValue, "discord", after(PORTAL_OAUTH_FLOW_MS))).toBeNull();
    expect(readFlowCookie(cookieValue, "discord", after(24 * 60 * 60 * 1000))).toBeNull();
  });

  test("rejects the cookie of a sign-in that started with another provider", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id-de-google");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secreto-de-google");

    expect(readFlowCookie(start().cookieValue, "google", NOW)).toBeNull();
    expect(readFlowCookie(start({ provider: "google" }).cookieValue, "google", NOW)).not.toBeNull();
  });

  test("rejects an altered signature", () => {
    const { cookieValue } = start();
    const [payload, signature] = cookieValue.split(".");
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

    expect(readFlowCookie(`${payload}.${flipped}`, "discord", NOW)).toBeNull();
    expect(readFlowCookie(`${payload}.`, "discord", NOW)).toBeNull();
    expect(readFlowCookie(payload, "discord", NOW)).toBeNull();
  });

  test("rejects an altered content under the original signature (another locale, a later expiry)", () => {
    const { cookieValue } = start();
    const [payload, signature] = cookieValue.split(".");
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;

    for (const change of [{ locale: "en" }, { expiresAt: Number(data.expiresAt) + 60 * 60 * 1000 }, { inviteToken: INVITE }]) {
      const altered = Buffer.from(JSON.stringify({ ...data, ...change })).toString("base64url");
      expect(readFlowCookie(`${altered}.${signature}`, "discord", NOW), JSON.stringify(change)).toBeNull();
    }
  });

  test("rejects a cookie signed with another secret (for example the one of the panel)", () => {
    const { cookieValue } = start();
    vi.stubEnv("PORTAL_SESSION_SECRET", "otro-secreto-del-portal-de-mas-de-32-caracteres");

    expect(readFlowCookie(cookieValue, "discord", NOW)).toBeNull();
  });

  test("rejects anything without the portal secret", () => {
    const { cookieValue } = start();
    vi.stubEnv("PORTAL_SESSION_SECRET", "");

    expect(readFlowCookie(cookieValue, "discord", NOW)).toBeNull();
  });

  test("rejects a missing cookie and garbage, and never throws", () => {
    for (const raw of [undefined, "", ".", "..", "a.b.c", "no-es-una-cookie", "%%%.%%%", "x".repeat(10_000)]) {
      expect(readFlowCookie(raw, "discord", NOW), String(raw).slice(0, 20)).toBeNull();
    }
  });
});

describe("flowCookieOptions", () => {
  test("httpOnly, SameSite=Lax, only for the sign-in routes, 10 minutes; Secure is decided by the caller", () => {
    expect(flowCookieOptions(true)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/api/portal/auth",
      maxAge: 600,
    });
    expect(flowCookieOptions(false).secure).toBe(false);
    expect(FLOW_COOKIE).toBe("tallami_alumno_oauth");
    expect(FLOW_COOKIE_PATH).toBe("/api/portal/auth");
  });
});

describe("portalLocale", () => {
  test("keeps the three languages of the site and turns anything else into Spanish", () => {
    expect(portalLocale("es")).toBe("es");
    expect(portalLocale("pt")).toBe("pt");
    expect(portalLocale("en")).toBe("en");
    for (const value of [null, "", "fr", "EN", "es-AR", "../admin", "//evil.example"]) {
      expect(portalLocale(value), String(value)).toBe("es");
    }
  });
});

describe("inviteTokenFrom", () => {
  test("keeps a token with the shape of an invite (32 bytes in base64url) and drops anything else", () => {
    expect(inviteTokenFrom(INVITE)).toBe(INVITE);
    for (const value of [null, "", "corto", "i".repeat(42), "i".repeat(44), `${"i".repeat(42)}=`, `${"i".repeat(42)}/`]) {
      expect(inviteTokenFrom(value), String(value)).toBeNull();
    }
  });
});

describe("exchangeAndFetchIdentity", () => {
  const PROFILE = { id: "80351110224678912", username: "nelly", global_name: "Nelly", email: "nelly@discord.com", verified: true };
  const TOKEN = { access_token: "token-de-acceso", token_type: "Bearer", expires_in: 604800, refresh_token: "token-de-refresco", scope: "identify email" };

  type Call = { url: string; init: RequestInit };

  /** Un `fetch` falso: contesta la primera llamada con `token` y la segunda con `profile`, y anota cada pedido. */
  function fakeFetch(token: () => Response, profile: () => Response = () => Response.json(PROFILE)) {
    const calls: Call[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      return calls.length === 1 ? token() : profile();
    });
    return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
  }

  function exchange(fetch: typeof globalThis.fetch) {
    return exchangeAndFetchIdentity("discord", "codigo-del-proveedor", "verificador-pkce", {
      redirectUri: REDIRECT_URI,
      fetch,
    });
  }

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  test("posts the code, the verifier, the return address and the client to the token endpoint, then reads the profile with the token", async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(TOKEN));

    const identity = await exchange(fetch);

    expect(identity).toEqual({
      provider: "discord",
      providerUserId: "80351110224678912",
      displayName: "Nelly",
      email: "nelly@discord.com",
    });
    expect(calls).toHaveLength(2);

    const [tokenCall, profileCall] = calls;
    expect(tokenCall.url).toBe(DISCORD_OAUTH.tokenUrl);
    expect(tokenCall.init.method).toBe("POST");
    expect(new Headers(tokenCall.init.headers).get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(String(tokenCall.init.body)))).toEqual({
      grant_type: "authorization_code",
      code: "codigo-del-proveedor",
      code_verifier: "verificador-pkce",
      redirect_uri: REDIRECT_URI,
      client_id: "id-de-discord",
      client_secret: "secreto-de-discord",
    });

    expect(profileCall.url).toBe(DISCORD_OAUTH.userinfoUrl);
    expect(profileCall.init.method ?? "GET").toBe("GET");
    expect(new Headers(profileCall.init.headers).get("authorization")).toBe("Bearer token-de-acceso");
  });

  test.each([400, 401, 500, 503])("is null when the token endpoint answers %i, without asking for the profile", async (status) => {
    const { fetch, calls } = fakeFetch(() => Response.json({ error: "invalid_grant" }, { status }));

    expect(await exchange(fetch)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test.each([
    ["broken JSON", () => new Response("{no es json", { headers: { "content-type": "application/json" } })],
    ["an HTML page", () => new Response("<html>error</html>", { headers: { "content-type": "text/html" } })],
    ["no access token", () => Response.json({ token_type: "Bearer" })],
    ["an access token that is not text", () => Response.json({ access_token: 42, token_type: "Bearer" })],
    ["a token that is not a bearer token", () => Response.json({ access_token: "x", token_type: "mac" })],
    ["a JSON that is not an object", () => Response.json(["token-de-acceso"])],
  ])("is null when the token response has %s", async (_label, token) => {
    const { fetch } = fakeFetch(token);

    expect(await exchange(fetch)).toBeNull();
  });

  test("accepts the token type in any case (`bearer`)", async () => {
    const { fetch } = fakeFetch(() => Response.json({ ...TOKEN, token_type: "bearer" }));

    expect(await exchange(fetch)).not.toBeNull();
  });

  test.each([
    ["answers 401", () => Response.json({ message: "401: Unauthorized" }, { status: 401 })],
    ["answers 500", () => new Response("error", { status: 500 })],
    ["answers broken JSON", () => new Response("{no es json")],
    ["gives a profile without an id", () => Response.json({ username: "nelly" })],
  ])("is null when the profile endpoint %s", async (_label, profile) => {
    const { fetch } = fakeFetch(() => Response.json(TOKEN), profile);

    expect(await exchange(fetch)).toBeNull();
  });

  test("is null when the network fails or times out, and never throws", async () => {
    for (const error of [new TypeError("fetch failed"), new DOMException("timeout", "TimeoutError")]) {
      const fetch = vi.fn(async () => {
        throw error;
      }) as unknown as typeof globalThis.fetch;

      await expect(exchange(fetch)).resolves.toBeNull();
    }
  });

  test("is null for a provider that is not enabled, without calling anyone", async () => {
    const { fetch, calls } = fakeFetch(() => Response.json(TOKEN));

    expect(
      await exchangeAndFetchIdentity("google", "codigo", "verificador", { redirectUri: REDIRECT_URI, fetch }),
    ).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("the log of a failure never carries the code, the verifier, the tokens or the secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failures = [
      fakeFetch(() => Response.json({ error: "invalid_grant", code: "codigo-del-proveedor" }, { status: 400 })),
      fakeFetch(() => Response.json(TOKEN), () => new Response("token-de-acceso", { status: 500 })),
    ];

    for (const { fetch } of failures) await exchange(fetch);

    const logged = [...warn.mock.calls, ...error.mock.calls].flat().map(String).join("\n");
    expect(logged).not.toBe("");
    for (const secret of ["codigo-del-proveedor", "verificador-pkce", "token-de-acceso", "secreto-de-discord"]) {
      expect(logged).not.toContain(secret);
    }
  });
});
