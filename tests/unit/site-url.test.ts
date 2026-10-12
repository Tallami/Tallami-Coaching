import { describe, expect, test } from "vitest";
import { normalizeSiteUrl } from "../../src/lib/site-url";

describe("normalizeSiteUrl", () => {
  test("falls back to localhost when the variable is missing", () => {
    expect(normalizeSiteUrl(undefined)).toBe("http://localhost:3000");
  });

  test("treats an empty or blank value as missing", () => {
    expect(normalizeSiteUrl("")).toBe("http://localhost:3000");
    expect(normalizeSiteUrl("   ")).toBe("http://localhost:3000");
  });

  test("drops trailing slashes", () => {
    expect(normalizeSiteUrl("https://tallami.com/")).toBe(
      "https://tallami.com",
    );
    expect(normalizeSiteUrl("https://tallami.com///")).toBe(
      "https://tallami.com",
    );
  });

  test("keeps a clean origin as it is", () => {
    expect(normalizeSiteUrl("https://tallami.com")).toBe("https://tallami.com");
  });
});
