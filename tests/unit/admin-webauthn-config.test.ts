import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getWebAuthnConfig } from "@/admin/auth/webauthn-config";

// El origen del sitio se resuelve al cargar `site-url.ts`: acá se fija, para no
// depender de las variables de la máquina que corre los tests.
vi.mock("@/lib/site-url", () => ({ SITE_URL: "https://tallami.example.com" }));

beforeEach(() => {
  vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", "");
  vi.stubEnv("VERCEL_ENV", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getWebAuthnConfig", () => {
  test("uses the origin of the public site and its hostname as the rpID", () => {
    expect(getWebAuthnConfig()).toEqual({
      rpID: "tallami.example.com",
      origin: "https://tallami.example.com",
      rpName: "Panel de Tallami",
    });
  });

  test("takes the test origin from ADMIN_WEBAUTHN_ORIGIN, with the port, and the rpID without it", () => {
    vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", "http://localhost:3100");

    expect(getWebAuthnConfig()).toEqual({
      rpID: "localhost",
      origin: "http://localhost:3100",
      rpName: "Panel de Tallami",
    });
  });

  test("keeps only the origin of ADMIN_WEBAUTHN_ORIGIN: no path, no trailing slash", () => {
    vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", " http://localhost:3101/admin/login/ ");

    expect(getWebAuthnConfig().origin).toBe("http://localhost:3101");
  });

  test("ignores ADMIN_WEBAUTHN_ORIGIN in Vercel production and says so in the log", () => {
    vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", "http://localhost:3100");
    vi.stubEnv("VERCEL_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(getWebAuthnConfig()).toEqual({
      rpID: "tallami.example.com",
      origin: "https://tallami.example.com",
      rpName: "Panel de Tallami",
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ADMIN_WEBAUTHN_ORIGIN"));
  });

  test("does not ignore ADMIN_WEBAUTHN_ORIGIN in a Vercel preview", () => {
    vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", "http://localhost:3100");
    vi.stubEnv("VERCEL_ENV", "preview");

    expect(getWebAuthnConfig().origin).toBe("http://localhost:3100");
  });

  test("treats a blank ADMIN_WEBAUTHN_ORIGIN as missing", () => {
    vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", "   ");

    expect(getWebAuthnConfig().origin).toBe("https://tallami.example.com");
  });

  test("fails loudly, naming the variable, when ADMIN_WEBAUTHN_ORIGIN is not an http(s) origin", () => {
    vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", "esto no es una url");
    expect(() => getWebAuthnConfig()).toThrow(/ADMIN_WEBAUTHN_ORIGIN/);

    vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", "ftp://localhost:21");
    expect(() => getWebAuthnConfig()).toThrow(/ADMIN_WEBAUTHN_ORIGIN/);
  });

  test("never reads the request: it takes no arguments and the module does not touch headers", () => {
    expect(getWebAuthnConfig.length).toBe(0);

    const source = readFileSync(new URL("../../src/admin/auth/webauthn-config.ts", import.meta.url), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
      .join("\n");
    expect(code).not.toMatch(/next\/headers|headers\(|\.headers\b|x-forwarded|\bhost\b/i);
  });
});
