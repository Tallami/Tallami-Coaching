import { hasRemoteMatch } from "next/dist/shared/lib/match-remote-pattern";
import { describe, expect, test } from "vitest";
import nextConfig from "../../next.config";

// El optimizador de imágenes de Next rechaza con 400 cualquier `url` que no
// coincida con `images.remotePatterns`. Se prueba con el mismo comparador que
// usa Next, sin pedir nada a la red.

const ALLOWED = [
  "https://pbs.twimg.com/profile_images/2091496317293903872/b2uVDrQ3_200x200.jpg",
  "https://pbs.twimg.com/media/HTPxG3WXkAA17Xr.jpg",
  "https://abs.twimg.com/sticky/default_profile_images/default_profile_200x200.png",
];

const REJECTED = [
  // Mismo servidor, sin https.
  "http://pbs.twimg.com/profile_images/x/y_200x200.jpg",
  "http://abs.twimg.com/sticky/default_profile_images/default_profile_200x200.png",
  // Otro servidor, o uno que solo se le parece.
  "https://evil.example.com/profile_images/x/y_200x200.jpg",
  "https://pbs.twimg.com.evil.example.com/media/abc.jpg",
  "https://evilpbs.twimg.com/media/abc.jpg",
  "https://twimg.com/media/abc.jpg",
  "https://video.twimg.com/media/abc.jpg",
];

function isAllowed(url: string): boolean {
  const { remotePatterns = [] } = nextConfig.images ?? {};
  return hasRemoteMatch([], [...remotePatterns], new URL(url));
}

describe("next.config serverExternalPackages", () => {
  test("keeps PGlite out of the server bundle, where its wasm files cannot load", () => {
    expect(nextConfig.serverExternalPackages).toContain("@electric-sql/pglite");
  });
});

describe("next.config images.remotePatterns", () => {
  test.each(ALLOWED)("allows %s", (url) => {
    expect(isAllowed(url)).toBe(true);
  });

  test.each(REJECTED)("rejects %s", (url) => {
    expect(isAllowed(url)).toBe(false);
  });

  test("lists only the two X image servers, over https", () => {
    const patterns = nextConfig.images?.remotePatterns ?? [];

    expect(patterns).toEqual([
      { protocol: "https", hostname: "pbs.twimg.com", pathname: "/**" },
      { protocol: "https", hostname: "abs.twimg.com", pathname: "/**" },
    ]);
  });
});
