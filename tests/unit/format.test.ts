import { describe, expect, test } from "vitest";
import { formatList, formatPlace, formatUsd } from "@/lib/format";

describe("format", () => {
  test("formatUsd groups thousands per locale", () => {
    expect(formatUsd(45300, "es")).toBe("USD 45.300");
    expect(formatUsd(45300, "pt")).toBe("USD 45.300");
    expect(formatUsd(45300, "en")).toBe("USD 45,300");
    expect(formatUsd(30, "es")).toBe("USD 30");
  });

  test("formatPlace uses º in es and pt and English ordinals in en", () => {
    expect(formatPlace(1, "es")).toBe("1º");
    expect(formatPlace(22, "pt")).toBe("22º");
    expect([1, 5, 9, 11, 12, 14, 22].map((n) => formatPlace(n, "en"))).toEqual([
      "1st",
      "5th",
      "9th",
      "11th",
      "12th",
      "14th",
      "22nd",
    ]);
  });

  test("formatPlace covers every English ordinal suffix", () => {
    expect([2, 3, 13, 21, 23, 101, 111].map((n) => formatPlace(n, "en"))).toEqual(
      ["2nd", "3rd", "13th", "21st", "23rd", "101st", "111th"],
    );
  });

  test("formatList joins players with the locale conjunction", () => {
    const players = ["K1ng", "Fazer", "Phzin"];
    expect(formatList(players, "es")).toBe("K1ng, Fazer y Phzin");
    expect(formatList(players, "pt")).toBe("K1ng, Fazer e Phzin");
    expect(formatList(players, "en")).toBe("K1ng, Fazer, and Phzin");
    expect(formatList(["Randu", "Lewa"], "es")).toBe("Randu y Lewa");
  });
});
