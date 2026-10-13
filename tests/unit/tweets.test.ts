import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tweet } from "react-tweet/api";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PLAYERS } from "@/content/players";
import { TWEET_IDS } from "@/content/tweets";
import {
  fetchTweetCards,
  getTweetCards,
  toTweetCard,
  tweetTextParts,
} from "@/lib/tweets";
import {
  COACH_HANDLE,
  FIXTURE_DIR,
  idsNewestFirst,
  readFixture as fixture,
} from "../helpers/tweet-fixtures";

// `cacheLife` solo existe dentro de un scope de "use cache" de Next; en Vitest
// no hay ninguno, así que se reemplaza por una función vacía.
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

const NUMERIC_ID = /^\d+$/;
/** Un tweet grabado que sirve de base a los tests que lo modifican. */
const TISCO_TWEET_ID = "1964780083618685407";

// Sumar un tweet (su ID en `src/content/tweets.ts` y `npm run tweets:record --
// <id>`) no debe romper ningún test: lo que se comprueba son reglas que valen
// para cualquier lista, y la lista misma garantiza que cada tweet es real.
describe("TWEET_IDS", () => {
  test("has tweets, without repeats, and every id is a number", () => {
    expect(TWEET_IDS.length).toBeGreaterThan(0);
    expect(new Set(TWEET_IDS).size).toBe(TWEET_IDS.length);
    for (const id of TWEET_IDS) {
      expect(id).toMatch(NUMERIC_ID);
    }
  });

  test("every tweet has a recorded response", () => {
    for (const id of TWEET_IDS) {
      expect(
        existsSync(join(FIXTURE_DIR, `${id}.json`)),
        `Falta tests/fixtures/tweets/${id}.json: corré "npm run tweets:record -- ${id}"`,
      ).toBe(true);
      expect(fixture(id).id_str).toBe(id);
    }
  });

  test("every tweet is by a listed player and tags the coach", () => {
    const handles = new Set(PLAYERS.map(({ handle }) => handle.toLowerCase()));

    for (const id of TWEET_IDS) {
      const { author, text } = toTweetCard(fixture(id));

      expect(
        handles.has(author.handle.toLowerCase()),
        `El tweet ${id} es de @${author.handle}, que no está en src/content/players.ts`,
      ).toBe(true);
      expect(
        tweetTextParts(text).some((part) => part.kind === "self"),
        `El tweet ${id} no etiqueta a @${COACH_HANDLE}`,
      ).toBe(true);
    }
  });
});

