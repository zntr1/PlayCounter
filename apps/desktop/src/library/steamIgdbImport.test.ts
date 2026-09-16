import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryKnownExecutable } from "@playcounter/shared";
import { useAppStore } from "../store";
import {
  importGroupForGame,
  importShareDetail,
} from "../ui/views/ImportLibraryView";
import { resolveLibraryGames } from "./resolve";
import { buildLibraryImportCommit } from "./importPlan";
import { runLibraryImport } from "./importRun";
import type { ResolvedLibraryGame, ScannedLibraryGame } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (value: string) => value,
}));

const game = {
  id: 172745,
  igdbId: 137931,
  name: "Nova Lands",
  coverUrl: "",
  source: "igdb" as const,
};
const scanned: ScannedLibraryGame = {
  externalId: "1501610",
  name: game.name,
  playtimeSeconds: 3600,
  installed: true,
  installPath: "C:\\Steam\\steamapps\\common\\Nova Lands",
  executables: [
    {
      fileName: "Nova Lands.exe",
      relativePath: "Nova Lands.exe",
      sizeBytes: 1_000_000,
      depth: 0,
    },
  ],
};
const executable: LibraryKnownExecutable = {
  platform: "windows",
  kind: "exe",
  value: "Nova Lands.exe",
  provenance: "igdb",
  verified: true,
};
const resolved: ResolvedLibraryGame = {
  key: "steam:1501610",
  status: "resolved",
  game,
  executables: [executable],
};
let sequence = 0;
let endpoint: string;

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  endpoint = `https://steam-igdb-${sequence++}.example`;
  useAppStore.setState({
    settings: { ...useAppStore.getState().settings, apiEndpoint: endpoint },
  });
  vi.stubGlobal("localStorage", {
    setItem: vi.fn(),
    getItem: vi.fn(() => null),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Steam live IGDB import", () => {
  it("takes Nova Lands from library resolution straight to an IGDB link with no Community request", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ results: [resolved] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const lookup = await resolveLibraryGames(endpoint, "steam", [scanned]);
    const match = lookup.games[0];
    expect(
      importGroupForGame({
        game: scanned,
        provider: "steam",
        resolved: match,
        alreadyImported: false,
      }),
    ).toBe("ready");
    const commit = buildLibraryImportCommit({ scanned, resolved: match })!;
    const result = await runLibraryImport([commit]);
    expect(result.shareOutcomes).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().exeCache.get("nova lands.exe")).toMatchObject(
      { igdbId: game.igdbId, source: "igdb", identifierSource: "igdb" },
    );
    expect(
      useAppStore.getState().libraryImports.get("steam:1501610")
        ?.linkedExeSources,
    ).toEqual(["igdb"]);
    const sent = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    );
    expect(sent).toEqual({
      items: [
        { key: "steam:1501610", provider: "steam", externalId: "1501610" },
      ],
    });
  });

  it("reuses a live IGDB match returned when the user manually adds the file", async () => {
    const fetchMock = vi.fn(async () => Response.json({ igdbGame: game }));
    vi.stubGlobal("fetch", fetchMock);
    const commit = buildLibraryImportCommit({
      scanned,
      resolved: { ...resolved, executables: [] },
      selectedExecutable: scanned.executables[0],
    })!;
    const result = await runLibraryImport([commit]);
    expect(result.shareOutcomes.map(({ outcome }) => outcome.kind)).toEqual([
      "already-known",
    ]);
    const stored = useAppStore.getState().exeCache.get("nova lands.exe");
    expect(stored).toMatchObject({
      gameId: game.id,
      igdbId: game.igdbId,
      source: "igdb",
    });
    expect(stored?.communitySuggestionId).toBeUndefined();
    expect(
      importShareDetail(
        result.shareOutcomes.map(({ outcome }) => outcome.kind),
      ),
    ).toContain("No community review was needed");
  });

  it("leaves failed verification retryable without pretending a review was submitted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ message: "Please try again later" }, { status: 503 }),
      ),
    );
    const commit = buildLibraryImportCommit({
      scanned,
      resolved: { ...resolved, executables: [] },
      selectedExecutable: scanned.executables[0],
    })!;
    const result = await runLibraryImport([commit]);
    expect(result.shareOutcomes[0].outcome.kind).toBe("failed");
    expect(useAppStore.getState().exeCache.get("nova lands.exe")).toMatchObject(
      { shareState: "failed" },
    );
    expect(importShareDetail(["failed"])).not.toContain(
      "sent to the community",
    );
    expect(useAppStore.getState().libraryImports.has("steam:1501610")).toBe(
      true,
    );
  });

  it("preserves an existing conflicting local mapping and adds an installation-scoped link", async () => {
    useAppStore.setState({
      exeCache: new Map([
        [
          "nova lands.exe",
          {
            exeName: "Nova Lands.exe",
            state: "matched",
            gameId: 999,
            igdbId: 999,
            source: "igdb",
            lastCheckedAt: new Date().toISOString(),
          },
        ],
      ]),
    });
    const commit = buildLibraryImportCommit({
      scanned,
      resolved: {
        ...resolved,
        executables: [{ ...executable, ambiguous: true }],
      },
    })!;
    await runLibraryImport([commit]);
    expect(useAppStore.getState().exeCache.get("nova lands.exe")?.igdbId).toBe(
      999,
    );
    expect([...useAppStore.getState().scopedExeLinks.values()]).toEqual([
      expect.objectContaining({
        igdbId: game.igdbId,
        identifierSource: "igdb",
      }),
    ]);
  });
});
