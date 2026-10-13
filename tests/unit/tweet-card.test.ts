import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TweetCard } from "@/components/home/tweet-card";
import type { TweetCard as TweetCardData } from "@/lib/tweets";

const CARD: TweetCardData = {
  id: "2104290558906868129",
  url: "https://x.com/LewaFn/status/2104290558906868129",
  author: {
    name: "Lewa",
    handle: "LewaFn",
    avatarUrl:
      "https://pbs.twimg.com/profile_images/2091496317293903872/b2uVDrQ3_200x200.jpg",
  },
  text: "Top 14 ($32000) conned 12/12 🥲\n@romerofdps @tallami1",
  createdAt: "2026-09-27T19:22:19.000Z",
  image: {
    url: "https://pbs.twimg.com/media/HTPxG3WXkAA17Xr.jpg",
    width: 1600,
    height: 900,
  },
};

const LABEL = "Tweet de Lewa en X";
/** Los emojis del texto son imágenes de Twemoji; las demás (avatar, foto) tienen `alt=""`. */
const TWEMOJI_BASE_URL =
  "https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg";

function render(card: TweetCardData): string {
  return renderToStaticMarkup(
    createElement(TweetCard, {
      card,
      label: LABEL,
      date: "27 sept 2026",
      viewOnX: "Ver en X",
    }),
  );
}

/** Todas las etiquetas `<img>` del marcado. */
function imagesOf(markup: string): string[] {
  return markup.match(/<img [^>]*>/g) ?? [];
}

/** Las imágenes que no son emojis: el avatar y la foto del tweet. */
function pictureImagesOf(markup: string): string[] {
  return imagesOf(markup).filter((image) => !image.includes("twemoji"));
}

describe("TweetCard", () => {
  test("is one link to the tweet that opens X in a new tab", () => {
    const markup = render(CARD);

    expect(markup.match(/<a /g)).toHaveLength(1);
    expect(markup).toContain(`href="${CARD.url}"`);
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  test("starts its link name with the card label, then the tweet text and date", () => {
    const markup = render(CARD);

    const label = markup.indexOf(LABEL);
    const text = markup.indexOf("Top 14 ($32000)");
    const date = markup.indexOf("27 sept 2026");
    expect(label).toBeGreaterThan(-1);
    expect(text).toBeGreaterThan(label);
    expect(date).toBeGreaterThan(text);
    expect(markup).toContain('dateTime="2026-09-27T19:22:19.000Z"');
  });

  test("keeps the author header and the X mark out of the accessibility tree", () => {
    const markup = render(CARD);

    // El autor y la marca están en el bloque `aria-hidden`, entre el nombre
    // del link y el texto del tweet.
    const label = markup.indexOf(LABEL);
    const hidden = markup.indexOf('aria-hidden="true"');
    const handle = markup.indexOf("@LewaFn");
    const mark = markup.indexOf("𝕏");
    const text = markup.indexOf("Top 14 ($32000)");

    expect(label).toBeGreaterThan(-1);
    expect(hidden).toBeGreaterThan(label);
    expect(handle).toBeGreaterThan(hidden);
    expect(mark).toBeGreaterThan(handle);
    expect(text).toBeGreaterThan(mark);
  });

  test("hands the browser two photo sizes (1x and 2x), not the whole size list", () => {
    const markup = render(CARD);

    const photo = markup.slice(markup.lastIndexOf("<img"));
    expect(photo.match(/ \d(\.\d)?x[,"]/g)).toHaveLength(2);
    expect(photo).not.toContain("3840w");
  });

  test("shows the tweet photo lazily and without alt text", () => {
    const markup = render(CARD);
    const pictures = pictureImagesOf(markup);

    expect(pictures).toHaveLength(2);
    expect(pictures.at(-1)).toContain('loading="lazy"');
    for (const picture of pictures) {
      expect(picture).toContain('alt=""');
    }
  });

  test("a photo-only tweet has no empty text block", () => {
    const markup = render({ ...CARD, text: "" });

    expect(markup).not.toMatch(/<(span|p|div|b)\b[^>]*><\/(span|p|div|b)>/);
    expect(markup).toContain(LABEL);
    expect(markup).toContain("27 sept 2026");
    expect(imagesOf(markup)).toHaveLength(2);
  });

  test("a text-only tweet has no photo", () => {
    const { image, ...withoutImage } = CARD;
    void image;

    const markup = render(withoutImage);

    // Solo el avatar y el emoji del texto.
    expect(pictureImagesOf(markup)).toHaveLength(1);
    expect(markup).toContain("Top 14 ($32000)");
  });

  test("shows an emoji as a Twemoji image that falls back to the emoji itself", () => {
    const markup = render(CARD);

    const emojis = imagesOf(markup).filter((image) =>
      image.includes("twemoji"),
    );
    expect(emojis).toHaveLength(1);
    const [emoji] = emojis;
    expect(emoji).toContain(`src="${TWEMOJI_BASE_URL}/1f972.svg"`);
    expect(emoji).toContain('alt="🥲"');
    expect(emoji).toContain('draggable="false"');
    expect(emoji).toContain('loading="lazy"');
    expect(emoji).toContain('decoding="async"');
    expect(emoji).toMatch(/class="[^"]+"/);
    // La imagen reemplaza al carácter: no queda también como texto suelto.
    expect(markup.replace(emoji, "")).not.toContain("🥲");
  });

  test("keeps the text around each emoji, flags included", () => {
    const markup = render({ ...CARD, text: "12th ($30.000)🇦🇷\nqualed 🇸🇦 @tallami1" });

    expect(markup).toContain(`${TWEMOJI_BASE_URL}/1f1e6-1f1f7.svg`);
    expect(markup).toContain(`${TWEMOJI_BASE_URL}/1f1f8-1f1e6.svg`);
    expect(markup).toContain('alt="🇦🇷"');
    expect(markup).toContain('alt="🇸🇦"');
    expect(markup).toContain("12th ($30.000)");
    expect(markup).toContain("qualed ");
    expect(markup).toContain("@tallami1");
  });

  test("a tweet with no emojis has no Twemoji image", () => {
    const markup = render({ ...CARD, text: "Top 14 ($32000)\n@tallami1" });

    expect(markup).not.toContain("twemoji");
    expect(imagesOf(markup)).toHaveLength(2);
  });

  test("never turns text with markup into markup, emojis included", () => {
    const markup = render({
      ...CARD,
      text: "<img src=x onerror=alert(1)> 🥲 <b>gg</b>",
    });

    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(markup).toContain("&lt;b&gt;gg&lt;/b&gt;");
    expect(markup).not.toContain("<img src=x");
    expect(markup).not.toContain("<b>gg");
    expect(imagesOf(markup).filter((image) => image.includes("twemoji"))).toHaveLength(1);
  });

  test("shows tweet text as text, never as markup", () => {
    const markup = render({
      ...CARD,
      text: "<img src=x onerror=alert(1)> Q&A <3",
    });

    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(markup).toContain("Q&amp;A &lt;3");
    expect(markup).not.toContain("<img src=x");
  });

  test("keeps every mention and line break of the text", () => {
    const markup = render(CARD);

    expect(markup).toContain("@romerofdps");
    expect(markup).toContain("@tallami1");
    // El salto de línea sigue justo después de la imagen del emoji.
    expect(markup).toMatch(/alt="🥲"[^>]*>\n/);
  });
});
