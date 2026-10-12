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

    expect(markup).toContain('loading="lazy"');
    expect(markup.match(/<img /g)).toHaveLength(2);
    expect(markup.match(/alt=""/g)).toHaveLength(2);
  });

  test("a photo-only tweet has no empty text block", () => {
    const markup = render({ ...CARD, text: "" });

    expect(markup).not.toMatch(/<(span|p|div|b)\b[^>]*><\/(span|p|div|b)>/);
    expect(markup).toContain(LABEL);
    expect(markup).toContain("27 sept 2026");
    expect(markup.match(/<img /g)).toHaveLength(2);
  });

  test("a text-only tweet has no photo", () => {
    const { image, ...withoutImage } = CARD;
    void image;

    const markup = render(withoutImage);

    expect(markup.match(/<img /g)).toHaveLength(1);
    expect(markup).toContain("Top 14 ($32000)");
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
    expect(markup).toContain("🥲\n");
  });
});
