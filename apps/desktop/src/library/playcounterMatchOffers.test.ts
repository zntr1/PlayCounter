// @vitest-environment happy-dom
import type { LibraryKnownExecutable } from "@playcounter/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { collectLevelUpOffers } from "../ui/levelUpOffers";
import { checkPlayCounterGameForMatches } from "./knownGameFiles";
import {
  startLibraryImportMatchChecks,
  untrackablePlayCounterGames,
  useLibraryMatchOffers,
} from "./matchOffers";
import { moveGamesToPlayCounter } from "./moveToPlayCounter";
import type { LibraryImportEntry, PlayCounterLibraryEntry } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  convertFileSrc: (value: string) => value,
}));

const DATE = "2026-10-11T10:00:00.000Z";
const GAME = {
  id: 156864,
  igdbId: 127697,
  name: "Tainted Grail: The Fall of Avalon",
  coverUrl: "",
  source: "igdb" as const,
};
const ENTRY: PlayCounterLibraryEntry = {
  gameId: GAME.id,
  igdbId: GAME.igdbId,
  source: "igdb",
  name: GAME.name,
  coverUrl: "",
  addedAt: DATE,
};

let stop: (() => void) | undefined;
let lookups = 0;

function exe(value: string, extra: Partial<LibraryKnownExecutable> = {}) {
  return {
    platform: "windows",
    kind: "exe",
    value,
    provenance: "community",
    verified: true,
    ...extra,
  } satisfies LibraryKnownExecutable;
}

/** The server's files for the game. */
function serve(executables: LibraryKnownExecutable[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/library/reverse-resolve")) {
        lookups += 1;
        const { gameId } = JSON.parse(String(init?.body)) as {
          gameId: number;
        };
        return gameId === GAME.id
          ? Response.json({ game: GAME, executables })
          : Response.json({ error: "Game not found" }, { status: 404 });
      }
      return Response.json({ error: "not found" }, { status: 404 });
    }),
  );
}

function addPlayCounterGame() {
  useAppStore.setState({
    playcounterLibrary: new Map([[`igdb#${ENTRY.igdbId}`, ENTRY]]),
  });
}

beforeEach(() => {
  localStorage.clear();
  lookups = 0;
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    backendHealth: { status: "online", checkedAt: null, detail: null },
  });
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
});

describe("checking a PlayCounter game for files", () => {
  it("finds the server's file for the game", async () => {
    serve([exe("Fall of Avalon.exe")]);
    const result = await checkPlayCounterGameForMatches({
      apiEndpoint: "http://api.test",
      game: ENTRY,
    });
    expect(result).toMatchObject({
      kind: "found",
      files: [{ exeName: "Fall of Avalon.exe", identifierSource: "community" }],
      executableMatches: [
        { name: "Fall of Avalon.exe", sources: ["community"] },
      ],
    });
  });

  it("asks for the file when the server only knows a name that needs a folder", async () => {
    serve([exe("Game.exe")]);
    const result = await checkPlayCounterGameForMatches({
      apiEndpoint: "http://api.test",
      game: ENTRY,
    });
    expect(result).toEqual({
      kind: "needs_file",
      executableNames: ["Game.exe"],
    });
  });

  it("does not offer a file that already counts for another game", async () => {
    serve([exe("Fall of Avalon.exe")]);
    useAppStore.setState({
      exeCache: new Map([
        [
          "fall of avalon.exe",
          {
            exeName: "Fall of Avalon.exe",
            state: "matched",
            gameId: 9,
            igdbId: 9,
            gameName: "Other game",
            source: "igdb",
            lastCheckedAt: DATE,
          },
        ],
      ]),
    });
    const result = await checkPlayCounterGameForMatches({
      apiEndpoint: "http://api.test",
      game: ENTRY,
    });
    expect(result.kind).toBe("not_found");
  });

  it("does not offer a file the user said does not belong to the game", async () => {
    serve([exe("Fall of Avalon.exe")]);
    useAppStore.setState({
      rejectedGameFiles: [
        {
          exeName: "fall of avalon.exe",
          gameId: GAME.id,
          source: "igdb",
          igdbId: GAME.igdbId,
          rejectedAt: DATE,
        },
      ],
    });
    const result = await checkPlayCounterGameForMatches({
      apiEndpoint: "http://api.test",
      game: ENTRY,
    });
    expect(result.kind).toBe("not_found");
  });
});

