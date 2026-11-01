import { describe, expect, it } from "vitest";
import {
  canImportScannedGame,
  hasImportableActivity,
  importGroupForGame,
  initialImportGroup,
  startsUnchecked,
} from "./importGroups";
import type { ResolvedLibraryGame, ScannedLibraryGame } from "./types";

function matched(
  key: string,
  name: string,
  igdbId: number,
): ResolvedLibraryGame {
  return {
    key,
    status: "resolved",
    game: { id: igdbId, igdbId, name, coverUrl: "cover", source: "igdb" },
    executables: [],
  };
}

function unknown(key: string): ResolvedLibraryGame {
  return { key, status: "unknown", executables: [], candidates: [] };
}

describe("which shelf a game lands on", () => {
  it("lets every launcher import an existing entry again to refresh playtime", () => {
    const game: ScannedLibraryGame = {
      externalId: "730",
      name: "Counter-Strike 2",
      playtimeSeconds: 7_200,
      installed: false,
      executables: [],
    };
    const resolved = matched("steam:730", "Counter-Strike 2", 1_372);

    expect(
      canImportScannedGame({ game, resolved, alreadyImported: true }),
    ).toBe(true);
    expect(
      canImportScannedGame({ game, resolved, alreadyImported: false }),
    ).toBe(true);
    expect(
      canImportScannedGame({
        game: { ...game, playtimeSeconds: 0 },
        resolved,
        alreadyImported: true,
      }),
    ).toBe(false);
  });

  it("keeps a game that is already in My Games on that shelf for every launcher", () => {
    const game: ScannedLibraryGame = {
      externalId: "1234",
      name: "Yakuza 0",
      playtimeSeconds: 3_600,
      installed: false,
      executables: [],
    };
    const resolved = matched("xbox:1234", "Yakuza 0", 133_430);

    for (const provider of [
      "steam",
      "xbox",
      "epic",
      "battlenet",
      "gog",
    ] as const) {
      expect(
        importGroupForGame({ game, provider, resolved, alreadyImported: true }),
      ).toBe("imported");
    }
    expect(
      importGroupForGame({
        game,
        provider: "xbox",
        resolved,
        alreadyImported: false,
      }),
    ).toBe("ready");
  });

  it("sorts unmatched, unplayed and just imported games onto their shelves", () => {
    const game: ScannedLibraryGame = {
      externalId: "1234",
      name: "Yakuza 0",
      playtimeSeconds: 3_600,
      installed: false,
      executables: [],
    };

    expect(
      importGroupForGame({
        game,
        provider: "xbox",
        resolved: unknown("xbox:1234"),
        alreadyImported: false,
      }),
    ).toBe("attention");
    expect(
      importGroupForGame({
        game: { ...game, playtimeSeconds: 0 },
        provider: "xbox",
        alreadyImported: false,
      }),
    ).toBe("unavailable");
    expect(
      importGroupForGame({
        game,
        provider: "xbox",
        alreadyImported: false,
        completed: true,
      }),
    ).toBe("imported");
  });

  it("can't import an unknown Steam AppID, but asks for a game the other launchers name", () => {
    const game: ScannedLibraryGame = {
      externalId: "431960",
      name: "Wallpaper Engine",
      playtimeSeconds: 36_000,
      installed: true,
      executables: [],
    };

    expect(
      importGroupForGame({
        game,
        provider: "steam",
        resolved: unknown("steam:431960"),
        alreadyImported: false,
      }),
    ).toBe("unavailable");
    for (const provider of ["xbox", "epic", "battlenet", "gog"] as const) {
      expect(
        importGroupForGame({
          game,
          provider,
          resolved: unknown(`${provider}:431960`),
          alreadyImported: false,
        }),
      ).toBe("attention");
    }
  });

  it("keeps an unknown Xbox duration importable but rejects an untouched zero", () => {
    const game: ScannedLibraryGame = {
      externalId: "42",
      playtimeSeconds: null,
      installed: false,
      executables: [],
    };
    expect(hasImportableActivity(game)).toBe(true);
    expect(hasImportableActivity({ ...game, playtimeSeconds: 0 })).toBe(false);
    expect(
      hasImportableActivity({
        ...game,
        playtimeSeconds: 0,
        lastPlayedUnix: 1_700_000_000,
      }),
    ).toBe(true);
  });

  it("lets an installed imported game refresh its playtime without picking a file", () => {
    const game: ScannedLibraryGame = {
      externalId: "629270283",
      name: "Gang Beasts",
      playtimeSeconds: 14_000,
      installed: true,
      installPath: String.raw`D:\XboxGames\Gang Beasts\Content`,
      executables: [
        {
          fileName: "Gang Beasts.exe",
          relativePath: "Gang Beasts.exe",
          sizeBytes: 1_000_000,
          depth: 0,
          declared: true,
        },
      ],
    };
    const resolved = matched("xbox:629270283", "Gang Beasts", 18_537);

    expect(
      canImportScannedGame({ game, resolved, alreadyImported: true }),
    ).toBe(true);
    expect(
      canImportScannedGame({ game, resolved, alreadyImported: false }),
    ).toBe(false);
  });
});

