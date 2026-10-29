import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SITE_URL } from "@/lib/site-url";
import {
  DISCORD_OAUTH,
  GOOGLE_OAUTH,
  MAX_DISPLAY_NAME_LENGTH,
  canonicalSignInUrl,
  getProviderClient,
  profileToIdentity,
  redirectUriFor,
} from "@/portal/oauth/providers";

/** Una instalación vacía: ninguna variable del portal, fuera de Vercel. */
beforeEach(() => {
  for (const name of [
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "PORTAL_OAUTH_TEST_ISSUER",
    "VERCEL",
    "VERCEL_ENV",
  ]) {
    vi.stubEnv(name, "");
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** El perfil sin el campo `key`. */
function without(profile: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(profile).filter(([name]) => name !== key));
}

describe("the endpoints and scopes of each provider", () => {
  test("Discord: the OAuth2 endpoints of its documentation, on the explicit API version 10, and the scopes identify email", () => {
    expect(DISCORD_OAUTH).toEqual({
      authorizationUrl: "https://discord.com/oauth2/authorize",
      tokenUrl: "https://discord.com/api/v10/oauth2/token",
      userinfoUrl: "https://discord.com/api/v10/users/@me",
      scopes: ["identify", "email"],
    });
  });

  test("Discord: no endpoint relies on the default API version (a request without one goes to the deprecated v6)", () => {
    for (const url of [DISCORD_OAUTH.tokenUrl, DISCORD_OAUTH.userinfoUrl]) {
      expect(new URL(url).pathname, url).toMatch(/^\/api\/v\d+\//);
    }
  });

  test("Google: the endpoints of its OpenID Connect discovery document and the scopes openid email profile", () => {
    expect(GOOGLE_OAUTH).toEqual({
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userinfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scopes: ["openid", "email", "profile"],
    });
  });
});

describe("getProviderClient", () => {
  test("is null for a provider that is not configured", () => {
    expect(getProviderClient("discord")).toBeNull();
    expect(getProviderClient("google")).toBeNull();
    expect(getProviderClient("test")).toBeNull();
  });

  test("Discord and Google carry their endpoints and their client, without the spaces around the values", () => {
    vi.stubEnv("DISCORD_CLIENT_ID", " id-de-discord ");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secreto-de-discord\n");
    vi.stubEnv("GOOGLE_CLIENT_ID", "id-de-google");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secreto-de-google");

    expect(getProviderClient("discord")).toEqual({
      provider: "discord",
      ...DISCORD_OAUTH,
      clientId: "id-de-discord",
      clientSecret: "secreto-de-discord",
    });
    expect(getProviderClient("google")).toEqual({
      provider: "google",
      ...GOOGLE_OAUTH,
      clientId: "id-de-google",
      clientSecret: "secreto-de-google",
    });
  });

  test("the test provider talks to PORTAL_OAUTH_TEST_ISSUER, with or without a trailing slash", () => {
    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3199/");

    expect(getProviderClient("test")).toMatchObject({
      provider: "test",
      authorizationUrl: "http://localhost:3199/authorize",
      tokenUrl: "http://localhost:3199/token",
      userinfoUrl: "http://localhost:3199/userinfo",
      scopes: ["openid", "email", "profile"],
    });
  });

  test.each(["production", "preview", "development"])(
    "there is no test provider on Vercel, whatever the environment (%s)",
    (vercelEnv) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3199");
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", vercelEnv);

      expect(getProviderClient("test")).toBeNull();
    },
  );

  test("there is no test provider with an issuer that is not an http address", () => {
    for (const issuer of ["no es una dirección", "ftp://localhost:3199", "javascript:alert(1)"]) {
      vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", issuer);
      expect(getProviderClient("test"), issuer).toBeNull();
    }
  });
});

describe("redirectUriFor", () => {
  test("Discord and Google come back to the public address of the site, wherever the request came from", () => {
    expect(redirectUriFor("discord", "http://otro-host.example")).toBe(`${SITE_URL}/api/portal/auth/discord/callback`);
    expect(redirectUriFor("google", "http://otro-host.example")).toBe(`${SITE_URL}/api/portal/auth/google/callback`);
  });

  test("the test provider comes back to the server that started the sign-in (the e2e one runs on its own port)", () => {
    expect(redirectUriFor("test", "http://localhost:3100")).toBe("http://localhost:3100/api/portal/auth/test/callback");
  });
});

describe("canonicalSignInUrl", () => {
  const SITE = new URL(SITE_URL);
  const LOOKALIKE = `${SITE.protocol}//${SITE.hostname}.evil.example${SITE.port ? `:${SITE.port}` : ""}`;

  test("Discord and Google: nothing to do on the public address of the site", () => {
    for (const provider of ["discord", "google"] as const) {
      expect(canonicalSignInUrl(provider, new URL(`${SITE_URL}/api/portal/auth/${provider}?locale=es`)), provider).toBeNull();
    }
  });

  test("Discord and Google: on any other origin, the same path and query on the public address", () => {
    const query = "?locale=pt&invitacion=abc";
    const other = ["http://otro-host.example", "https://www.otro-host.example:8443", LOOKALIKE];
    for (const provider of ["discord", "google"] as const) {
      for (const origin of other) {
        expect(canonicalSignInUrl(provider, new URL(`${origin}/api/portal/auth/${provider}${query}`)), origin).toBe(
          `${SITE_URL}/api/portal/auth/${provider}${query}`,
        );
      }
    }
  });

  test("the path cannot take the redirect to another site", () => {
    // `//evil.example` al principio de la ruta sería una dirección sin protocolo si se sumara mal.
    const url = new URL("http://otro-host.example//evil.example/x?y=1");

    expect(canonicalSignInUrl("discord", url)).toBe(`${SITE_URL}//evil.example/x?y=1`);
  });

  test("the test provider stays wherever the request came from", () => {
    expect(canonicalSignInUrl("test", new URL("http://localhost:3100/api/portal/auth/test"))).toBeNull();
  });
});

describe("profileToIdentity", () => {
  describe("Discord (`GET /users/@me`)", () => {
    const user = {
      id: "80351110224678912",
      username: "nelly",
      global_name: "Nelly",
      avatar: "8342729096ea3675442027381ff50dfe",
      email: "nelly@discord.com",
      verified: true,
    };

    test("takes the id, the display name and the verified email, and nothing else (no avatar)", () => {
      expect(profileToIdentity("discord", user)).toEqual({
        provider: "discord",
        providerUserId: "80351110224678912",
        displayName: "Nelly",
        email: "nelly@discord.com",
      });
    });

    test("falls back to the username when there is no global name", () => {
      expect(profileToIdentity("discord", { ...user, global_name: null })?.displayName).toBe("nelly");
      expect(profileToIdentity("discord", { ...user, global_name: "   " })?.displayName).toBe("nelly");
    });

    test("keeps the email only when Discord says it is verified", () => {
      expect(profileToIdentity("discord", { ...user, verified: false })?.email).toBeNull();
      expect(profileToIdentity("discord", { ...user, verified: "true" })?.email).toBeNull();
      expect(profileToIdentity("discord", without(user, "verified"))?.email).toBeNull();
      expect(profileToIdentity("discord", without(user, "email"))?.email).toBeNull();
    });

    test("is null without an id or without any name", () => {
      expect(profileToIdentity("discord", without(user, "id"))).toBeNull();
      expect(profileToIdentity("discord", { ...user, id: 80351110224678912 })).toBeNull();
      expect(profileToIdentity("discord", { ...user, global_name: null, username: "" })).toBeNull();
    });
  });

  describe("Google (OpenID Connect userinfo)", () => {
    const profile = {
      sub: "110169484474386276334",
      name: "Ana Pérez",
      given_name: "Ana",
      picture: "https://lh3.googleusercontent.com/a/foto",
      email: "ana@gmail.com",
      email_verified: true,
    };

    test("takes the sub, the name and the verified email, and nothing else (no picture)", () => {
      expect(profileToIdentity("google", profile)).toEqual({
        provider: "google",
        providerUserId: "110169484474386276334",
        displayName: "Ana Pérez",
        email: "ana@gmail.com",
      });
    });

    test("keeps the email only when Google says it is verified", () => {
      expect(profileToIdentity("google", { ...profile, email_verified: false })?.email).toBeNull();
      expect(profileToIdentity("google", { ...profile, email_verified: "true" })?.email).toBeNull();
    });

    test("without a name, shows the verified email; without either, there is no identity", () => {
      expect(profileToIdentity("google", { ...profile, name: undefined })?.displayName).toBe("ana@gmail.com");
      expect(profileToIdentity("google", { ...profile, name: undefined, email_verified: false })).toBeNull();
    });

    test("is null without a sub", () => {
      expect(profileToIdentity("google", { ...profile, sub: "" })).toBeNull();
      expect(profileToIdentity("google", { ...profile, sub: undefined })).toBeNull();
    });
  });

  describe("the test provider", () => {
    test("takes the sub, the name and the email", () => {
      expect(
        profileToIdentity("test", { sub: "alumno-1", name: "Alumno Uno", email: "alumno-1@example.com" }),
      ).toEqual({ provider: "test", providerUserId: "alumno-1", displayName: "Alumno Uno", email: "alumno-1@example.com" });
    });
  });

  test("anything that is not a profile is null", () => {
    for (const json of [null, undefined, "texto", 42, [], [{ sub: "x", name: "y" }]]) {
      expect(profileToIdentity("test", json), String(json)).toBeNull();
    }
  });

  test("cleans the name: no control characters, no spaces around, at most the maximum length", () => {
    const identity = profileToIdentity("test", {
      sub: "alumno-1",
      name: `  Ana\u0000\u0007 ${"x".repeat(500)}\n`,
    });

    expect(identity?.displayName.startsWith("Ana ")).toBe(true);
    expect(identity?.displayName).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(identity?.displayName).toHaveLength(MAX_DISPLAY_NAME_LENGTH);
  });

  test("an id with spaces or control characters, or too long, is not an id", () => {
    for (const sub of ["con espacio", "a\u0000b", "x".repeat(256)]) {
      expect(profileToIdentity("test", { sub, name: "Ana" }), sub).toBeNull();
    }
  });

  test("an email that does not look like one is dropped, the identity stays", () => {
    for (const email of ["sin-arroba", "a b@c.com", `${"x".repeat(250)}@example.com`, 42]) {
      expect(profileToIdentity("test", { sub: "alumno-1", name: "Ana", email })?.email, String(email)).toBeNull();
    }
  });
});
