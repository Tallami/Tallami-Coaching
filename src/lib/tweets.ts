// Datos de los tweets de la sección "Reviews". Solo para Server Components: baja
// los tweets de X (con la copia guardada de cada uno como respaldo, ver
// `resolveTweet`), los pasa a `TweetCard` y los cachea un día. Los IDs salen de
// `src/content/tweets.ts` y las copias de `src/content/tweet-snapshots`.

import { cacheLife } from "next/cache";
import { getTweet } from "react-tweet/api";
import type { Tweet } from "react-tweet/api";
import { TWEET_SNAPSHOTS } from "@/content/tweet-snapshots";

export type TweetCard = {
  id: string;
  /** `https://x.com/<usuario>/status/<id>`. */
  url: string;
  /** `avatarUrl` es el avatar de 200x200 (X manda el de 48 px; ver `sharpAvatarUrl`). */
  author: { name: string; handle: string; avatarUrl: string };
  /** Texto plano: sin el link `t.co` final y con las entidades HTML decodificadas. */
  text: string;
  /** Fecha de publicación, ISO 8601. */
  createdAt: string;
  /** Primera foto del tweet; falta si el tweet no tiene fotos. */
  image?: { url: string; width: number; height: number };
};

export type TweetTextPart =
  | { kind: "text" | "mention" | "self"; value: string }
  /** `code` es el nombre del archivo de Twemoji (`<code>.svg`). */
  | { kind: "emoji"; value: string; code: string };

export type TweetLoader = (id: string) => Promise<Tweet | undefined>;

/**
 * Qué camino siguió un tweet:
 * - `live`: X lo devolvió y se usa ese dato.
 * - `gone`: X contestó que ya no existe (borrado o privado): no se muestra.
 * - `snapshot`: X falló y se usa la copia guardada.
 * - `unavailable`: X falló y no hay copia: no se muestra.
 */
export type TweetPath = "live" | "gone" | "snapshot" | "unavailable";

export type TweetResolution = {
  /** El tweet a mostrar; falta en `gone` y `unavailable`. */
  tweet: Tweet | undefined;
  path: TweetPath;
  /** Por qué falló X; solo en `snapshot` y `unavailable`. */
  error?: unknown;
};

/** Usuario del coach en X: sus menciones se resaltan en las tarjetas. */
const COACH_MENTION = "@tallami1";

/**
 * Variable de entorno que, con el valor `snapshots`, reemplaza a X por las
 * copias guardadas: no se llama a X (tests e2e). En producción no se define.
 */
const SOURCE_ENV = "TWEETS_SOURCE";
const SNAPSHOTS_SOURCE = "snapshots";

/** Si X no contesta en este tiempo, el tweet cuenta como fallado y no frena el build. */
const X_REQUEST_TIMEOUT_MS = 10_000;

const TRAILING_SHORT_LINK = /\s*https:\/\/t\.co\/\w+\s*$/;
const NORMAL_AVATAR_SUFFIX = /_normal(\.\w+)$/;
const MENTION = /@\w+/g;
const WORD_CHARACTER = /[\w@]/;

/** Un grafema es un emoji si tiene un pictograma, es una bandera o es un keycap. */
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const FLAG = /^\p{Regional_Indicator}{2}$/u;
// Keycap: dígito, # o * + U+FE0F (selector de emoji, opcional) + U+20E3.
const KEYCAP = /^[0-9#*]\u{FE0F}?\u{20E3}$/u;
const ZERO_WIDTH_JOINER = "\u{200D}";
const VARIATION_SELECTOR_16 = /\u{FE0F}/gu;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Las únicas entidades que usa X en el texto de un tweet. */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
};
const HTML_ENTITY = /&(amp|lt|gt|quot|#39);/g;

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`La respuesta de X no trae ${field}`);
  }
  return value;
}

/**
 * Saca el link `t.co` final (apunta a la foto) y decodifica las entidades en
 * una sola pasada, para que `&amp;lt;` quede como el texto `&lt;` y no como
 * `<`. Nunca arma HTML: el resultado es texto que React escapa al mostrarlo.
 */
function cleanTweetText(rawText: string): string {
  return rawText
    .replace(TRAILING_SHORT_LINK, "")
    .replace(HTML_ENTITY, (_entity, name: string) => HTML_ENTITIES[name])
    .trim();
}

/**
 * X manda el avatar de 48 px (`..._normal.jpg`), que se ve borroso a 40 px en
 * pantallas 2x y 3x. El mismo archivo existe en 200x200: se pide ese. Una URL
 * sin el sufijo `_normal` al final queda como vino.
 */
function sharpAvatarUrl(url: string): string {
  return url.replace(NORMAL_AVATAR_SUFFIX, "_200x200$1");
}

