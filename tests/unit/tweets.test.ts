import type { Tweet } from "react-tweet/api";
import { getTweet } from "react-tweet/api";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PLAYERS, playerByHandle } from "@/content/players";
import { TWEET_SNAPSHOTS } from "@/content/tweet-snapshots";
import { TWEET_IDS } from "@/content/tweets";
import {
  authorInitials,
  fetchTweetCards,
  getTweetCards,
  resolveTweet,
  toTweetCard,
  tweetTextParts,
  type TweetLoader,
} from "@/lib/tweets";
import {
  COACH_HANDLE,
  idsNewestFirst,
  readFixture as fixture,
} from "../helpers/tweet-fixtures";

// `cacheLife` solo existe dentro de un scope de "use cache" de Next; en Vitest
// no hay ninguno, así que se reemplaza por un espía que no hace nada y deja ver
// con qué perfiles se la llamó.
const { cacheLifeMock } = vi.hoisted(() => ({ cacheLifeMock: vi.fn() }));
vi.mock("next/cache", () => ({ cacheLife: cacheLifeMock }));
// `getTweet` es la única salida a la red: cada test decide qué contesta X.
vi.mock("react-tweet/api", () => ({ getTweet: vi.fn() }));

const NUMERIC_ID = /^\d+$/;
/** Un tweet guardado que sirve de base a los tests que lo modifican. */
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

  test("every tweet has a saved copy of X's response", () => {
    for (const id of TWEET_IDS) {
      expect(
        TWEET_SNAPSHOTS[id],
        `Falta la copia guardada del tweet ${id}: corré "npm run tweets:record -- ${id}"`,
      ).toBeDefined();
      expect(TWEET_SNAPSHOTS[id].id_str).toBe(id);
    }
  });

  test("every saved copy belongs to a listed tweet", () => {
    for (const id of Object.keys(TWEET_SNAPSHOTS)) {
      expect(
        TWEET_IDS.includes(id),
        `La copia ${id} no está en src/content/tweets.ts: sumá su ID a la lista o borrá src/content/tweet-snapshots/${id}.json y corré "npm run tweets:index"`,
      ).toBe(true);
    }
  });

  test("every tweet is by a listed player and tags the coach", () => {
    const handles = new Set(PLAYERS.map(({ handle }) => handle.toLowerCase()));

    for (const id of TWEET_IDS) {
      const { author, text } = toTweetCard(TWEET_SNAPSHOTS[id]);

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

  test("every author has a local photo, so no card shows the avatar from X", () => {
    for (const id of TWEET_IDS) {
      const { author } = toTweetCard(TWEET_SNAPSHOTS[id]);

      expect(
        playerByHandle(author.handle)?.photo,
        `@${author.handle} (tweet ${id}) no tiene foto local: corré "npm run players:photo -- ${author.handle}" y agregala en src/content/players.ts`,
      ).toBeDefined();
    }
  });
});

describe("toTweetCard", () => {
  test("maps a recorded tweet to a card", () => {
    const card = toTweetCard(fixture(TISCO_TWEET_ID));

    expect(card.id).toBe(TISCO_TWEET_ID);
    expect(card.author.handle).toBe("Tiscofn");
    expect(card.author.name).toBe("Tisco");
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

  test("carries no avatar from X: the card shows the local photo of the player", () => {
    for (const id of TWEET_IDS) {
      const { author } = toTweetCard(fixture(id));

      expect(Object.keys(author).sort(), id).toEqual(["handle", "name"]);
    }
  });

  test("does not need the avatar in the response from X", () => {
    const tweet = fixture(TISCO_TWEET_ID);
    const { profile_image_url_https, ...userWithoutAvatar } = tweet.user;
    void profile_image_url_https;

    const card = toTweetCard({ ...tweet, user: userWithoutAvatar as Tweet["user"] });

    expect(card.author).toEqual({ name: "Tisco", handle: "Tiscofn" });
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

describe("authorInitials", () => {
  test.each([
    ["Lewa", "LewaFn", "L"],
    ["Tomás Allami", "tallami1", "TA"],
    ["  mack  ftn  ", "mackftn", "MF"],
    ["Ana María Paula", "ana", "AM"],
    ["áñ", "x", "Á"],
    ["山田 太郎", "yamada", "山太"],
    ["K1ng", "k1ng", "K"],
    ["7even", "seven", "7"],
  ])("takes the initials of %j", (name, handle, expected) => {
    expect(authorInitials(name, handle)).toBe(expected);
  });

  test("skips emoji and symbols, which are not letters", () => {
    expect(authorInitials("🔥 LEWA 🔥", "lewafn")).toBe("L");
    expect(authorInitials("🔥🔥 Fazer ⚡ FN", "fazerfn")).toBe("FF");
  });

  test("falls back to the handle, and then to a question mark, so it is never empty", () => {
    expect(authorInitials("🔥🔥", "lewafn")).toBe("L");
    expect(authorInitials("", "_lewa_")).toBe("L");
    expect(authorInitials("🔥", "___")).toBe("?");
    expect(authorInitials("", "")).toBe("?");
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

  test("never leaves an empty part or two text parts in a row, in any recorded tweet", () => {
    for (const id of TWEET_IDS) {
      const parts = tweetTextParts(toTweetCard(fixture(id)).text);

      parts.forEach((part, index) => {
        expect(part.value, `tweet ${id}, parte ${index}`).not.toBe("");
        if (part.kind === "text") {
          expect(parts[index + 1]?.kind, `tweet ${id}, parte ${index}`).not.toBe(
            "text",
          );
        }
      });
    }
  });
});

// Los emojis salen como partes aparte para mostrarlos con imágenes de Twemoji
// (los de Windows 10 llegan como cuadraditos o letras). `code` es el nombre del
// archivo de Twemoji: la misma regla que su librería oficial.
describe("tweetTextParts emojis", () => {
  // Los caracteres invisibles van con nombre y escapados, para que se vean en el código.
  const VS16 = "\u{FE0F}"; // selector de variación: pide la versión emoji
  const ZWJ = "\u{200D}"; // une varios emojis en uno
  const KEYCAP_MARK = "\u{20E3}";
  const FAMILY = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`;

  // [descripción, emoji, nombre de archivo esperado]
  const CODES: [string, string, string][] = [
    ["a recent emoji", "🥲", "1f972"],
    ["another recent emoji", "🫡", "1fae1"],
    ["a flag (two regional indicators)", "🇦🇷", "1f1e6-1f1f7"],
    ["a heart with the variation selector (dropped)", `\u{2764}${VS16}`, "2764"],
    ["an emoji with a skin tone", "👍🏽", "1f44d-1f3fd"],
    ["a ZWJ sequence (joiners kept)", FAMILY, "1f468-200d-1f469-200d-1f467"],
    ["a keycap with the selector (dropped)", `1${VS16}${KEYCAP_MARK}`, "31-20e3"],
    ["a keycap without the selector", `1${KEYCAP_MARK}`, "31-20e3"],
    ["a hash keycap", `#${VS16}${KEYCAP_MARK}`, "23-20e3"],
    [
      "a ZWJ sequence keeps its variation selectors",
      `\u{1F441}${VS16}${ZWJ}\u{1F5E8}${VS16}`,
      "1f441-fe0f-200d-1f5e8-fe0f",
    ],
  ];

  for (const [description, emoji, code] of CODES) {
    test(`names the Twemoji file of ${description}`, () => {
      expect(tweetTextParts(emoji)).toEqual([
        { kind: "emoji", value: emoji, code },
      ]);
    });
  }

  test("splits mixed text into text, emoji, mentions and emoji, in order", () => {
    expect(tweetTextParts("1st 🥲 @romerofdps @tallami1 🇦🇷")).toEqual([
      { kind: "text", value: "1st " },
      { kind: "emoji", value: "🥲", code: "1f972" },
      { kind: "text", value: " " },
      { kind: "mention", value: "@romerofdps" },
      { kind: "text", value: " " },
      { kind: "self", value: "@tallami1" },
      { kind: "text", value: " " },
      { kind: "emoji", value: "🇦🇷", code: "1f1e6-1f1f7" },
    ]);
  });

  test("keeps the line breaks of the text around an emoji", () => {
    expect(tweetTextParts("gg 🥲\n\n@k1ng")).toEqual([
      { kind: "text", value: "gg " },
      { kind: "emoji", value: "🥲", code: "1f972" },
      { kind: "text", value: "\n\n" },
      { kind: "mention", value: "@k1ng" },
    ]);
  });

  test("each emoji in a row is its own part, and two flags stay two flags", () => {
    expect(tweetTextParts("🥲🥲")).toEqual([
      { kind: "emoji", value: "🥲", code: "1f972" },
      { kind: "emoji", value: "🥲", code: "1f972" },
    ]);
    expect(tweetTextParts("a🇦🇷🇸🇦b")).toEqual([
      { kind: "text", value: "a" },
      { kind: "emoji", value: "🇦🇷", code: "1f1e6-1f1f7" },
      { kind: "emoji", value: "🇸🇦", code: "1f1f8-1f1e6" },
      { kind: "text", value: "b" },
    ]);
  });

  test("an emoji glued to a mention does not break the mention", () => {
    expect(tweetTextParts("@tallami1🫡 @k1ng🥲")).toEqual([
      { kind: "self", value: "@tallami1" },
      { kind: "emoji", value: "🫡", code: "1fae1" },
      { kind: "text", value: " " },
      { kind: "mention", value: "@k1ng" },
      { kind: "emoji", value: "🥲", code: "1f972" },
    ]);
  });

  test("a lone regional indicator and keycap look-alikes stay text", () => {
    for (const text of ["\u{1F1E6} suelto", "#1 *2 3", "12/12 ($32.000) 100%"]) {
      expect(tweetTextParts(text)).toEqual([{ kind: "text", value: text }]);
    }
  });

  test("text without emojis is split exactly as before", () => {
    expect(tweetTextParts("1st @romerofdps @Tallami1 gg ñandú — ¿qué?")).toEqual([
      { kind: "text", value: "1st " },
      { kind: "mention", value: "@romerofdps" },
      { kind: "text", value: " " },
      { kind: "self", value: "@Tallami1" },
      { kind: "text", value: " gg ñandú — ¿qué?" },
    ]);
  });

  test("every emoji of a recorded tweet gets a well-formed Twemoji file name", () => {
    const FILE_NAME = /^[0-9a-f]+(-[0-9a-f]+)*$/;

    for (const id of TWEET_IDS) {
      const emojis = tweetTextParts(toTweetCard(fixture(id)).text).filter(
        (part) => part.kind === "emoji",
      );

      for (const emoji of emojis) {
        expect(emoji.code, `tweet ${id}`).toMatch(FILE_NAME);
        // El nombre de archivo y el emoji cuentan los mismos code points.
        const noSelector = emoji.value.includes(ZWJ)
          ? emoji.value
          : emoji.value.replaceAll(VS16, "");
        expect(emoji.code.split("-").length, `tweet ${id}`).toBe(
          [...noSelector].length,
        );
      }
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

// La decisión de qué tweet se muestra cuando X contesta, no contesta o falla.
// Es una función pura: el cargador en vivo y la copia guardada entran como datos.
describe("resolveTweet", () => {
  const snapshot = fixture(TISCO_TWEET_ID);
  const live: Tweet = { ...snapshot, text: "texto de hoy @tallami1" };
  const xIsDown: TweetLoader = async () => {
    throw new Error("X respondió 429");
  };

  test("uses the live tweet when X returns it, even if there is a copy", async () => {
    const load = vi.fn<TweetLoader>(async () => live);

    const result = await resolveTweet(TISCO_TWEET_ID, load, snapshot);

    expect(result.path).toBe("live");
    expect(result.tweet).toBe(live);
    expect(load).toHaveBeenCalledExactlyOnceWith(TISCO_TWEET_ID);
  });

  test("leaves the tweet out when X says it is gone, even if there is a copy", async () => {
    const result = await resolveTweet(
      TISCO_TWEET_ID,
      async () => undefined,
      snapshot,
    );

    expect(result.path).toBe("gone");
    expect(result.tweet).toBeUndefined();
  });

  test("uses the copy when X fails", async () => {
    const result = await resolveTweet(TISCO_TWEET_ID, xIsDown, snapshot);

    expect(result.path).toBe("snapshot");
    expect(result.tweet).toBe(snapshot);
    expect(result.error).toBeInstanceOf(Error);
  });

  test("leaves the tweet out when X fails and there is no copy", async () => {
    const result = await resolveTweet(TISCO_TWEET_ID, xIsDown, undefined);

    expect(result.path).toBe("unavailable");
    expect(result.tweet).toBeUndefined();
    expect(result.error).toBeInstanceOf(Error);
  });

  test("treats an answer that is not a tweet as X failing", async () => {
    const withCopy = await resolveTweet(
      TISCO_TWEET_ID,
      async () => ({}) as Tweet,
      snapshot,
    );
    const withoutCopy = await resolveTweet(
      TISCO_TWEET_ID,
      async () => ({ ...live, created_at: "ayer" }),
      undefined,
    );

    expect(withCopy.path).toBe("snapshot");
    expect(withCopy.tweet).toBe(snapshot);
    expect(withoutCopy.path).toBe("unavailable");
    expect(withoutCopy.tweet).toBeUndefined();
  });
});

describe("getTweetCards", () => {
  const getTweetMock = vi.mocked(getTweet);
  let info: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Sin esto, un `TWEETS_SOURCE` del entorno de quien corre los tests cambiaría el camino.
    vi.stubEnv("TWEETS_SOURCE", undefined);
    cacheLifeMock.mockClear();
    info = vi.spyOn(console, "info").mockImplementation(() => {});
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    getTweetMock.mockReset();
  });

  const idsOf = (cards: { id: string }[]) => cards.map((card) => card.id);
  const NEWEST_FIRST = idsNewestFirst(TWEET_IDS);

  describe("with TWEETS_SOURCE=snapshots", () => {
    beforeEach(() => {
      vi.stubEnv("TWEETS_SOURCE", "snapshots");
      getTweetMock.mockRejectedValue(new Error("esto no tendría que llamarse"));
    });

    test("uses only the saved copies and never calls X", async () => {
      const cards = await getTweetCards(TWEET_IDS);

      expect(idsOf(cards)).toEqual(NEWEST_FIRST);
      expect(getTweetMock).not.toHaveBeenCalled();
    });

    test("an id without a copy is left out and reported", async () => {
      const cards = await getTweetCards([TISCO_TWEET_ID, "111"]);

      expect(idsOf(cards)).toEqual([TISCO_TWEET_ID]);
      expect(error).toHaveBeenCalledWith(expect.stringContaining("111"));
      expect(getTweetMock).not.toHaveBeenCalled();
    });

    test("names every object has (constructor, __proto__) are not copies", async () => {
      const cards = await getTweetCards(["constructor", "__proto__", "toString"]);

      expect(cards).toEqual([]);
    });

    // Acá las copias son la fuente que se quiere, no un respaldo.
    test("keeps the cache for days: the copies are the intended source", async () => {
      await getTweetCards(TWEET_IDS);

      expect(cacheLifeMock.mock.calls).toEqual([["days"]]);
    });
  });

  describe("with X as the source", () => {
    test("asks X for every tweet and shows what X returns", async () => {
      getTweetMock.mockImplementation(async (id) => ({
        ...fixture(id),
        text: `${fixture(id).text} (en vivo)`,
      }));

      const cards = await getTweetCards(TWEET_IDS);

      expect(getTweetMock).toHaveBeenCalledTimes(TWEET_IDS.length);
      expect(idsOf(cards)).toEqual(NEWEST_FIRST);
      for (const card of cards) {
        expect(card.text).toMatch(/\(en vivo\)$/);
      }
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledTimes(TWEET_IDS.length);
    });

    // Si X falló, lo que se cacheó puede ser de las copias: la página se rehace
    // en minutos en lugar de en un día. `minutes` y no `seconds`: con menos de
    // 5 minutos de vida Next saca la sección del HTML estático.
    test("keeps the cache for days when every tweet is live", async () => {
      getTweetMock.mockImplementation(async (id) => fixture(id));

      await getTweetCards(TWEET_IDS);

      expect(cacheLifeMock.mock.calls).toEqual([["days"]]);
    });

    test("shortens the cache to minutes, once, when X failed for a tweet", async () => {
      getTweetMock.mockImplementation(async (id) => {
        if (id === TISCO_TWEET_ID) throw new Error("X respondió 503");
        return fixture(id);
      });

      await getTweetCards(TWEET_IDS);

      expect(cacheLifeMock.mock.calls).toEqual([["days"], ["minutes"]]);
    });

    test("shortens the cache to minutes, once, when X is down for every tweet", async () => {
      getTweetMock.mockRejectedValue(new Error("fetch failed"));

      await getTweetCards(TWEET_IDS);

      expect(cacheLifeMock.mock.calls).toEqual([["days"], ["minutes"]]);
    });

    test("shortens the cache to minutes when X failed and there is no copy", async () => {
      getTweetMock.mockRejectedValue(new Error("fetch failed"));

      await getTweetCards(["111"]);

      expect(cacheLifeMock.mock.calls).toEqual([["days"], ["minutes"]]);
    });

    test("keeps the cache for days when a tweet is simply gone", async () => {
      getTweetMock.mockImplementation(async (id) =>
        id === TISCO_TWEET_ID ? undefined : fixture(id),
      );

      await getTweetCards(TWEET_IDS);

      expect(cacheLifeMock.mock.calls).toEqual([["days"]]);
    });

    test("with X down, every card comes from the saved copies", async () => {
      getTweetMock.mockRejectedValue(new Error("fetch failed"));

      const cards = await getTweetCards(TWEET_IDS);

      expect(idsOf(cards)).toEqual(NEWEST_FIRST);
      expect(warn).toHaveBeenCalledTimes(TWEET_IDS.length);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("copia guardada"),
      );
    });

    test("when X fails for one tweet, the others stay live", async () => {
      getTweetMock.mockImplementation(async (id) => {
        if (id === TISCO_TWEET_ID) throw new Error("X respondió 503");
        return { ...fixture(id), text: `${fixture(id).text} (en vivo)` };
      });

      const cards = await getTweetCards(TWEET_IDS);
      const byId = new Map(cards.map((card) => [card.id, card]));

      expect(idsOf(cards)).toEqual(NEWEST_FIRST);
      expect(byId.get(TISCO_TWEET_ID)?.text).not.toMatch(/\(en vivo\)$/);
      expect(byId.get(NEWEST_FIRST[0])?.text).toMatch(/\(en vivo\)$/);
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(TISCO_TWEET_ID),
      );
    });

    test("a tweet X no longer has disappears even though it has a copy", async () => {
      getTweetMock.mockImplementation(async (id) =>
        id === TISCO_TWEET_ID ? undefined : fixture(id),
      );

      const cards = await getTweetCards(TWEET_IDS);

      expect(idsOf(cards)).toEqual(
        NEWEST_FIRST.filter((id) => id !== TISCO_TWEET_ID),
      );
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(TISCO_TWEET_ID),
      );
    });

    test("a tweet that X cannot give and that has no copy is left out and reported", async () => {
      getTweetMock.mockRejectedValue(new Error("fetch failed"));

      const cards = await getTweetCards([TISCO_TWEET_ID, "111"]);

      expect(idsOf(cards)).toEqual([TISCO_TWEET_ID]);
      expect(error).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("111"),
      );
    });
  });
});
