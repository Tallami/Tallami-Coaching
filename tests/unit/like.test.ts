import { describe, expect, test } from "vitest";
import { containsPattern } from "@/db/like";

describe("containsPattern", () => {
  test("wraps the text so it matches anywhere", () => {
    expect(containsPattern("ana")).toBe("%ana%");
    expect(containsPattern("  ana  ")).toBe("%ana%");
  });

  test("escapes the characters that are wildcards for LIKE", () => {
    expect(containsPattern("100%")).toBe("%100\\%%");
    expect(containsPattern("o_r")).toBe("%o\\_r%");
    expect(containsPattern("a\\b")).toBe("%a\\\\b%");
  });

  test("drops NUL characters, which Postgres refuses", () => {
    expect(containsPattern("an\u0000a")).toBe("%ana%");
  });

  test("has no pattern when there is nothing to search", () => {
    expect(containsPattern("")).toBeNull();
    expect(containsPattern("   ")).toBeNull();
    expect(containsPattern("\u0000")).toBeNull();
    expect(containsPattern(" \u0000 ")).toBeNull();
  });
});
