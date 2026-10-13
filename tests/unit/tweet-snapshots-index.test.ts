import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { TWEET_SNAPSHOTS } from "@/content/tweet-snapshots";
import {
  listSnapshotIds,
  renderSnapshotsIndex,
  writeSnapshotsIndex,
} from "../../scripts/tweet-snapshots-index.mjs";
import { SNAPSHOT_DIR } from "../helpers/tweet-fixtures";

const SNAPSHOT_FILE = /^(\d+)\.json$/;

/** Los IDs de las copias que hay en una carpeta, ordenados de menor a mayor. */
function idsInFolder(dir: string): string[] {
  return readdirSync(dir)
    .map((name) => SNAPSHOT_FILE.exec(name)?.[1])
    .filter((id): id is string => id !== undefined)
    .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1));
}

// `src/content/tweet-snapshots/index.ts` lo genera `npm run tweets:record` (o
// `npm run tweets:index`): estos tests avisan si la carpeta y el índice se
// separan, por ejemplo al borrar o sumar un archivo a mano.
describe("tweet snapshots index", () => {
  test("has an entry for every file in the folder and no other", () => {
    expect(Object.keys(TWEET_SNAPSHOTS).sort()).toEqual(
      idsInFolder(SNAPSHOT_DIR).sort(),
    );
    expect(Object.keys(TWEET_SNAPSHOTS).length).toBeGreaterThan(0);
  });

  test("each entry is the tweet its file name says", () => {
    for (const [id, tweet] of Object.entries(TWEET_SNAPSHOTS)) {
      expect(tweet.id_str, `copia ${id}`).toBe(id);
    }
  });

  test("is exactly what the generator writes for the folder", async () => {
    const committed = readFileSync(join(SNAPSHOT_DIR, "index.ts"), "utf8");

    expect(committed).toBe(
      renderSnapshotsIndex(await listSnapshotIds(SNAPSHOT_DIR)),
    );
  });
});

describe("renderSnapshotsIndex", () => {
  test("imports every copy statically, ordered by id, whatever the order it gets", () => {
    const source = renderSnapshotsIndex(["1000", "99", "200"]);

    const imported = [...source.matchAll(/^import \w+ from "\.\/(\d+)\.json";$/gm)];
    const entries = [...source.matchAll(/^ {2}"(\d+)": /gm)];

    // Numérico, no alfabético: 99 < 200 < 1000.
    expect(imported.map((match) => match[1])).toEqual(["99", "200", "1000"]);
    expect(entries.map((match) => match[1])).toEqual(["99", "200", "1000"]);
    expect(source).toContain(
      "export const TWEET_SNAPSHOTS: Readonly<Record<string, Tweet>> = {",
    );
    // Nada se lee del disco al correr: solo imports estáticos.
    expect(source).not.toMatch(/node:fs|readFile|require\(/);
  });

  test("is the same file for the same ids, and drops repeats", () => {
    expect(renderSnapshotsIndex(["5", "3", "5"])).toBe(
      renderSnapshotsIndex(["3", "5"]),
    );
  });

  test("without copies it is still a valid, empty index", () => {
    const source = renderSnapshotsIndex([]);

    expect(source).not.toContain("import snapshot");
    expect(source).toMatch(/= \{\s*\};/);
  });
});

describe("writeSnapshotsIndex", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDirWith(...names: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), "snapshots-"));
    tempDirs.push(dir);
    for (const name of names) writeFileSync(join(dir, name), "{}");
    return dir;
  }

  test("lists only <number>.json files, ordered by id", async () => {
    const dir = tempDirWith(
      "300.json",
      "20.json",
      "1000.json",
      "notas.txt",
      "abc.json",
      "12.json.bak",
      "index.ts",
    );

    expect(await listSnapshotIds(dir)).toEqual(["20", "300", "1000"]);
  });

  test("writes index.ts next to the copies, with what the folder holds", async () => {
    const dir = tempDirWith("300.json", "20.json", "leeme.txt");

    const written = await writeSnapshotsIndex(dir);

    expect(written.ids).toEqual(["20", "300"]);
    expect(readFileSync(join(dir, "index.ts"), "utf8")).toBe(
      renderSnapshotsIndex(["20", "300"]),
    );
  });

  test("rewrites the index when a copy is added or removed", async () => {
    const dir = tempDirWith("20.json");
    await writeSnapshotsIndex(dir);

    writeFileSync(join(dir, "10.json"), "{}");
    await writeSnapshotsIndex(dir);
    expect(readFileSync(join(dir, "index.ts"), "utf8")).toBe(
      renderSnapshotsIndex(["10", "20"]),
    );

    rmSync(join(dir, "20.json"));
    await writeSnapshotsIndex(dir);
    expect(readFileSync(join(dir, "index.ts"), "utf8")).toBe(
      renderSnapshotsIndex(["10"]),
    );
  });
});