describe("startup level up for PlayCounter games", () => {
  it("offers the server's file for a PlayCounter game without one", async () => {
    serve([exe("Fall of Avalon.exe")]);
    addPlayCounterGame();
    stop = startLibraryImportMatchChecks();
    await vi.waitFor(() =>
      expect(
        useLibraryMatchOffers.getState().playcounterOffers.get(GAME.igdbId),
      ).toMatchObject({
        entry: ENTRY,
        executableMatches: [{ name: "Fall of Avalon.exe" }],
      }),
    );

    const offers = collectLevelUpOffers(
      [
        {
          name: GAME.name,
          igdbId: GAME.igdbId,
          exeNames: [],
          emulatorContentKeys: [],
          libraryImports: [],
        },
      ],
      useAppStore.getState().exeCache,
      new Map(),
      useLibraryMatchOffers.getState().playcounterOffers,
    );
    expect(offers).toEqual([
      {
        kind: "playcounter",
        key: `playcounter:${GAME.igdbId}`,
        gameName: GAME.name,
        entry: ENTRY,
        exeNames: ["Fall of Avalon.exe"],
      },
    ]);
  });

  it("skips PlayCounter games a file already tracks", () => {
    addPlayCounterGame();
    useAppStore.setState({
      exeCache: new Map([
        [
          "fall of avalon.exe",
          {
            exeName: "Fall of Avalon.exe",
            state: "matched",
            gameId: GAME.id,
            igdbId: GAME.igdbId,
            gameName: GAME.name,
            source: "igdb",
            lastCheckedAt: DATE,
          },
        ],
      ]),
    });
    expect(untrackablePlayCounterGames()).toEqual([]);
  });

  it("shows no offer for a game that already has a file", () => {
    const offers = collectLevelUpOffers(
      [
        {
          name: GAME.name,
          igdbId: GAME.igdbId,
          exeNames: ["Fall of Avalon.exe"],
          emulatorContentKeys: [],
          libraryImports: [],
        },
      ],
      new Map(),
      new Map(),
      new Map([
        [
          GAME.igdbId,
          {
            entry: ENTRY,
            executableMatches: [
              { name: "Fall of Avalon.exe", sources: ["community" as const] },
            ],
          },
        ],
      ]),
    );
    expect(offers).toEqual([]);
  });
});

describe("Move to PlayCounter", () => {
  it("links the server's files, like a game added by hand", async () => {
    serve([exe("Fall of Avalon.exe")]);
    const imported: LibraryImportEntry = {
      provider: "steam",
      externalId: "1466060",
      gameId: GAME.id,
      igdbId: GAME.igdbId,
      source: "igdb",
      name: GAME.name,
      coverUrl: "",
      importedAt: DATE,
      lastReadAt: DATE,
      providerSeconds: 2400,
      linkedExeNames: [],
      linkedExeSources: [],
    };
    useAppStore.setState({
      libraryImports: new Map([["steam:1466060", imported]]),
    });

    expect(
      moveGamesToPlayCounter([
        { gameId: GAME.id, igdbId: GAME.igdbId, source: "igdb" },
      ]),
    ).toBe(1);
    await vi.waitFor(() =>
      expect(
        useAppStore.getState().exeCache.get("fall of avalon.exe"),
      ).toMatchObject({
        state: "matched",
        gameId: GAME.id,
        igdbId: GAME.igdbId,
        identifierSource: "community",
      }),
    );
    expect(lookups).toBe(1);
  });
});
