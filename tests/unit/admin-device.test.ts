import { describe, expect, test } from "vitest";
import { describeDevice } from "@/admin/auth/device";

// User-agent reales, como los mandan los navegadores.
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const FIREFOX_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0";
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const CHROME_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

describe("describeDevice", () => {
  test.each([
    ["Chrome on Windows 10", CHROME_WINDOWS, "Chrome en Windows"],
    ["Edge on Windows", EDGE_WINDOWS, "Edge en Windows"],
    ["Safari on iPhone", SAFARI_IPHONE, "Safari en iPhone"],
    ["Chrome on iPhone", CHROME_IPHONE, "Chrome en iPhone"],
    ["Chrome on Android", CHROME_ANDROID, "Chrome en Android"],
    ["Firefox on Mac", FIREFOX_MAC, "Firefox en Mac"],
    ["Safari on Mac", SAFARI_MAC, "Safari en Mac"],
    ["Chrome on Linux", CHROME_LINUX, "Chrome en Linux"],
  ])("describes %s in a few words", (_label, userAgent, expected) => {
    expect(describeDevice(userAgent)).toBe(expected);
  });

  test.each([null, "", "   ", "curl/8.4.0", "algo que no es un user-agent"])(
    "says the browser is unknown for %j",
    (userAgent) => {
      expect(describeDevice(userAgent)).toBe("Navegador desconocido");
    },
  );

  test("never exceeds sixty characters, whatever the header holds", () => {
    const hostile = `Mozilla/5.0 (${"X".repeat(5000)}) Chrome/130.0.0.0 ${"Safari/537.36 ".repeat(500)}`;

    for (const userAgent of [hostile, "A".repeat(100_000), CHROME_WINDOWS]) {
      expect(describeDevice(userAgent).length).toBeLessThanOrEqual(60);
    }
  });

  test("names only the browser when the system is not recognized", () => {
    expect(describeDevice("Mozilla/5.0 (PlayStation 5) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15")).toBe(
      "Safari",
    );
  });
});
