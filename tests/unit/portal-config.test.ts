import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { enabledProviders, getPortalSecret, isPortalConfigured } from "@/portal/config";
import { getProviderClient } from "@/portal/oauth/providers";
import { PORTAL_PROVIDERS } from "@/portal/policy";

const SECRET = "secreto-del-portal-de-mas-de-32-caracteres";

/** Una instalación vacía: ninguna variable del portal, fuera de Vercel y sin DATABASE_URL. */
function blankInstallation(): void {
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
}

beforeEach(blankInstallation);

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

  test("trims the spaces around the value, like the other variables: 32 spaces are not a secret", () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", " ".repeat(32));
    expect(getPortalSecret()).toBeNull();

    // 31 caracteres con espacios alrededor tampoco llegan al mínimo.
    vi.stubEnv("PORTAL_SESSION_SECRET", `  ${"a".repeat(31)}  `);
    expect(getPortalSecret()).toBeNull();

    vi.stubEnv("PORTAL_SESSION_SECRET", `\n${"a".repeat(32)} `);
    expect(getPortalSecret()).toEqual(new TextEncoder().encode("a".repeat(32)));
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

  test.each(["no es una dirección", "ftp://localhost:3199", "javascript:alert(1)", "localhost:3199"])(
    "the test provider is not listed when PORTAL_OAUTH_TEST_ISSUER is not an http(s) address (%s): its start route would be a 404",
    (issuer) => {
      vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", issuer);

      expect(enabledProviders()).toEqual([]);
    },
  );

  test("lists exactly the providers that have a client: the list and getProviderClient cannot disagree", () => {
    const setups: Record<string, string>[] = [
      {},
      { DISCORD_CLIENT_ID: "a", DISCORD_CLIENT_SECRET: "b" },
      { GOOGLE_CLIENT_ID: "a" },
      { PORTAL_OAUTH_TEST_ISSUER: "http://localhost:3199" },
      { PORTAL_OAUTH_TEST_ISSUER: "ftp://localhost:3199", GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" },
      { PORTAL_OAUTH_TEST_ISSUER: "http://localhost:3199", VERCEL: "1", GOOGLE_CLIENT_ID: "a", GOOGLE_CLIENT_SECRET: "b" },
    ];
    vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const setup of setups) {
      for (const [name, value] of Object.entries(setup)) vi.stubEnv(name, value);
      expect(enabledProviders(), JSON.stringify(Object.keys(setup))).toEqual(
        PORTAL_PROVIDERS.filter((provider) => getProviderClient(provider) !== null),
      );
      blankInstallation();
    }
  });

  test.each([
    ["production", "1"],
    ["preview", "1"],
    ["development", "1"],
    ["", "1"],
  ])("ignores the test provider on Vercel whatever the environment (VERCEL_ENV=%j, VERCEL=%s) and says so in the log", async (vercelEnv, vercel) => {
    // Un módulo nuevo: el aviso sale una sola vez por proceso y otro test pudo haberlo dado.
    vi.resetModules();
    const fresh = await import("@/portal/config");
    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3199");
    vi.stubEnv("VERCEL", vercel);
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(fresh.enabledProviders()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("PORTAL_OAUTH_TEST_ISSUER"));
  });

  test("outside Vercel the test provider is listed, and nothing is logged", () => {
    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3199");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(enabledProviders()).toEqual(["test"]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("says it only once per process, however many times the providers are asked for", async () => {
    vi.resetModules();
    const fresh = await import("@/portal/config");
    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3199");
    vi.stubEnv("VERCEL", "1");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (let i = 0; i < 5; i += 1) expect(fresh.enabledProviders()).toEqual([]);
    expect(fresh.isPortalConfigured()).toBe(false);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  test.each(["production", "preview"])("keeps the real providers on Vercel (%s)", (vercelEnv) => {
    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3199");
    vi.stubEnv("GOOGLE_CLIENT_ID", "id-de-google");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "secreto-de-google");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(enabledProviders()).toEqual(["google"]);
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

  test.each(["production", "preview"])("the test provider alone is not enough on Vercel (%s)", (vercelEnv) => {
    vi.stubEnv("PORTAL_SESSION_SECRET", SECRET);
    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "http://localhost:3199");
    vi.stubEnv("DATABASE_URL", "postgres://usuario:clave@host:6543/postgres");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(isPortalConfigured()).toBe(false);
  });

  test("the test provider with an address that does not work is not enough either", () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", SECRET);
    vi.stubEnv("PORTAL_OAUTH_TEST_ISSUER", "no es una dirección");

    expect(isPortalConfigured()).toBe(false);
  });
});
