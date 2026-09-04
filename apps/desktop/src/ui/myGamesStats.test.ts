import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_STAT_CARD_IDS,
  libraryStatCards,
  libraryStatDefinitionsForKind,
  resolveLibraryStatCardIds,
  summarizeLibraryStats,
  toggleLibraryStatCardIds,
  type LibraryStatGame,
} from "./myGamesStats";

const NOW = Date.parse("2026-09-04T12:00:00.000Z");
const daysAgo = (days: number) =>
  new Date(NOW - days * 86_400_000).toISOString();

function game(
  gameId: number,
  options: Partial<LibraryStatGame> = {},
): LibraryStatGame {
  return {
    gameId,
    source: "igdb",
    totalSeconds: 0,
    recordedSeconds: 0,
    adjustmentSeconds: 0,
    sessionCount: 0,
    lastPlayedAt: daysAgo(1),
    emulatorIds: [],
    libraryImports: [],
    ...options,
  };
}

const steamImport = (
  installed = false,
  providerSeconds: number | null = 0,
) => ({
  provider: "steam" as const,
  installed,
  entry: { providerSeconds },
});

describe("my games stats", () => {
  it("counts a launcher tab from that launcher's floors only", () => {
    const metrics = summarizeLibraryStats(
      [
        game(1, {
          igdbId: 10,
          libraryImports: [steamImport(true), steamImport(false)],
          recordedSeconds: 600,
          sessionCount: 2,
        }),
        game(2, { igdbId: 20, libraryImports: [steamImport()] }),
        game(3, { igdbId: 30, totalSeconds: 99_999 }),
      ],
      {
        provider: "steam",
        providerFloorSeconds: { "igdb#10": 7_200, "igdb#30": 99_999 },
        nowMs: NOW,
      },
    );

    expect(metrics).toMatchObject({
      games: 2,
      playtimeSeconds: 7_200,
      trackedSeconds: 600,
      played: 1,
      unplayed: 1,
      installed: 1,
    });
  });

  it("clamps broken floors instead of contaminating the total", () => {
    const metrics = summarizeLibraryStats(
      [
        game(1, { igdbId: 10, libraryImports: [steamImport()] }),
        game(2, { igdbId: 20, libraryImports: [steamImport()] }),
      ],
      {
        provider: "steam",
        providerFloorSeconds: { "igdb#10": -50, "igdb#20": Number.NaN },
        nowMs: NOW,
      },
    );

    expect(metrics).toMatchObject({ playtimeSeconds: 0, unplayed: 2 });
  });

  it("treats an unknown Xbox duration as played without adding time", () => {
    const metrics = summarizeLibraryStats(
      [
        game(1, {
          igdbId: 10,
          libraryImports: [
            {
              provider: "xbox",
              installed: false,
              entry: { providerSeconds: null },
            },
          ],
        }),
      ],
      { provider: "xbox", nowMs: NOW },
    );

    expect(metrics).toMatchObject({
      games: 1,
      playtimeSeconds: 0,
      played: 1,
      unplayed: 0,
    });
  });

  it("counts recent play from sessions, not from the date a game was added", () => {
    const metrics = summarizeLibraryStats(
      [
        game(1, {
          totalSeconds: 60,
          sessionCount: 3,
          lastPlayedAt: daysAgo(2),
        }),
        game(2, {
          totalSeconds: 60,
          sessionCount: 1,
          lastPlayedAt: daysAgo(45),
        }),
        game(3, { sessionCount: 0, lastPlayedAt: daysAgo(1) }),
      ],
      { nowMs: NOW },
    );

    expect(metrics).toMatchObject({ games: 3, recent: 1, sessions: 4 });
  });

  it("uses tracked totals and emulator evidence off a launcher tab", () => {
    const metrics = summarizeLibraryStats(
      [
        game(1, { totalSeconds: 5_000, recordedSeconds: 5_000 }),
        game(2, { totalSeconds: -10, emulatorIds: ["dolphin"] }),
        game(3, { totalSeconds: Number.NaN }),
      ],
      { nowMs: NOW },
    );

    expect(metrics).toMatchObject({
      games: 3,
      playtimeSeconds: 5_000,
      played: 1,
      unplayed: 2,
      emulator: 1,
      installed: 0,
    });
  });

  it("hides cards that would be a tautology or a constant zero on a tab", () => {
    const providerIds = libraryStatDefinitionsForKind("provider").map(
      (definition) => definition.id,
    );
    expect(providerIds).toContain("installed");
    expect(providerIds).not.toContain("emulator");

    const unimportedIds = libraryStatDefinitionsForKind("unimported").map(
      (definition) => definition.id,
    );
    expect(unimportedIds).toContain("emulator");
    expect(unimportedIds).not.toContain("installed");
    expect(unimportedIds).not.toContain("tracked");
  });

  it("labels the same card differently per tab", () => {
    const metrics = summarizeLibraryStats([], { nowMs: NOW });
    expect(
      libraryStatCards(["games", "playtime"], metrics, {
        kind: "provider",
        providerLabel: "Steam",
      }).map((card) => card.label),
    ).toEqual(["Steam games", "Steam lifetime playtime"]);
    expect(
      libraryStatCards(["games", "playtime"], metrics, {
        kind: "unimported",
      }).map((card) => card.label),
    ).toEqual(["Games", "Tracked playtime"]);
  });

  it("formats counts and durations apart", () => {
    const metrics = summarizeLibraryStats(
      [game(1, { totalSeconds: 3_600, sessionCount: 1 })],
      { nowMs: NOW },
    );
    expect(
      libraryStatCards(["games", "playtime"], metrics, { kind: "all" }),
    ).toEqual([
      {
        id: "games",
        label: "Games",
        help: expect.any(String),
        value: 1,
        format: "count",
      },
      {
        id: "playtime",
        label: "Total playtime",
        help: expect.any(String),
        value: 3_600,
        format: "duration",
      },
    ]);
  });

  it("falls back to the default set and keeps an empty choice empty", () => {
    expect(resolveLibraryStatCardIds(undefined)).toEqual(
      DEFAULT_LIBRARY_STAT_CARD_IDS,
    );
    expect(resolveLibraryStatCardIds({ libraryStatCards: [] })).toEqual([]);
  });

  it("drops unknown ids and keeps the catalog order", () => {
    expect(
      resolveLibraryStatCardIds({
        libraryStatCards: [
          "sessions",
          "games",
          "nonsense",
        ] as unknown as NonNullable<
          Parameters<typeof resolveLibraryStatCardIds>[0]
        >["libraryStatCards"],
      }),
    ).toEqual(["games", "sessions"]);
  });

  it("toggles one card without disturbing the rest", () => {
    expect(
      toggleLibraryStatCardIds(["games", "sessions"], "playtime", true),
    ).toEqual(["games", "playtime", "sessions"]);
    expect(
      toggleLibraryStatCardIds(["games", "playtime"], "games", false),
    ).toEqual(["playtime"]);
    expect(toggleLibraryStatCardIds(["games"], "games", true)).toEqual([
      "games",
    ]);
  });
});
