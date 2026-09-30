import type { Game } from "@playcounter/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: invokeMock,
}));
import { useAppStore } from "./store";
import {
  applyKnownGameMatch,
  cancelCommunitySuggestion,
  suggestTrackedGameToCommunity,
} from "./tracker";

// A file reported as another game, the suggestion cancelled, then a database
// match accepted in Check for matches: the file is that database game and
// nothing of the cancelled custom game stays with it - not its source, not
// its suggestion marker, not its IGDB id.

const T0 = new Date("2026-09-30T10:00:00Z").getTime();
const EXE = "DragonAge.exe";

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { userAgent: "Windows", platform: "Win32" });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { setItem: vi.fn(), getItem: vi.fn(() => null) },
  });
  invokeMock.mockImplementation(async () => []);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).endsWith("/suggestions/cancel")
        ? Response.json({ status: "cancelled" })
        : Response.json({ matches: [] }),
    ),
  );
  useAppStore.setState({
    exeCache: new Map(),
    scopedExeLinks: new Map(),
    libraryImports: new Map(),
    rejectedGameFiles: [],
    recentSessions: [
      {
        id: 1,
        gameId: 1,
        igdbId: 100,
        gameName: "Dragon Age",
        coverUrl: "",
        source: "igdb",
        exeName: EXE,
        startedAt: new Date(T0).toISOString(),
        endedAt: new Date(T0 + 600_000).toISOString(),
        durationSeconds: 600,
      },
    ],
    installUuid: "550e8400-e29b-41d4-a716-446655440000",
    backendHealth: { status: "online", checkedAt: null, detail: null },
  });
  useAppStore.getState().setExeCacheEntry({
    exeName: EXE,
    state: "matched",
    gameId: 1,
    igdbId: 100,
    gameName: "Dragon Age",
    coverUrl: "",
    source: "igdb",
    lastCheckedAt: new Date(T0).toISOString(),
  });
});

afterEach(() => vi.unstubAllGlobals());

it.each<[string, Game, number | undefined]>([
  [
    "an IGDB game",
    { id: 1, igdbId: 100, name: "Dragon Age", coverUrl: "", source: "igdb" },
    100,
  ],
  [
    "a community game",
    {
      id: 7,
      igdbId: 100,
      name: "Dragon Age",
      coverUrl: "",
      source: "community",
    },
    100,
  ],
  [
    "a community game without an IGDB id",
    { id: 8, name: "Dragon Age", coverUrl: "", source: "community" },
    undefined,
  ],
])(
  "accepting %s after a cancelled suggestion",
  async (_label, match, igdbId) => {
    // Reported as "Other Game" (IGDB 300), then cancelled: a private custom game.
    suggestTrackedGameToCommunity(EXE, "Other Game", "", 55, false, 300);
    expect(await cancelCommunitySuggestion(EXE.toLowerCase(), 55)).toEqual({
      kind: "cancelled",
    });
    expect(useAppStore.getState().exeCache.get("dragonage.exe")?.source).toBe(
      "custom",
    );

    applyKnownGameMatch(EXE, match);

    const state = useAppStore.getState();
    const entry = state.exeCache.get("dragonage.exe");
    expect(entry).toMatchObject({
      state: "matched",
      source: match.source,
      gameId: match.id,
      gameName: "Dragon Age",
    });
    expect(entry?.igdbId).toBe(igdbId);
    expect(entry?.communitySuggestionId).toBeUndefined();
    expect(state.recentSessions).toEqual([
      expect.objectContaining({
        gameId: match.id,
        source: match.source,
        igdbId,
      }),
    ]);
  },
);