/** Fecha ISO que se puede leer; si no, tira error (la tarjeta no se arma). */
function requireDate(value: unknown): string {
  const text = requireText(value, "created_at");
  if (Number.isNaN(Date.parse(text))) {
    throw new Error(`La respuesta de X trae un created_at que no es una fecha: ${text}`);
  }
  return text;
}

function firstPhoto(tweet: Tweet): TweetCard["image"] {
  const photo = tweet.photos?.[0];
  if (!photo || typeof photo.url !== "string" || photo.url === "") {
    return undefined;
  }
  if (!(photo.width > 0) || !(photo.height > 0)) return undefined;
  return { url: photo.url, width: photo.width, height: photo.height };
}

/** Pasa la respuesta de X a la tarjeta de la web. Tira error si falta un dato clave. */
export function toTweetCard(tweet: Tweet): TweetCard {
  const id = requireText(tweet.id_str, "id_str");
  const handle = requireText(tweet.user?.screen_name, "user.screen_name");
  const image = firstPhoto(tweet);

  return {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    author: {
      name: requireText(tweet.user.name, "user.name"),
      handle,
      avatarUrl: sharpAvatarUrl(
        requireText(
          tweet.user.profile_image_url_https,
          "user.profile_image_url_https",
        ),
      ),
    },
    text: cleanTweetText(requireText(tweet.text, "text")),
    createdAt: requireDate(tweet.created_at),
    ...(image && { image }),
  };
}

function isEmoji(grapheme: string): boolean {
  return (
    PICTOGRAPH.test(grapheme) ||
    FLAG.test(grapheme) ||
    KEYCAP.test(grapheme)
  );
}

/**
 * Nombre del archivo de Twemoji (sin `.svg`) de un emoji, con la misma regla
 * que su librería oficial: sin ZWJ se le quita el selector de variación
 * U+FE0F; después, los code points en hexadecimal minúscula unidos por `-`.
 */
function twemojiCode(emoji: string): string {
  const withoutSelector = emoji.includes(ZERO_WIDTH_JOINER)
    ? emoji
    : emoji.replace(VARIATION_SELECTOR_16, "");

  // `Array.from` recorre por code point: cada carácter tiene al menos uno.
  const codePoints = Array.from(withoutSelector, (char) =>
    char.codePointAt(0)!.toString(16),
  );
  return codePoints.join("-");
}

/**
 * Parte un tramo de texto sin menciones en `text` y `emoji`. Recorre por
 * grafemas (un emoji con tono de piel, bandera o familia es un solo grafema) y
 * junta los que no son emoji, así no queda ninguna parte vacía.
 */
function textAndEmojiParts(text: string): TweetTextPart[] {
  const parts: TweetTextPart[] = [];
  let plain = "";

  for (const { segment } of GRAPHEMES.segment(text)) {
    if (!isEmoji(segment)) {
      plain += segment;
      continue;
    }
    if (plain) {
      parts.push({ kind: "text", value: plain });
      plain = "";
    }
    parts.push({ kind: "emoji", value: segment, code: twemojiCode(segment) });
  }

  if (plain) parts.push({ kind: "text", value: plain });
  return parts;
}

/**
 * Parte el texto en tramos para resaltarlo: `self` es @tallami1 (sin importar
 * mayúsculas), `mention` cualquier otro @usuario, `emoji` cada emoji (para
 * mostrarlo como imagen) y `text` el resto. Unidos en orden dan el texto
 * original.
 */
export function tweetTextParts(text: string): TweetTextPart[] {
  const parts: TweetTextPart[] = [];
  let cursor = 0;

  for (const match of text.matchAll(MENTION)) {
    const start = match.index;
    // "coach@tallami1.com" no es una mención: el @ va pegado a otra palabra.
    if (start > 0 && WORD_CHARACTER.test(text[start - 1])) continue;

    parts.push(...textAndEmojiParts(text.slice(cursor, start)));
    const mention = match[0];
    parts.push({
      kind: mention.toLowerCase() === COACH_MENTION ? "self" : "mention",
      value: mention,
    });
    cursor = start + mention.length;
  }

  parts.push(...textAndEmojiParts(text.slice(cursor)));
  return parts;
}

/** `toTweetCard` ya comprobó que `createdAt` es una fecha que se puede leer. */
function timestampOf(card: TweetCard): number {
  return Date.parse(card.createdAt);
}

/** Los IDs de X son numéricos y crecen con el tiempo: más dígitos, más nuevo. */
function compareIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function newestFirst(a: TweetCard, b: TweetCard): number {
  return timestampOf(b) - timestampOf(a) || compareIds(b.id, a.id);
}

/**
 * Carga cada tweet con `load` y devuelve las tarjetas del más nuevo al más
 * viejo. Los que no existen (`undefined`), tiran error o vienen mal formados se
 * omiten: nunca hace fallar a quien la llama. `onSkip` se avisa de los que
 * tiraron error.
 */
