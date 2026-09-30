import { expect, it } from "vitest";
import type { LibraryImportEntry } from "../library/types";
import type { ExeCacheEntry } from "../store";
import { collectLevelUpOffers } from "./levelUpOffers";

const NOW = "2026-09-30T10:00:00Z";

function file(entry: Partial<ExeCacheEntry> & { exeName: string }) {
  return [
    entry.exeName.toLowerCase(),
    {
      state: "matched",
      gameId: 1,
      source: "custom",
      lastCheckedAt: NOW,
      ...entry,
    } as ExeCacheEntry,
  ] as const;
}

function game(
  name: string,
  exeNames: string[],
  imports: LibraryImportEntry[] = [],
) {
  return {
    name,
    exeNames,
    emulatorContentKeys: [],
    libraryImports: imports.map((entry) => ({
      provider: entry.provider,
      externalId: entry.externalId,
      entry,
    })),
  };
}

const HADES: LibraryImportEntry = {
  provider: "steam",
  externalId: "1145360",
  igdbId: 113112,
  gameId: 113112,
  source: "igdb",
  name: "Hades",
  coverUrl: "",
  importedAt: NOW,
  providerSeconds: null,
  lastReadAt: NOW,
  linkedExeNames: [],
  linkedExeSources: [],
};

it("lists approved suggestions, found matches and launcher games to track", () => {
  const exeCache = new Map([
    file({
      exeName: "Mine.exe",
      communitySuggestionId: 5,
      communitySuggestionVerified: true,
    }),
    file({
      exeName: "Other.exe",
      communityUpgradeGame: {
        id: 9,
        name: "Other Game",
        coverUrl: "",
        source: "igdb",
      },
    }),
  ]);
  const offers = collectLevelUpOffers(
    [
      game("My Game", ["Mine.exe"]),
      game("Other", ["Other.exe"]),
      game("Hades", [], [HADES]),
    ],
    exeCache,
    new Map([
      [
        "steam:1145360",
        {
          entry: HADES,
          executableMatches: [{ name: "Hades.exe", sources: [] }],
        },
      ],
    ]),
  );

  expect(offers).toEqual([
    expect.objectContaining({ kind: "approved", exeName: "Mine.exe" }),
    expect.objectContaining({
      kind: "match",
      exeName: "Other.exe",
      matchName: "Other Game",
      matchSource: "igdb",
    }),
    expect.objectContaining({
      kind: "tracking",
      gameName: "Hades",
      exeNames: ["Hades.exe"],
    }),
  ]);
});

it("offers every file of a card, not only its first", () => {
  const exeCache = new Map([
    file({
      exeName: "a.exe",
      communitySuggestionId: 5,
      communitySuggestionVerified: true,
    }),
    file({
      exeName: "b.exe",
      communitySuggestionId: 6,
      communitySuggestionVerified: true,
    }),
  ]);
  const offers = collectLevelUpOffers(
    [game("Two Files", ["a.exe", "b.exe"])],
    exeCache,
    new Map(),
  );
  expect(offers.map((offer) => offer.key)).toEqual([
    "file:a.exe",
    "file:b.exe",
  ]);
});

it("skips what the cards do not offer", () => {
  const exeCache = new Map([
    // Pending, not approved yet.
    file({ exeName: "pending.exe", communitySuggestionId: 5 }),
    // Already a database game.
    file({
      exeName: "db.exe",
      source: "community",
      communitySuggestionId: 5,
      communitySuggestionVerified: true,
    }),
  ]);
  const offers = collectLevelUpOffers(
    [
      game("Pending", ["pending.exe"]),
      game("Database", ["db.exe"]),
      // A tracked launcher game gets no tracking offer.
      game("Hades", ["Hades.exe"], [HADES]),
      // An offer for an older import entry is stale.
      game("Hades again", [], [{ ...HADES, lastReadAt: "later" }]),
    ],
    exeCache,
    new Map([
      [
        "steam:1145360",
        {
          entry: HADES,
          executableMatches: [{ name: "Hades.exe", sources: [] }],
        },
      ],
    ]),
  );
  expect(offers).toEqual([]);
});
