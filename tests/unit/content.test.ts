import { describe, expect, test } from "vitest";
import { PLAYERS } from "@/content/players";
import { FNCS_TITLES, LAN_RESULTS, WINS } from "@/content/results";
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
      { event: "Reload Elite Series", players: ["Phzin", "Edson"] },
      { event: "Reload Elite Series", players: ["Romero", "Lewa"] },
      { event: "Second Chance", players: ["K1ng", "Fazer"] },
    ]);
  });

  test("online wins use the full Reload Elite Series name", () =>
    expect(WINS.map((w) => w.event)).toEqual([
      "FNCS",
      "FNCS",
      "FNCS",
      "Reload Elite Series",
      "Reload Elite Series",
      "Second Chance",
    ]));

  test("FNCS titles derive from wins", () => {
    expect(FNCS_TITLES).toBe(3);
  });

  test("in-person results match CLAUDE.md, ordered by place", () =>
    expect(LAN_RESULTS).toEqual([
      { place: 5, event: "Esports World Cup", label: "Reload" },
      { place: 9, event: "Esports World Cup", label: "ESL" },
      { place: 11, event: "FNCS Globals", label: "2025" },
      { place: 12, event: "FNCS Globals", label: "2025" },
      { place: 14, event: "FNCS Globals", label: "2026" },
      { place: 22, event: "FNCS Globals", label: "2024" },
    ]));
});

describe("services", () => {
  test("service prices match CLAUDE.md", () => {
    expect(SERVICES).toEqual([
      { id: "vodRecorded", priceUsd: 30 },
      { id: "vodLive", priceUsd: 45 },
      { id: "lesson", priceUsd: 40 },
      { id: "gamePlan", priceUsd: 120 },
      { id: "tournament", priceUsd: 150, unit: "perTeam" },
    ]);
  });

  test("lesson pack savings", () => {
    expect(LESSON_PACK).toEqual({ sessions: 4, priceUsd: 140 });
    expect(lessonPackSavingsUsd()).toBe(20);
  });

  test("pro season is a flat team price", () => {
    expect(PRO_SEASON).toEqual({ priceUsd: 2500 });
  });

  test("bookingHref points every service and the pro season to #services", () => {
    const ids = [...SERVICES.map((service) => service.id), "proSeason" as const];
    expect(ids.map((id) => bookingHref(id))).toEqual(ids.map(() => "#services"));
  });
});

describe("players", () => {
  test("players match the approved list and order", () =>
    expect(PLAYERS.map((p) => [p.name, p.handle])).toEqual([
      ["K1ng", "k1ng"],
      ["Fazer", "fazerfn"],
      ["Phzin", "Phzinfps1"],
      ["Randu", "randuimmm"],
      ["Lewa", "LewaFn"],
      ["Romero", "romerofdps"],
      ["Edson", "edsonmalado"],
      ["Tisco", "Tiscofn"],
      ["Diguera", "loud_diguera"],
      ["Mack", "mackftn"],
      ["Vadeal", "VadealFN"],
    ]));

  test("every player has a photo", () =>
    expect(PLAYERS.every((p) => p.photo)).toBe(true));
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
