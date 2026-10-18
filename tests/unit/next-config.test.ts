import { hasRemoteMatch } from "next/dist/shared/lib/match-remote-pattern";
import { describe, expect, test } from "vitest";
import nextConfig from "../../next.config";
import { TWEET_SNAPSHOTS } from "@/content/tweet-snapshots";
import { toTweetCard } from "@/lib/tweets";

// El optimizador de imágenes de Next rechaza con 400 cualquier `url` que no
// coincida con `images.remotePatterns`. Se prueba con el mismo comparador que
// usa Next, sin pedir nada a la red.

// Las tarjetas de Reviews solo piden la primera foto de cada tweet (`photos` en
// `src/lib/tweets.ts`): todas viven en `/media/`. El avatar de X no se usa
// (las tarjetas muestran la foto local del jugador) y los videos no entran.
const ALLOWED = [
  "https://pbs.twimg.com/media/HTPxG3WXkAA17Xr.jpg",
  "https://pbs.twimg.com/media/HTPxG3WXkAA17Xr?format=jpg&name=small",
];

const REJECTED = [
  // Mismo servidor, pero lo que no usa ninguna tarjeta ya no pasa: avatares y miniaturas de video.
  "https://pbs.twimg.com/profile_images/2091496317293903872/b2uVDrQ3_200x200.jpg",
  "https://pbs.twimg.com/ext_tw_video_thumb/1/pu/img/abc.jpg",
  "https://pbs.twimg.com/amplify_video_thumb/1/img/abc.jpg",
  "https://pbs.twimg.com/",
  // Mismo servidor y camino, sin https.
  "http://pbs.twimg.com/media/HTPxG3WXkAA17Xr.jpg",
  // El avatar por defecto de X ya no se usa: las tarjetas muestran la foto local del jugador.
  "https://abs.twimg.com/sticky/default_profile_images/default_profile_200x200.png",
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

  test("every photo of the saved tweets still goes through the optimizer", () => {
    const photos = Object.values(TWEET_SNAPSHOTS)
      .map((tweet) => toTweetCard(tweet).image?.url)
      .filter((url): url is string => url !== undefined);

    // Si una copia nueva trajera una foto de otro camino (un video, por ejemplo), el
    // patrón de arriba la rechazaría con un 400 y la tarjeta quedaría con una imagen rota.
    expect(photos.length).toBeGreaterThan(0);
    for (const url of photos) expect(isAllowed(url), url).toBe(true);
  });

  test("lists only the photos of the tweet cards: the X server, over https, under /media/", () => {
    const patterns = nextConfig.images?.remotePatterns ?? [];

    expect(patterns).toEqual([{ protocol: "https", hostname: "pbs.twimg.com", pathname: "/media/**" }]);
  });
});
