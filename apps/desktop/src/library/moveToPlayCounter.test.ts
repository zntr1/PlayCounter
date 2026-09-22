// @vitest-environment happy-dom
import type { Session } from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransferData } from "../backup";
import { validateBackupData } from "../backupValidation";
import { effectiveTotalSeconds } from "../playtimeAdjustments";
import { STORAGE_KEY, writePersistedRecord } from "../persistence";
import { getGameJournal, useAppStore } from "../store";
import { hydrate, untrackGame } from "../tracker";
import { commitLibraryImports } from "./commit";
import { buildLibraryImportCommit } from "./importPlan";
import {
  moveGameToPlayCounter,
  moveGamesToPlayCounter,
} from "./moveToPlayCounter";
import { resolveScopedLink, scopedExeLinkKey } from "./scopedLinks";
import type { LibraryImportEntry } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (value: string) => value,
}));

const DATE = "2026-09-15T12:00:00.000Z";
const imported: LibraryImportEntry = {
  provider: "steam",
  externalId: "100",
  gameId: 1,
  igdbId: 100,
  source: "igdb",
  name: "Transferred game",
  coverUrl: "",
  importedAt: DATE,
  lastReadAt: DATE,
  providerLastPlayedAt: DATE,
  providerSeconds: 3600,
  linkedExeNames: [],
  linkedExeSources: [],
};
const other: LibraryImportEntry = {
  ...imported,
  externalId: "200",
  gameId: 2,
  igdbId: 200,
  name: "Other game",
};
const game = {
  gameId: 1,
  igdbId: 100,
  source: "igdb" as const,
  gameName: imported.name,
};
function session(seconds: number, overrides: Partial<Session> = {}): Session {
  return {
    ...game,
    id: 10,
    exeName: "transferred.exe",
    coverUrl: "",
    startedAt: "2026-09-15T10:00:00.000Z",
    endedAt: DATE,
    durationSeconds: seconds,
    ...overrides,
  };
}
beforeEach(() => {
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    libraryImports: new Map([
      ["steam:100", imported],
      ["steam:200", other],
    ]),
  });
});
afterEach(() => vi.restoreAllMocks());

describe("moving a selection to PlayCounter", () => {
  it("deduplicates games, skips local games, and saves all selected launcher games once", () => {
    const local = {
      gameId: -20,
      source: "custom" as const,
      gameName: "Local game",
    };
    useAppStore
      .getState()
      .setLibraryImport({ ...other, provider: "xbox", providerSeconds: 7200 });
    const unrelated = {
      ...imported,
      gameId: 3,
      igdbId: 300,
      externalId: "300",
    };
    useAppStore.getState().setLibraryImport(unrelated);
    useAppStore.setState({
      recentSessions: [
        session(600),
        session(900, { id: 11, ...other, gameName: other.name }),
      ],
      playtimeAdjustments: { "custom:-20": 1800 },
    });
    useAppStore
      .getState()
      .updateGameJournal(game, { note: "Keep my note", favorite: true });
    const before = useAppStore.getState();
    const save = vi.spyOn(localStorage, "setItem");
    const publish = vi.fn();
    const unsubscribe = useAppStore.subscribe(publish);
    try {
      expect(
        moveGamesToPlayCounter([game, other, local, { ...game, gameId: 99 }]),
      ).toBe(2);
      expect(save).toHaveBeenCalledTimes(1);
      expect(publish).toHaveBeenCalledTimes(1);
      expect([...useAppStore.getState().libraryImports.values()]).toEqual([
        unrelated,
      ]);
      expect(useAppStore.getState().playtimeAdjustments).toEqual({
        "igdb:1": 3000,
        "igdb:2": 9900,
        "custom:-20": 1800,
      });
      expect(useAppStore.getState().recentSessions).toEqual(
        before.recentSessions,
      );
      expect(useAppStore.getState().gameJournals).toBe(before.gameJournals);
      expect(useAppStore.getState().playcounterLibrary.size).toBe(2);
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      validateBackupData(createTransferData(saved), "data");
      hydrate();
      expect(useAppStore.getState().playcounterLibrary.size).toBe(2);
      expect(useAppStore.getState().playtimeAdjustments).toEqual({
        "igdb:1": 3000,
        "igdb:2": 9900,
        "custom:-20": 1800,
      });
    } finally {
      unsubscribe();
    }
  });

  it("does not partially move the first game when a batch cannot be saved", () => {
    const before = useAppStore.getState();
    const saved = localStorage.getItem(STORAGE_KEY);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    expect(() => moveGamesToPlayCounter([game, other])).toThrow(
      "Storage unavailable",
    );
    expect(useAppStore.getState()).toBe(before);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
  });

  it("does nothing when the selection has no launcher games", () => {
    const before = useAppStore.getState();
    const save = vi.spyOn(localStorage, "setItem");
    expect(moveGamesToPlayCounter([])).toBe(0);
    expect(moveGamesToPlayCounter([{ gameId: -1, source: "custom" }])).toBe(0);
    expect(save).not.toHaveBeenCalled();
    expect(useAppStore.getState()).toBe(before);
  });
});

