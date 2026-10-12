import { describe, expect, test } from "vitest";
import {
  COACHING_EARNINGS_USD,
  EARNINGS_SINCE,
  FIRST_PLACES,
  FNCS_TITLES,
  OTHER_RESULTS,
  WINS,
} from "@/content/results";
import {
  LESSON_PACK,
  PRO_SEASON,
  SERVICES,
  bookingHref,
  lessonPackSavingsUsd,
} from "@/content/services";
import { SOCIAL_LINKS } from "@/content/social";

describe("results", () => {
  test("wins match CLAUDE.md in display order", () => {
    expect(WINS).toEqual([
      { event: "FNCS", season: "CH6S1", players: ["K1ng", "Fazer", "Phzin"] },
      { event: "FNCS", season: "CH5S3", players: ["K1ng", "Fazer"] },
      { event: "FNCS", season: "CH5S2", players: ["Randu", "Lewa"] },
      { event: "Reload Elite", players: ["Phzin", "Edson"] },
      { event: "Reload Elite", players: ["Romero", "Lewa"] },
      { event: "Second Chance", players: ["K1ng", "Fazer"] },
    ]);
  });

  test("hero counters derive from wins", () => {
    expect(FNCS_TITLES).toBe(3);
    expect(FIRST_PLACES).toBe(6);
  });

  test("other results match CLAUDE.md", () => {
    expect(OTHER_RESULTS).toEqual([
      { place: 5, event: "EWC Reload" },
      { place: 9, event: "EWC ESL" },
      { place: 11, event: "Globals", season: "2025" },
      { place: 12, event: "Globals", season: "2025" },
      { place: 14, event: "Globals", season: "2026" },
      { place: 22, event: "Globals", season: "2024" },
    ]);
  });

  test("earnings", () => {
    expect(COACHING_EARNINGS_USD).toBe(45300);
    expect(EARNINGS_SINCE).toBe("CH5S4");
  });
});

describe("services", () => {
  test("service prices match CLAUDE.md", () => {
    expect(SERVICES).toEqual([
      { id: "vodRecorded", priceUsd: 30 },
      { id: "vodLive", priceUsd: 45 },
      { id: "lesson", priceUsd: 40 },
      { id: "gamePlan", priceUsd: 120 },
      { id: "tournament", priceUsd: 150, unit: "perTeam" },
      { id: "academy", priceUsd: 15, unit: "perMonth" },
    ]);
  });

  test("lesson pack and pro season", () => {
    expect(LESSON_PACK).toEqual({ sessions: 4, priceUsd: 140 });
    expect(lessonPackSavingsUsd()).toBe(20);
    expect(PRO_SEASON).toEqual({ priceUsd: 200, prizeSharePercent: 6 });
  });

  test("bookingHref points every service and the pro season to #services", () => {
    const ids = [...SERVICES.map((service) => service.id), "proSeason" as const];
    expect(ids.map((id) => bookingHref(id))).toEqual(ids.map(() => "#services"));
  });
});

describe("social", () => {
  test("social links", () => {
    expect(SOCIAL_LINKS.map((link) => link.href)).toEqual([
      "https://x.com/tallami1",
      "https://twitch.tv/tallami",
      "https://youtube.com/@tallami1",
      "https://instagram.com/tallami1",
      "https://tiktok.com/@tallami",
    ]);
  });

  test("social labels follow the same order", () => {
    expect(SOCIAL_LINKS.map((link) => link.label)).toEqual([
      "X",
      "Twitch",
      "YouTube",
      "Instagram",
      "TikTok",
    ]);
  });
});