describe("games that start unchecked", () => {
  // The Battle.net account game from ImportLibraryCancellation.test.tsx.
  const accountGame: ScannedLibraryGame = {
    externalId: "example",
    name: "Account game",
    playtimeSeconds: null,
    hasPlayedEvidence: false,
    inAccountLibrary: true,
    installed: false,
    executables: [],
  };

  it("are account games you never played and have not installed", () => {
    expect(startsUnchecked(accountGame)).toBe(true);
    expect(startsUnchecked({ ...accountGame, installed: true })).toBe(false);
    expect(
      startsUnchecked({
        ...accountGame,
        playtimeSeconds: 3_600,
        hasPlayedEvidence: true,
      }),
    ).toBe(false);
    expect(
      startsUnchecked({ ...accountGame, lastPlayedUnix: 1_700_000_000 }),
    ).toBe(false);
    // Found on this PC, not in an account list.
    expect(startsUnchecked({ ...accountGame, inAccountLibrary: false })).toBe(
      false,
    );
  });
});

describe("the shelf the review opens on", () => {
  const played = (externalId: string): ScannedLibraryGame => ({
    externalId,
    name: `Game ${externalId}`,
    playtimeSeconds: 3_600,
    installed: false,
    executables: [],
  });
  const unplayed = (externalId: string): ScannedLibraryGame => ({
    ...played(externalId),
    playtimeSeconds: 0,
  });
  const open = (
    games: ScannedLibraryGame[],
    resolved: ResolvedLibraryGame[],
    imported: string[] = [],
  ) =>
    initialImportGroup(
      "epic",
      games,
      new Map(resolved.map((entry) => [entry.key, entry])),
      new Map(imported.map((key) => [key, {}])),
      new Set(),
    );

  it("is the first shelf with games: Ready, Needs you, Already in My Games, Can't import", () => {
    expect(
      open(
        [played("a"), played("b"), played("c"), unplayed("d")],
        [
          matched("epic:a", "A", 1),
          unknown("epic:b"),
          matched("epic:c", "C", 3),
        ],
        ["epic:c"],
      ),
    ).toBe("ready");
    expect(
      open(
        [played("b"), played("c"), unplayed("d")],
        [unknown("epic:b"), matched("epic:c", "C", 3)],
        ["epic:c"],
      ),
    ).toBe("attention");
    expect(
      open(
        [played("c"), unplayed("d")],
        [matched("epic:c", "C", 3)],
        ["epic:c"],
      ),
    ).toBe("imported");
    expect(open([unplayed("d")], [])).toBe("unavailable");
  });
});
