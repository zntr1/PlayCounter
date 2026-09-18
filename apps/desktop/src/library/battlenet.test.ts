import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validLibraryExternalId } from "@playcounter/shared";
import { createTransferData } from "../backup";
import { validateBackupData } from "../backupValidation";
import { createPersistedPayload, STORAGE_KEY } from "../persistence";
import { useAppStore } from "../store";
import {
  backfillLibraryExecutableCache,
  hydrate,
  normalizePersistedLibraryImport,
} from "../tracker";
import {
  importGroupForGame,
  hasImportableActivity,
} from "../ui/views/ImportLibraryView";
import { libraryStatCards, summarizeLibraryStats } from "../ui/myGamesStats";
import { buildLibraryImportCommit } from "./importPlan";
import { commitLibraryImports } from "./commit";
import { runLibraryImport } from "./importRun";
import { moveGameToPlayCounter } from "./moveToPlayCounter";
import { providerFloors } from "./playtimeFloor";
import { resolveScopedLink } from "./scopedLinks";
import { resolveLibraryGames } from "./resolve";
import type { ResolvedLibraryGame, ScannedLibraryGame } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));
const DATE = "2026-09-17T12:00:00.000Z";
const scanned: ScannedLibraryGame = {
  externalId: "wow_classic_era",
  name: "World of Warcraft Classic",
  installed: true,
  installPath: "C:\\Games\\WoW\\_classic_era_",
  playtimeSeconds: null,
  hasPlayedEvidence: false,
  executables: [
    {
      fileName: "WowClassic.exe",
      relativePath: "WowClassic.exe",
      sizeBytes: 50_000_000,
      depth: 0,
    },
  ],
};
const resolved: ResolvedLibraryGame = {
  key: "battlenet:wow_classic_era",
  status: "resolved",
  game: {
    id: 91,
    igdbId: 92,
    name: "World of Warcraft Classic",
    source: "igdb",
    coverUrl: "",
  },
  executables: [
    {
      platform: "windows",
      kind: "exe",
      value: "WowClassic.exe",
      provenance: "igdb",
      verified: true,
      ambiguous: true,
    },
  ],
};
function commit(game = scanned, match = resolved) {
  return buildLibraryImportCommit({
    provider: "battlenet",
    scanned: game,
    resolved: match,
    now: DATE,
  })!;
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Battle.net library", () => {
  it("imports an uninstalled account game without play history or any executable mapping", async () => {
    const game = {
      ...scanned,
      installed: false,
      installPath: undefined,
      executables: [],
      inAccountLibrary: true,
    };
    expect(hasImportableActivity(game)).toBe(false);
    expect(
      importGroupForGame({
        game,
        resolved,
        provider: "battlenet",
        alreadyImported: false,
      }),
    ).toBe("ready");
    const plan = commit(game);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await runLibraryImport([plan]);
    expect(plan.entry).toMatchObject({
      providerSeconds: null,
      providerHasPlayedEvidence: false,
      linkedExeNames: [],
    });
    expect(plan.scopedLinks).toEqual([]);
    expect(plan.exeCacheEntries).toEqual([]);
    expect(useAppStore.getState().libraryImports.size).toBe(1);
    expect(useAppStore.getState().libraryInstalls.size).toBe(0);
    expect(useAppStore.getState().recentSessions).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves an existing installation when an account import has an incomplete local scan", () => {
    const installed = commit();
    commitLibraryImports([installed]);
    const uncertain = commit({
      ...scanned,
      installed: false,
      installPath: undefined,
      executables: [],
      inAccountLibrary: true,
      installationStatusUnknown: true,
    });
    commitLibraryImports([uncertain]);
    expect(
      useAppStore.getState().libraryInstalls.get("battlenet:wow_classic_era"),
    ).toEqual(installed.install);
    expect(useAppStore.getState().scopedExeLinks.size).toBe(1);
    commitLibraryImports([
      commit({
        ...scanned,
        installed: false,
        installPath: undefined,
        executables: [],
        inAccountLibrary: true,
      }),
    ]);
    expect(useAppStore.getState().libraryInstalls.size).toBe(0);
  });

  it("reports an older server's provider schema as unsupported, leaving the library untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 400 })),
    );
    expect(
      await resolveLibraryGames("https://old-battlenet.example", "battlenet", [
        scanned,
      ]),
    ).toEqual({ capability: "unsupported", games: [] });
    expect(useAppStore.getState().libraryImports.size).toBe(0);
  });

  it("imports installed games without pretending unknown duration proves play", () => {
    expect(hasImportableActivity(scanned)).toBe(false);
    expect(
      importGroupForGame({
        provider: "battlenet",
        game: scanned,
        resolved,
        alreadyImported: false,
      }),
    ).toBe("ready");
    expect(
      importGroupForGame({
        provider: "battlenet",
        game: scanned,
        alreadyImported: false,
      }),
    ).toBe("attention");
    const plan = commit();
    expect(plan.entry).toMatchObject({
      providerSeconds: null,
      providerHasPlayedEvidence: false,
    });
    expect(plan.entry.providerLastPlayedAt).toBeUndefined();
    expect(providerFloors([plan.entry])).toEqual([]);
  });

  it("keeps verified and manually selected executables scoped to their variant", () => {
    const plan = commit();
    expect(plan.exeCacheEntries).toEqual([]);
    expect(plan.scopedLinks).toHaveLength(1);
    const links = new Map([["test", plan.scopedLinks[0]]]);
    expect(
      resolveScopedLink(
        {
          exeName: "WowClassic.exe",
          exePath: "C:\\Games\\WoW\\_classic_era_\\WowClassic.exe",
        },
        links,
      )?.igdbId,
    ).toBe(92);
    expect(
      resolveScopedLink(
        {
          exeName: "WowClassic.exe",
          exePath: "C:\\Games\\WoW\\_classic_\\WowClassic.exe",
        },
        links,
      ),
    ).toBeNull();
    const manual = buildLibraryImportCommit({
      provider: "battlenet",
      scanned,
      resolved: { ...resolved, executables: [] },
      selectedExecutable: scanned.executables[0],
      now: DATE,
    })!;
    expect(manual.exeCacheEntries).toEqual([]);
    expect(manual.scopedLinks[0]).toMatchObject({
      source: "custom",
      pathPrefix: "c:\\games\\wow\\_classic_era_",
    });
  });

  it("does not link executable evidence outside the scanned product", () => {
    const plan = commit(scanned, {
      ...resolved,
      executables: [{ ...resolved.executables[0], value: "Wow.exe" }],
    });
    expect(plan.entry.linkedExeNames).toEqual([]);
    expect(plan.scopedLinks).toEqual([]);
    expect(plan.exeCacheEntries).toEqual([]);
  });

  it.each([
    { kind: "submitted", response: { id: 501, verified: false }, status: 200 },
    {
      kind: "already-known",
      response: { igdbGame: resolved.game },
      status: 200,
    },
    {
      kind: "already-known",
      response: { id: 501, verified: true },
      status: 200,
    },
    { kind: "failed", response: { error: "Unavailable" }, status: 503 },
  ])(
    "preserves both WoW installation matches after sharing returns $kind ($response)",
    async ({ kind, response, status }) => {
      const other = commit(
        {
          ...scanned,
          externalId: "wow_classic",
          installPath: "C:\\Games\\WoW\\_classic_",
        },
        {
          ...resolved,
          game: {
            ...resolved.game!,
            id: 101,
            igdbId: 102,
            name: "Another WoW Classic version",
          },
        },
      );
      commitLibraryImports([other]);
      const fetchMock = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          Response.json(response, { status }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const plan = buildLibraryImportCommit({
        provider: "battlenet",
        scanned,
        resolved: { ...resolved, executables: [] },
        selectedExecutable: scanned.executables[0],
        now: DATE,
      })!;

      const result = await runLibraryImport([plan]);

      expect(result.shareOutcomes.map(({ outcome }) => outcome.kind)).toEqual([
        kind,
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toMatch(
        /\/api\/community\/suggestions$/,
      );
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
        exeName: "WowClassic.exe",
        name: resolved.game!.name,
        igdbId: resolved.game!.igdbId,
        coverUrl: resolved.game!.coverUrl,
      });
      const state = useAppStore.getState();
      expect(state.exeCache.size).toBe(0);
      expect([...state.scopedExeLinks.values()]).toContainEqual(
        other.scopedLinks[0],
      );
      const local = resolveScopedLink(
        {
          exeName: "WowClassic.exe",
          exePath: `${scanned.installPath}\\WowClassic.exe`,
        },
        state.scopedExeLinks,
      );
      expect(local).toMatchObject({
        igdbId: resolved.game!.igdbId,
        provider: "battlenet",
        externalId: "wow_classic_era",
      });
      if (kind === "submitted") {
        expect(local).toMatchObject({
          source: "custom",
          communitySuggestionId: 501,
          communitySuggestionVerified: false,
        });
      } else if (kind === "failed") {
        expect(local).toMatchObject({ source: "custom", shareState: "failed" });
      } else {
        expect(local?.source).toBe(
          "igdbGame" in response ? "igdb" : "community",
        );
      }
    },
  );

  it("reuses known Battle.net executable evidence without a community submission", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await runLibraryImport([commit()])).shareOutcomes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().scopedExeLinks.size).toBe(1);
  });

  it("retains the product ID, unknown duration, and scoped link after restart", async () => {
    commitLibraryImports([commit()]);
    const previous = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    useAppStore.setState(useAppStore.getInitialState(), true);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(previous));
    await hydrate();
    expect(
      useAppStore.getState().libraryImports.get(resolved.key),
    ).toMatchObject({
      externalId: "wow_classic_era",
      providerSeconds: null,
      providerHasPlayedEvidence: false,
    });
    expect(useAppStore.getState().scopedExeLinks.size).toBe(1);
    expect(useAppStore.getState().exeCache.size).toBe(0);
  });

  it("round trips transferable imports without rebuilding global links when paths are omitted", () => {
    commitLibraryImports([commit()]);
    const data = JSON.parse(
      JSON.stringify(
        createTransferData(createPersistedPayload(useAppStore.getState())),
      ),
    );
    expect(() => validateBackupData(data, "data")).not.toThrow();
    expect(data.libraryInstalls).toBeUndefined();
    expect(data.scopedExeLinks).toBeUndefined();
    const entry = normalizePersistedLibraryImport(data.libraryImports[0])!;
    expect(entry.providerHasPlayedEvidence).toBe(false);
    const cache = new Map();
    expect(backfillLibraryExecutableCache(cache, [entry])).toBe(false);
    expect(cache.size).toBe(0);
  });

  it("preserves a trusted date and previous links when a refresh omits them", () => {
    const first = commit({
      ...scanned,
      hasPlayedEvidence: true,
      lastPlayedUnix: Date.parse(DATE) / 1000,
    });
    commitLibraryImports([first]);
    commitLibraryImports([commit(scanned, { ...resolved, executables: [] })]);
    expect(useAppStore.getState().libraryImports.size).toBe(1);
    expect(
      useAppStore.getState().libraryImports.get(resolved.key),
    ).toMatchObject({
      providerHasPlayedEvidence: true,
      providerLastPlayedAt: DATE,
      linkedExeNames: ["WowClassic.exe"],
    });
    expect(useAppStore.getState().recentSessions).toEqual([]);
  });

  it("moves an import to PlayCounter without manufacturing time or losing tracking scope", () => {
    commitLibraryImports([commit()]);
    expect(
      moveGameToPlayCounter({ gameId: 91, igdbId: 92, source: "igdb" }),
    ).toBe(true);
    expect(useAppStore.getState().libraryImports.size).toBe(0);
    expect(useAppStore.getState().playcounterLibrary.size).toBe(1);
    expect(useAppStore.getState().scopedExeLinks.size).toBe(1);
    expect(
      [...useAppStore.getState().scopedExeLinks.values()][0].provider,
    ).toBeUndefined();
    expect(useAppStore.getState().recentSessions).toEqual([]);
    expect(
      Object.values(useAppStore.getState().playtimeAdjustments).some(Boolean),
    ).toBe(false);
  });

  it("keeps product-code validation separate from numeric Steam/Xbox IDs", () => {
    expect(validLibraryExternalId("battlenet", "wow_classic_era")).toBe(true);
    for (const id of ["../wow", "wow --exec=launch", "C:\\WoW", "WOW", "123"])
      expect(validLibraryExternalId("battlenet", id)).toBe(false);
    expect(
      normalizePersistedLibraryImport({ ...commit().entry, provider: "steam" }),
    ).toBeNull();
    expect(
      normalizePersistedLibraryImport({
        ...commit().entry,
        providerHasPlayedEvidence: "yes",
      }),
    ).toBeNull();
  });

  it("shows local totals and counts actual evidence instead of every installation as played", () => {
    const metrics = summarizeLibraryStats(
      [false, true].map((played, index) => ({
        gameId: index + 1,
        source: "igdb" as const,
        totalSeconds: 9999,
        recordedSeconds: 0,
        adjustmentSeconds: 0,
        sessionCount: 0,
        lastPlayedAt: DATE,
        hasLastPlayedEvidence: played,
        emulatorIds: [],
        libraryImports: [
          {
            provider: "battlenet" as const,
            installed: true,
            entry: { providerSeconds: null, providerHasPlayedEvidence: played },
          },
        ],
      })),
      { provider: "battlenet", nowMs: Date.parse(DATE) },
    );
    expect(metrics).toMatchObject({
      games: 2,
      played: 1,
      unplayed: 1,
      playtimeSeconds: 0,
      installed: 2,
    });
    expect(
      libraryStatCards(["playtime", "unplayed"], metrics, {
        kind: "provider",
        providerLabel: "Battle.net",
      }).map((card) => card.label),
    ).toEqual(["Tracked playtime", "No play activity found"]);
  });

  it("retains Battle.net play evidence in the combined library without inventing time", () => {
    const metrics = summarizeLibraryStats(
      [
        {
          gameId: 1,
          source: "igdb",
          totalSeconds: 0,
          recordedSeconds: 0,
          adjustmentSeconds: 0,
          sessionCount: 0,
          lastPlayedAt: DATE,
          hasLastPlayedEvidence: true,
          emulatorIds: [],
          libraryImports: [
            {
              provider: "battlenet",
              installed: true,
              entry: { providerSeconds: null, providerHasPlayedEvidence: true },
            },
          ],
        },
      ],
      { nowMs: Date.parse(DATE) },
    );
    expect(metrics).toMatchObject({
      games: 1,
      played: 1,
      unplayed: 0,
      playtimeSeconds: 0,
      recent: 1,
    });
  });
});
