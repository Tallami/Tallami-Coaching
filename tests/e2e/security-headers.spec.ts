import { expect, test } from "@playwright/test";

const BASELINE_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
} as const;

/** Una página estática, el 404 dinámico y un archivo para buscadores. */
const PATHS = ["/es", "/en/no-existe", "/robots.txt"] as const;

test.describe("security headers", () => {
  for (const path of PATHS) {
    test(`${path} carries the baseline security headers`, async ({
      request,
    }) => {
      const response = await request.get(path);

      for (const [name, value] of Object.entries(BASELINE_HEADERS)) {
        expect(response.headers()[name], `${path}: ${name}`).toBe(value);
      }
    });
  }
});
