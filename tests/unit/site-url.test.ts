import { describe, expect, test } from "vitest";
import { resolveSiteUrl } from "../../src/lib/site-url";

const LOCALHOST = "http://localhost:3000";

describe("resolveSiteUrl", () => {
  test("uses NEXT_PUBLIC_SITE_URL when it is set", () => {
    expect(resolveSiteUrl("https://tallami.com", undefined)).toBe(
      "https://tallami.com",
    );
  });

  test("prefers NEXT_PUBLIC_SITE_URL over the Vercel production domain", () => {
    expect(
      resolveSiteUrl("https://tallami.com", "tallami-coaching.vercel.app"),
    ).toBe("https://tallami.com");
  });

  test("falls back to the Vercel production domain over https", () => {
    expect(resolveSiteUrl(undefined, "tallami-coaching.vercel.app")).toBe(
      "https://tallami-coaching.vercel.app",
    );
  });

  test("treats an empty or blank NEXT_PUBLIC_SITE_URL as missing", () => {
    expect(resolveSiteUrl("", "tallami-coaching.vercel.app")).toBe(
      "https://tallami-coaching.vercel.app",
    );
    expect(resolveSiteUrl("   ", "tallami-coaching.vercel.app")).toBe(
      "https://tallami-coaching.vercel.app",
    );
  });

  test("falls back to localhost when neither variable is set", () => {
    expect(resolveSiteUrl(undefined, undefined)).toBe(LOCALHOST);
  });

  test("treats an empty or blank Vercel domain as missing", () => {
    expect(resolveSiteUrl(undefined, "")).toBe(LOCALHOST);
    expect(resolveSiteUrl("  ", "   ")).toBe(LOCALHOST);
  });

  test("drops trailing slashes from either source", () => {
    expect(resolveSiteUrl("https://tallami.com/", undefined)).toBe(
      "https://tallami.com",
    );
    expect(resolveSiteUrl("https://tallami.com///", undefined)).toBe(
      "https://tallami.com",
    );
    expect(resolveSiteUrl(undefined, "tallami-coaching.vercel.app/")).toBe(
      "https://tallami-coaching.vercel.app",
    );
  });

  test("keeps a clean origin as it is", () => {
    expect(resolveSiteUrl("https://tallami.com", undefined)).toBe(
      "https://tallami.com",
    );
  });
});
