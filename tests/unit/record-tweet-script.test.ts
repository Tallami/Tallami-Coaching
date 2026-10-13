import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../../scripts/record-tweet.mjs", import.meta.url),
);

// Solo se prueban los argumentos que se rechazan antes de pedirle nada a X:
// ninguna de estas corridas toca la red.
describe("scripts/record-tweet.mjs", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function run(...args: string[]) {
    const dir = mkdtempSync(join(tmpdir(), "record-tweet-"));
    tempDirs.push(dir);
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, TWEETS_FIXTURE_DIR: dir },
    });
    return { ...result, saved: readdirSync(dir) };
  }

  test("asks for at least one tweet id", () => {
    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("uso:");
    expect(result.saved).toEqual([]);
  });

  test("rejects an id that is not a number and saves nothing", () => {
    for (const bad of ["abc", "12ab", "../2104290558906868129", "https://x.com/a/status/1", "-1"]) {
      const result = run(bad);

      expect(result.status, bad).toBe(1);
      expect(result.stderr, bad).toContain("ID de tweet inválido");
      expect(result.stderr, bad).toContain(bad);
      expect(result.saved, bad).toEqual([]);
    }
  });

  test("checks every id before it asks X for any of them", () => {
    const result = run("2104290558906868129", "no-es-un-id");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no-es-un-id");
    expect(result.saved).toEqual([]);
  });
});