describe("toTweetCard", () => {
  test("maps a recorded tweet to a card", () => {
    const card = toTweetCard(fixture(TISCO_TWEET_ID));

    expect(card.id).toBe(TISCO_TWEET_ID);
    expect(card.author.handle).toBe("Tiscofn");
    expect(card.author.name).toBe("Tisco");
    expect(card.author.avatarUrl).toMatch(
      /^https:\/\/pbs\.twimg\.com\/profile_images\//,
    );
    expect(card.url).toBe(`https://x.com/Tiscofn/status/${TISCO_TWEET_ID}`);
    expect(card.text).toBe(
      "12th FNCS Globals ($30.000)🇦🇷\n\n@CaduFN1 @StrykerFN1 @tallami1",
    );
    expect(card.createdAt).toBe("2025-09-07T19:57:30.000Z");
    expect(card.image?.url).toMatch(/^https:\/\/pbs\.twimg\.com\/media\//);
    expect(card.image?.width).toBeGreaterThan(0);
    expect(card.image?.height).toBeGreaterThan(0);
  });

  test("every recorded tweet becomes a card with no t.co link", () => {
    // La foto es opcional (ver "leaves out the image..."): un tweet de solo
    // texto también es una tarjeta válida.
    for (const id of TWEET_IDS) {
      const card = toTweetCard(fixture(id));
      expect(card.text).not.toContain("t.co/");
      expect(card.text).toBe(card.text.trim());
    }
  });

  test("decodes html entities and never returns markup", () => {
    const card = toTweetCard({
      ...fixture(TISCO_TWEET_ID),
      text: "Q&amp;A &lt;3 https://t.co/abc",
    });

    expect(card.text).toBe("Q&A <3");
  });

  test("decodes quotes and the escaped entity only once", () => {
    const card = toTweetCard({
      ...fixture(TISCO_TWEET_ID),
      text: "&quot;gg&quot; it&#39;s &amp;lt;b&amp;gt; &gt;:(",
    });

    expect(card.text).toBe(`"gg" it's &lt;b&gt; >:(`);
  });

  test("removes only the trailing t.co link", () => {
    const withLinkInside = toTweetCard({
      ...fixture(TISCO_TWEET_ID),
      text: "mirá https://t.co/aaa y https://example.com/x",
    });
    const withTrailingLink = toTweetCard({
      ...fixture(TISCO_TWEET_ID),
      text: "mirá https://t.co/aaa y https://t.co/bbb",
    });

    expect(withLinkInside.text).toBe("mirá https://t.co/aaa y https://example.com/x");
    expect(withTrailingLink.text).toBe("mirá https://t.co/aaa y");
  });

  test("leaves out the image when the tweet has no photo", () => {
    const { photos, ...withoutPhotos } = fixture(TISCO_TWEET_ID);
    void photos;
    const card = toTweetCard(withoutPhotos as Tweet);

    expect(card).not.toHaveProperty("image");
  });

  test("asks X for the sharp 200x200 avatar instead of the 48 px one", () => {
    for (const id of TWEET_IDS) {
      const { avatarUrl } = toTweetCard(fixture(id)).author;

      expect(avatarUrl).toMatch(/^https:\/\/pbs\.twimg\.com\/profile_images\//);
      expect(avatarUrl).toMatch(/_200x200\.(jpg|jpeg|png)$/);
      expect(avatarUrl).not.toContain("_normal");
    }
  });

  test("swaps the size suffix of the default avatar too, and nothing else", () => {
    const withAvatar = (profile_image_url_https: string) =>
      toTweetCard({
        ...fixture(TISCO_TWEET_ID),
        user: { ...fixture(TISCO_TWEET_ID).user, profile_image_url_https },
      }).author.avatarUrl;

    expect(
      withAvatar(
        "https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png",
      ),
    ).toBe(
      "https://abs.twimg.com/sticky/default_profile_images/default_profile_200x200.png",
    );
    // Sin el sufijo `_normal` la URL queda como vino.
    expect(withAvatar("https://pbs.twimg.com/profile_images/1/abc.jpg")).toBe(
      "https://pbs.twimg.com/profile_images/1/abc.jpg",
    );
    // Solo se cambia el sufijo del final: un `_normal` dentro del nombre no se toca.
    expect(
      withAvatar("https://pbs.twimg.com/profile_images/1/my_normal_pic_normal.jpg"),
    ).toBe("https://pbs.twimg.com/profile_images/1/my_normal_pic_200x200.jpg");
  });

  test("throws when the date is missing or is not a date", () => {
    for (const created_at of ["", "ayer", "2026-13-45T99:99:99.000Z"]) {
      expect(
        () => toTweetCard({ ...fixture(TISCO_TWEET_ID), created_at }),
        created_at,
      ).toThrow(/created_at/);
    }
  });
});

describe("tweetTextParts", () => {
  test("splits mentions and highlights the coach", () => {
    expect(tweetTextParts("1st @romerofdps @Tallami1 gg")).toEqual([
      { kind: "text", value: "1st " },
      { kind: "mention", value: "@romerofdps" },
      { kind: "text", value: " " },
      { kind: "self", value: "@Tallami1" },
      { kind: "text", value: " gg" },
    ]);
  });

  test("returns plain text as a single part and nothing for empty text", () => {
    expect(tweetTextParts("5th EWC FINALS ($45000)")).toEqual([
      { kind: "text", value: "5th EWC FINALS ($45000)" },
    ]);
    expect(tweetTextParts("")).toEqual([]);
  });

  test("handles mentions at the edges and several in a row", () => {
    expect(tweetTextParts("@tallami1 @k1ng")).toEqual([
      { kind: "self", value: "@tallami1" },
      { kind: "text", value: " " },
      { kind: "mention", value: "@k1ng" },
    ]);
  });

  test("only the exact coach handle is highlighted", () => {
    expect(tweetTextParts("@tallami10 @TALLAMI1")).toEqual([
      { kind: "mention", value: "@tallami10" },
      { kind: "text", value: " " },
      { kind: "self", value: "@TALLAMI1" },
    ]);
  });

  test("does not treat the middle of an email address as a mention", () => {
    expect(tweetTextParts("escribime a coach@tallami1.com")).toEqual([
      { kind: "text", value: "escribime a coach@tallami1.com" },
    ]);
  });

  test("keeps the whole text when the parts are joined", () => {
    for (const id of TWEET_IDS) {
      const { text } = toTweetCard(fixture(id));
      const joined = tweetTextParts(text)
        .map((part) => part.value)
        .join("");
      expect(joined).toBe(text);
    }
  });
});

describe("fetchTweetCards", () => {
  test("skips tweets that fail or no longer exist", async () => {
    const load = async (id: string) => {
      if (id === "a") throw new Error("X no responde");
      if (id === "b") return undefined;
      return fixture(TISCO_TWEET_ID);
    };

    const cards = await fetchTweetCards(["a", "b", "c"], load);

    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(TISCO_TWEET_ID);
  });

  test("skips a response that is not a tweet", async () => {
    const cards = await fetchTweetCards(["a", "b"], async (id) =>
      id === "a" ? ({} as Tweet) : fixture(TISCO_TWEET_ID),
    );

    expect(cards.map((card) => card.id)).toEqual([TISCO_TWEET_ID]);
  });

  test("sorts newest first, whatever the order of the ids", async () => {
    const load = async (id: string) => fixture(id);

    const forward = await fetchTweetCards(TWEET_IDS, load);
    const backward = await fetchTweetCards([...TWEET_IDS].reverse(), load);
    const expected = idsNewestFirst(TWEET_IDS);

    expect(forward).toHaveLength(TWEET_IDS.length);
    expect(forward.map((card) => card.id)).toEqual(expected);
    expect(backward.map((card) => card.id)).toEqual(expected);
  });

  test("breaks a tie on the date with the larger numeric id first", async () => {
    const sameMoment = { ...fixture(TISCO_TWEET_ID) };
    // "99" es mayor que "100" como texto, pero "100" es el tweet más nuevo.
    const load = async (id: string) => ({ ...sameMoment, id_str: id });

    const cards = await fetchTweetCards(["99", "100", "98"], load);

    expect(cards.map((card) => card.id)).toEqual(["100", "99", "98"]);
  });

  test("skips a tweet with a bad date and reports it, keeping the others", async () => {
    const skipped: string[] = [];
    const load = async (id: string) =>
      id === "a"
        ? { ...fixture(TISCO_TWEET_ID), created_at: "ayer" }
        : fixture(TISCO_TWEET_ID);

    const cards = await fetchTweetCards(["a", "b"], load, (id) =>
      skipped.push(id),
    );

    expect(cards.map((card) => card.id)).toEqual([TISCO_TWEET_ID]);
    expect(skipped).toEqual(["a"]);
  });

  test("returns an empty list when every tweet fails", async () => {
    const failing = await fetchTweetCards(TWEET_IDS, async () => {
      throw new Error("X no responde");
    });
    const missing = await fetchTweetCards(TWEET_IDS, async () => undefined);

    expect(failing).toEqual([]);
    expect(missing).toEqual([]);
  });
});

describe("getTweetCards with recorded responses", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function useFixtureDir(dir: string) {
    vi.stubEnv("TWEETS_FIXTURE_DIR", dir);
    vi.spyOn(console, "error").mockImplementation(() => {});
  }

  test("reads <dir>/<id>.json instead of calling X", async () => {
    useFixtureDir(FIXTURE_DIR);

    const cards = await getTweetCards(TWEET_IDS);

    expect(cards.map((card) => card.id)).toEqual(idsNewestFirst(TWEET_IDS));
  });

  test("a missing or invalid file counts as a failed tweet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tweets-"));
    tempDirs.push(dir);
    writeFileSync(
      join(dir, `${TISCO_TWEET_ID}.json`),
      JSON.stringify(fixture(TISCO_TWEET_ID)),
    );
    writeFileSync(join(dir, "111.json"), "esto no es JSON");
    writeFileSync(join(dir, "222.json"), "{}");
    useFixtureDir(dir);

    const cards = await getTweetCards([TISCO_TWEET_ID, "111", "222", "333"]);

    expect(cards.map((card) => card.id)).toEqual([TISCO_TWEET_ID]);
  });

  test("an id that is not a number never leaves the fixture directory", async () => {
    useFixtureDir(FIXTURE_DIR);

    const cards = await getTweetCards(["../fixtures/tweets/" + TISCO_TWEET_ID]);

    expect(cards).toEqual([]);
  });

  test("an empty fixture directory gives an empty list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tweets-"));
    tempDirs.push(dir);
    useFixtureDir(dir);

    expect(await getTweetCards(TWEET_IDS)).toEqual([]);
  });
});