export async function fetchTweetCards(
  ids: readonly string[],
  load: TweetLoader,
  onSkip?: (id: string, error: unknown) => void,
): Promise<TweetCard[]> {
  const loaded = await Promise.all(
    ids.map(async (id): Promise<TweetCard | undefined> => {
      try {
        const tweet = await load(id);
        return tweet ? toTweetCard(tweet) : undefined;
      } catch (error) {
        onSkip?.(id, error);
        return undefined;
      }
    }),
  );

  return loaded
    .filter((card): card is TweetCard => card !== undefined)
    .sort(newestFirst);
}

/**
 * Decide qué tweet mostrar. `loadLive` le pide el tweet a X y `snapshot` es la
 * copia guardada (si hay):
 * - X lo devuelve: se usa el dato en vivo.
 * - X dice que no existe (`undefined`): no se muestra, aunque haya copia. Si un
 *   jugador borra su tweet, su tarjeta tiene que desaparecer.
 * - X falla (red, tiempo agotado, 5xx, 429) o contesta algo que no es un
 *   tweet: se usa la copia; sin copia, no se muestra.
 *
 * No lee el entorno ni escribe logs: devuelve el camino que siguió para que
 * quien la llama lo registre.
 */
export async function resolveTweet(
  id: string,
  loadLive: TweetLoader,
  snapshot: Tweet | undefined,
): Promise<TweetResolution> {
  try {
    const live = await loadLive(id);
    if (!live) return { tweet: undefined, path: "gone" };
    // Si no se puede armar la tarjeta, la respuesta no es un tweet: cuenta como fallo de X.
    toTweetCard(live);
    return { tweet: live, path: "live" };
  } catch (error) {
    return snapshot
      ? { tweet: snapshot, path: "snapshot", error }
      : { tweet: undefined, path: "unavailable", error };
  }
}

function loadFromX(id: string): Promise<Tweet | undefined> {
  return getTweet(id, { signal: AbortSignal.timeout(X_REQUEST_TIMEOUT_MS) });
}

/** `Object.hasOwn`: un ID como "constructor" no es una copia. */
function snapshotOf(id: string): Tweet | undefined {
  return Object.hasOwn(TWEET_SNAPSHOTS, id) ? TWEET_SNAPSHOTS[id] : undefined;
}

/** Solo las copias guardadas. Sin copia tira error, y `fetchTweetCards` lo informa. */
async function loadFromSnapshots(id: string): Promise<Tweet> {
  const snapshot = snapshotOf(id);
  if (!snapshot) {
    throw new Error(
      `no hay copia guardada; corré "npm run tweets:record -- ${id}"`,
    );
  }
  return snapshot;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Deja en el log qué camino siguió el tweet: así se ve si X anda o si se están usando las copias. */
function logTweetPath(id: string, { path, error }: TweetResolution): void {
  switch (path) {
    case "live":
      console.info(`Tweet ${id}: dato en vivo de X.`);
      break;
    case "gone":
      console.warn(
        `Tweet ${id}: X dice que ya no existe (borrado o privado); se omite su tarjeta.`,
      );
      break;
    case "snapshot":
      console.warn(
        `Tweet ${id}: X falló (${reasonOf(error)}); se usa la copia guardada.`,
      );
      break;
    case "unavailable":
      console.error(
        `Tweet ${id}: X falló (${reasonOf(error)}) y no hay copia guardada; se omite su tarjeta.`,
      );
      break;
  }
}

/** Pide el tweet a X, con su copia guardada de respaldo. */
async function loadFromXWithBackup(id: string): Promise<Tweet | undefined> {
  const resolution = await resolveTweet(id, loadFromX, snapshotOf(id));
  logTweetPath(id, resolution);
  return resolution.tweet;
}

function logSkippedTweet(id: string, error: unknown): void {
  console.error(
    `No se pudo cargar el tweet ${id}; se omite su tarjeta: ${reasonOf(error)}`,
  );
}

/**
 * Tarjetas de los tweets, del más nuevo al más viejo; vacía si ninguno carga.
 * Se cachea un día. Cada tweet se pide a X y, si X falla, se usa su copia
 * guardada (ver `resolveTweet`): una caída de X al regenerar la página no deja
 * la sección vacía. Con `TWEETS_SOURCE=snapshots` usa solo las copias y no
 * llama a X, así los tests e2e no dependen de la red.
 */
export async function getTweetCards(
  ids: readonly string[],
): Promise<TweetCard[]> {
  "use cache";
  cacheLife("days");

  const load: TweetLoader =
    process.env[SOURCE_ENV] === SNAPSHOTS_SOURCE
      ? loadFromSnapshots
      : loadFromXWithBackup;

  return fetchTweetCards(ids, load, logSkippedTweet);
}
