import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { readPlayerEntries } from "../helpers/players-source";

/** Usuarios de X: letras, números y guion bajo, hasta 15 caracteres. */
const X_HANDLE = /^\w{1,15}$/;
const PHOTO_DIR = fileURLToPath(
  new URL("../../src/assets/players", import.meta.url),
);

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

// Sumar un jugador (`npm run players:photo -- <usuario>` y una línea en
// `src/content/players.ts`) no debe romper ningún test: lo que se comprueba son
// reglas que valen para cualquier lista.
describe("players", () => {
  test("has players, with names and handles that are not repeated", () => {
    expect(PLAYERS.length).toBeGreaterThan(0);
    expect(new Set(PLAYERS.map((p) => p.name)).size).toBe(PLAYERS.length);
    // X no distingue mayúsculas en los usuarios.
    expect(new Set(PLAYERS.map((p) => p.handle.toLowerCase())).size).toBe(
      PLAYERS.length,
    );
  });

  test("every handle is a valid X username and every name has text", () => {
    for (const { name, handle } of PLAYERS) {
      expect(handle, `usuario de ${name}`).toMatch(X_HANDLE);
      expect(name.trim(), "nombre").not.toBe("");
      expect(name, `nombre de @${handle}`).toBe(name.trim());
    }
  });

  test("a player whose photo file exists has it wired in", () => {
    const missing = PLAYERS.filter(
      ({ handle, photo }) =>
        !photo && existsSync(join(PHOTO_DIR, `${handle.toLowerCase()}.jpg`)),
    ).map(({ handle }) => handle);

    // La foto es opcional, pero si el archivo está y no se importó, la franja
    // muestra la inicial teniendo la foto a mano.
    expect(
      missing,
      "Hay foto en src/assets/players pero no se importó en src/content/players.ts",
    ).toEqual([]);
  });

  test("the e2e reading of players.ts matches PLAYERS", () => {
    expect(readPlayerEntries()).toEqual(
      PLAYERS.map(({ name, handle, photo }) => ({
        name,
        handle,
        hasPhoto: photo !== undefined,
      })),
    );
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
