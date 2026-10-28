import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { enabledProviders, getPortalSecret, isPortalConfigured } from "@/portal/config";

const SECRET = "secreto-del-portal-de-mas-de-32-caracteres";

/** Una instalación vacía: ninguna variable del portal, fuera de Vercel y sin DATABASE_URL. */
beforeEach(() => {
  for (const name of [
    "PORTAL_SESSION_SECRET",
    "DISCORD_CLIENT_ID",
    "DISCORD_CLIENT_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "PORTAL_OAUTH_TEST_ISSUER",
    "VERCEL",
    "VERCEL_ENV",
    "DATABASE_URL",
  ]) {
    vi.stubEnv(name, "");
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getPortalSecret", () => {
  test("is null when the variable is missing", () => {
    expect(getPortalSecret()).toBeNull();
  });

  test("is null when it is shorter than 32 characters", () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", "a".repeat(31));

    expect(getPortalSecret()).toBeNull();
  });

  test("returns the bytes of a secret of 32 characters or more", () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", "a".repeat(32));

    expect(getPortalSecret()).toEqual(new TextEncoder().encode("a".repeat(32)));
  });

  test("does not fall back to the secret of the admin panel", () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);

    expect(getPortalSecret()).toBeNull();
  });
});

describe("enabledProviders", () => {
  test("is empty when nothing is configured", () => {
    expect(enabledProviders()).toEqual([]);
  });

  test("lists a provider only when it has both its id and its secret", () => {
    vi.stubEnv("DISCORD_CLIENT_ID", "id-de-discord");
    expect(enabledProviders()).toEqual([]);

    vi.stubEnv("DISCORD_CLIENT_SECRET", "secreto-de-discord");
    expect(enabledProviders()).toEqual(["discord"]);
  });

  test("a provider without its secret does not show up, whatever the others have", () => {
    vi.stubEnv("DISCORD_CLIENT_ID", "id-de-discord");
    vi.stubEnv("GOOGLE_CLIENT_ID", "id-de-google");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secreto-de-google");

    expect(enabledProviders()).toEqual(["google"]);
  });

  test("a blank id or secret counts as missing", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "   ");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secreto-de-google");

    expect(enabledProviders()).toEqual([]);
  });

  test("lists discord, then google, when both are configured", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "id-de-google");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secreto-de-google");
    vi.stubEnv("DISCORD_CLIENT_ID", "id-de-discord");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secreto-de-discord");

    expect(enabledProviders()).toEqual(["discord", "google"]);
  });

  test("the test provider needs PORTAL_OAUTH_TEST_ISSUER", () => {
    expect(enabledProviders()).not.toContain("test");

    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3199");
    expect(enabledProviders()).toEqual(["test"]);
  });

  test("ignores the test provider in Vercel production and says so in the log", () => {
    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3199");
    vi.stubEnv("VERCEL_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(enabledProviders()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("PORTAL_OAUTH_TEST_ISSUER"));
  });

  test("keeps the real providers in Vercel production", () => {
    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3199");
    vi.stubEnv("GOOGLE_CLIENT_ID", "id-de-google");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secreto-de-google");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(enabledProviders()).toEqual(["google"]);
  });

  test("does not ignore the test provider in a Vercel preview, nor warn", () => {
    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3199");
    vi.stubEnv("VERCEL_ENV", "preview");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(enabledProviders()).toEqual(["test"]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("isPortalConfigured", () => {
  function configureEverything(): void {
    vi.stubEnv("PORTAL_SESSION_SECRET", SECRET);
    vi.stubEnv("GOOGLE_CLIENT_ID", "id-de-google");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secreto-de-google");
  }

  test("is false on an empty installation", () => {
    expect(isPortalConfigured()).toBe(false);
  });

  test("is true with a secret, a provider and a database (the local one, outside Vercel)", () => {
    configureEverything();

    expect(isPortalConfigured()).toBe(true);
  });

  test("is false without the secret", () => {
    configureEverything();
    vi.stubEnv("PORTAL_SESSION_SECRET", "");

    expect(isPortalConfigured()).toBe(false);
  });

  test("is false with a secret that is too short", () => {
    configureEverything();
    vi.stubEnv("PORTAL_SESSION_SECRET", "corto");

    expect(isPortalConfigured()).toBe(false);
  });

  test("is false without any provider", () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", SECRET);

    expect(isPortalConfigured()).toBe(false);
  });

  test("is false in Vercel without DATABASE_URL, and true with it", () => {
    configureEverything();
    vi.stubEnv("VERCEL", "1");
    expect(isPortalConfigured()).toBe(false);

    vi.stubEnv("DATABASE_URL", "postgres://usuario:clave@host:6543/postgres");
    expect(isPortalConfigured()).toBe(true);
  });

  test("the test provider alone is not enough in Vercel production", () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", SECRET);
    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3199");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(isPortalConfigured()).toBe(false);
  });
});