describe("moving to PlayCounter", () => {
  it("keeps an import-only game's hours and date through restart and backup restore", () => {
    expect(moveGameToPlayCounter(game)).toBe(true);
    expect(useAppStore.getState().libraryImports.has("steam:100")).toBe(false);
    expect(useAppStore.getState().libraryImports.get("steam:200")).toEqual(
      other,
    );
    expect(useAppStore.getState().recentSessions).toEqual([]);
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    validateBackupData(createTransferData(saved), "data");
    for (const payload of [saved, createTransferData(saved)]) {
      useAppStore.setState(useAppStore.getInitialState(), true);
      writePersistedRecord(payload);
      hydrate();
      expect(
        useAppStore.getState().playcounterLibrary.get("igdb#100"),
      ).toMatchObject({
        gameId: 1,
        igdbId: 100,
        source: "igdb",
        name: imported.name,
        lastPlayedAt: DATE,
      });
      expect(useAppStore.getState().playtimeAdjustments).toEqual({
        "igdb:1": 3600,
      });
      expect(useAppStore.getState().recentSessions).toEqual([]);
    }
    useAppStore.getState().addSession(session(1800));
    expect(
      effectiveTotalSeconds(
        1800,
        useAppStore.getState().playtimeAdjustments["igdb:1"],
      ),
    ).toBe(5400);
  });

  it.each([
    { local: 1200, archive: 600, adjustment: 0, expected: 1800 },
    { local: 4200, archive: 600, adjustment: 300, expected: 300 },
    { local: 4200, archive: 0, adjustment: -600, expected: -600 },
    { local: 4200, archive: 0, adjustment: -1800, expected: -600 },
  ])(
    "preserves overlapping totals and existing adjustments: $local/$archive/$adjustment",
    ({ local, archive, adjustment, expected }) => {
      const sessions = [session(local)];
      useAppStore.setState({
        recentSessions: sessions,
        archivedSeconds: archive,
        archivedGameSeconds: { "igdb:1": archive },
        playtimeAdjustments: { "igdb:1": adjustment, "igdb:2": 600 },
      });
      const shelf = useAppStore
        .getState()
        .savePersonalShelf({ name: "Favorites" })!;
      useAppStore.getState().updateGameJournal(game, {
        note: "Keep this",
        favorite: true,
        shelfIds: [shelf],
      });
      const playthrough = useAppStore
        .getState()
        .createPlaythrough(game, "Replay")!;
      const journal = getGameJournal(useAppStore.getState(), game);
      moveGameToPlayCounter(game);
      expect(useAppStore.getState().recentSessions).toEqual(sessions);
      expect(useAppStore.getState().archivedGameSeconds).toEqual({
        "igdb:1": archive,
      });
      expect(useAppStore.getState().playtimeAdjustments).toEqual({
        "igdb:1": expected,
        "igdb:2": 600,
      });
      expect(getGameJournal(useAppStore.getState(), game)).toEqual(journal);
      expect(journal.playthroughs[0].id).toBe(playthrough);
    },
  );

  it.each([
    { local: 1200, expectedAdjustment: 9000, expectedTotal: 10800 },
    { local: 12000, expectedAdjustment: 0, expectedTotal: 12600 },
  ])(
    "preserves combined launcher time or higher local time across aliases: $local",
    ({ local, expectedAdjustment, expectedTotal }) => {
      useAppStore.getState().setLibraryImport({
        ...imported,
        provider: "xbox",
        gameId: 7,
        providerSeconds: 7200,
      });
      useAppStore.setState({
        recentSessions: [session(local), session(600, { id: 11, gameId: 7 })],
      });
      moveGameToPlayCounter(game);
      expect([...useAppStore.getState().libraryImports.keys()]).toEqual([
        "steam:200",
      ]);
      expect(useAppStore.getState().playtimeAdjustments["igdb:1"] ?? 0).toBe(
        expectedAdjustment,
      );
      hydrate();
      expect(
        effectiveTotalSeconds(
          local + 600,
          useAppStore.getState().playtimeAdjustments["igdb:1"] ?? 0,
        ),
      ).toBe(expectedTotal);
      expect(useAppStore.getState().playcounterLibrary.size).toBe(1);
    },
  );

  it("keeps a running session and adds only its future seconds to the transferred total", () => {
    const active = {
      ...game,
      id: 5,
      coverUrl: "",
      exeName: "transferred.exe",
      startedAt: "2026-09-15T11:40:00.000Z",
      checkpointedAt: DATE,
    };
    useAppStore.setState({ activeSessions: [active] });
    moveGameToPlayCounter(game);
    expect(useAppStore.getState().activeSessions).toEqual([active]);
    expect(useAppStore.getState().playtimeAdjustments["igdb:1"]).toBe(2400);
    expect(effectiveTotalSeconds(1200, 2400)).toBe(3600);
    useAppStore.getState().addSession(session(1800));
    useAppStore.setState({ activeSessions: [] });
    expect(
      effectiveTotalSeconds(
        1800,
        useAppStore.getState().playtimeAdjustments["igdb:1"],
      ),
    ).toBe(4200);
  });

  it("does not lose imported time when a short running session is discarded", () => {
    useAppStore.setState({
      activeSessions: [
        {
          ...game,
          id: 5,
          coverUrl: "",
          exeName: "transferred.exe",
          startedAt: "2026-09-15T11:59:30.000Z",
          checkpointedAt: DATE,
        },
      ],
    });
    moveGameToPlayCounter(game);
    useAppStore.setState({ activeSessions: [] });
    expect(useAppStore.getState().recentSessions).toEqual([]);
    expect(useAppStore.getState().playtimeAdjustments["igdb:1"]).toBe(3600);
  });

  it("keeps executable links local and preserves restrictions on generic names after hydration", () => {
    const path = String.raw`C:\Games\Transferred`;
    const link = {
      ...game,
      gameId: -50,
      source: "custom" as const,
      coverUrl: "",
      exeName: "game.exe",
      pathPrefix: path,
      provider: "steam" as const,
      externalId: "100",
      setAt: DATE,
    };
    const linkKey = scopedExeLinkKey(link.exeName, path)!;
    useAppStore.setState({
      scopedExeLinks: new Map([[linkKey, link]]),
      exeCache: new Map([
        [
          "transferred.exe",
          {
            ...game,
            exeName: "transferred.exe",
            state: "matched",
            lastCheckedAt: DATE,
            libraryProvider: "steam",
            libraryExternalId: "100",
          },
        ],
      ]),
      recentSessions: [
        session(600, { gameId: -50, source: "custom", igdbId: undefined }),
      ],
      archivedGameSeconds: { "custom:-50": 600 },
      archivedSeconds: 600,
      libraryInstalls: new Map([
        [
          "steam:100",
          {
            provider: "steam",
            externalId: "100",
            installPath: path,
            scannedAt: DATE,
          },
        ],
      ]),
    });
    moveGameToPlayCounter(game);
    expect(useAppStore.getState().playtimeAdjustments["igdb:1"]).toBe(2400);
    expect(useAppStore.getState().libraryInstalls.size).toBe(0);
    expect(
      useAppStore.getState().exeCache.get("transferred.exe")?.libraryProvider,
    ).toBeUndefined();
    hydrate();
    const links = useAppStore.getState().scopedExeLinks;
    expect(links.get(linkKey)?.provider).toBeUndefined();
    expect(links.get(linkKey)?.gameId).toBe(-50);
    expect(
      resolveScopedLink(
        { exeName: "game.exe", exePath: `${path}\\game.exe` },
        links,
      )?.igdbId,
    ).toBe(100);
    expect(
      resolveScopedLink(
        { exeName: "game.exe", exePath: String.raw`C:\Other\game.exe` },
        links,
      ),
    ).toBeNull();
    expect(useAppStore.getState().exeCache.has("game.exe")).toBe(false);
    untrackGame(game.gameId, game.source, true, [
      game,
      { gameId: -50, source: "custom" },
    ]);
    expect(useAppStore.getState().playcounterLibrary.size).toBe(0);
    expect(useAppStore.getState().scopedExeLinks.size).toBe(0);
  });

  it.each([0, null])(
    "keeps games with provider time %s without invented hours",
    (seconds) => {
      useAppStore.getState().setLibraryImport({
        ...imported,
        providerSeconds: seconds,
        providerLastPlayedAt: undefined,
      });
      moveGameToPlayCounter(game);
      expect(useAppStore.getState().playcounterLibrary.size).toBe(1);
      expect(useAppStore.getState().playtimeAdjustments).toEqual({});
      expect(useAppStore.getState().recentSessions).toEqual([]);
    },
  );

  it("requires an import to restore a launcher and does not duplicate hours on repeated moves", () => {
    moveGameToPlayCounter(game);
    expect(moveGameToPlayCounter(game)).toBe(false);
    useAppStore.getState().addSession(session(1800));
    const commit = buildLibraryImportCommit({
      provider: "xbox",
      now: DATE,
      scanned: {
        externalId: "999",
        playtimeSeconds: 3600,
        installed: false,
        executables: [],
      },
      resolved: {
        key: "xbox:999",
        status: "resolved",
        game: {
          id: 1,
          igdbId: 100,
          source: "igdb",
          name: imported.name,
          coverUrl: "",
        },
        executables: [],
      },
    })!;
    commitLibraryImports([commit]);
    expect(useAppStore.getState().libraryImports.has("xbox:999")).toBe(true);
    moveGameToPlayCounter(game);
    expect(useAppStore.getState().playtimeAdjustments["igdb:1"]).toBe(3600);
    expect(useAppStore.getState().recentSessions).toHaveLength(1);
    expect(useAppStore.getState().playcounterLibrary.size).toBe(1);
  });

  it("leaves the original library intact when saving fails", () => {
    const before = useAppStore.getState();
    const saved = localStorage.getItem(STORAGE_KEY);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    expect(() => moveGameToPlayCounter(game)).toThrow("Storage unavailable");
    expect(useAppStore.getState()).toBe(before);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
  });
});
