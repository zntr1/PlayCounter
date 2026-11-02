import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryImportEntry } from "./library/types";

// docs/psn-import-plan.md, "Live on PS5", rules 6–8 and "Auto-update".

const mocks = vi.hoisted(() => ({
  presence: [] as unknown[],
  saved: undefined as unknown,
  resolve: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "library_playstation_presence")
      return mocks.presence.shift() ?? { status: "valid", value: { online: true, game: null } };
    if (command === "library_playstation_saved_games") return mocks.saved;
    if (command === "playstation_read_trophies")
      return { status: "valid", value: [] };
    return undefined;
  }),
  convertFileSrc: (value: string) => value,
}));
vi.mock("./platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("./library/resolve", () => ({ resolveLibraryGames: mocks.resolve }));

const { invoke } = await import("@tauri-apps/api/core");
const { useAppStore } = await import("./store");
const { useKeptLogins } = await import("./library/keptLogins");
const { getLoginHealth, recordLoginHealth } = await import(
  "./library/loginHealth"
);
const { dismissLauncherGames } = await import(
  "./library/libraryAutoAddState"
);
const tracker = await import("./tracker");
const live = await import("./playstationLive");

const START = Date.parse("2026-11-01T20:00:00.000Z");
const at = (seconds: number) => START + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString();

const eldenRing: LibraryImportEntry = {
  provider: "playstation",
  externalId: "10000333",
  igdbId: 119133,
  gameId: 7,
  source: "igdb",
  name: "Elden Ring",
  coverUrl: "",
  importedAt: iso(-86_400),
  lastReadAt: iso(-86_400),
  providerSeconds: 10 * 3600,
  recordedSecondsAtRead: 0,
  linkedExeNames: [],
  linkedExeSources: [],
  consoleTitleIds: ["PPSA04609_00", "CUSA18638_00"],
};

const playing = (titleId = "PPSA04609_00", platform = "PS5") => ({
  status: "valid",
  value: {
    online: true,
    game: { titleId, name: "ELDEN RING", platform, iconUrl: null },
  },
});
const nothing = { status: "valid", value: { online: true, game: null } };

function presenceCalls() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "library_playstation_presence")
    .length;
}
function savedCalls() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "library_playstation_saved_games")
    .length;
}

async function pollAt(seconds: number, answer?: unknown) {
  vi.setSystemTime(at(seconds));
  if (answer) mocks.presence.push(answer);
  await live.pollPresence();
}

function consoleSessions() {
  return useAppStore.getState().activeSessions.filter((s) => s.console);
}

function savedSessions() {
  return useAppStore
    .getState()
    .recentSessions.filter((s) => s.origin === "playstation");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    libraryImports: new Map([["playstation:10000333", eldenRing]]),
  });
  useKeptLogins.setState({
    logins: [{ service: "playstation", name: "zesarex_ps", savedAt: 1 }],
  });
  recordLoginHealth("playstation", "valid");
  mocks.presence = [];
  mocks.saved = undefined;
  mocks.resolve.mockReset();
  vi.mocked(invoke).mockClear();
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
  live.initializePlayStationLive({
    start: tracker.startConsoleSession,
    see: tracker.seeConsoleSession,
    end: tracker.endConsoleSession,
  });
});

afterEach(() => {
  live.disposePlayStationLive();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("live sessions from PlayStation", () => {
  it("starts a session for a PS5 game of My Games and ends it at the last sighting", async () => {
    await pollAt(0, playing());
    expect(consoleSessions()).toMatchObject([
      { gameId: 7, console: "PS5", startedAt: iso(0), exeName: "PPSA04609_00" },
    ]);
    await pollAt(60, playing());
    await pollAt(120, nothing);
    expect(consoleSessions()).toEqual([]);
    expect(savedSessions()).toMatchObject([
      {
        gameId: 7,
        igdbId: 119133,
        origin: "playstation",
        console: "PS5",
        startedAt: iso(0),
        endedAt: iso(60),
        durationSeconds: 60,
      },
    ]);
  });

  it("recognises the game's PS4 copy too", async () => {
    await pollAt(0, playing("CUSA18638_00", "PS4"));
    expect(consoleSessions()).toMatchObject([{ gameId: 7, console: "PS4" }]);
  });

  it("ends the session where it was last seen after five minutes without a good answer", async () => {
    await pollAt(0, playing());
    await pollAt(60, playing());
    for (const seconds of [120, 180, 240, 300, 360]) {
      await pollAt(seconds, { status: "unavailable" });
      expect(consoleSessions()).toHaveLength(1);
    }
    await pollAt(361, { status: "unavailable" });
    expect(consoleSessions()).toEqual([]);
    expect(savedSessions()).toMatchObject([{ endedAt: iso(60) }]);
  });

  it("never counts the time a sleeping PC missed", async () => {
    await pollAt(0, playing());
    await pollAt(60, playing());
    await pollAt(2 * 3600, playing());
    expect(savedSessions()).toMatchObject([
      { startedAt: iso(0), endedAt: iso(60) },
    ]);
    expect(consoleSessions()).toMatchObject([{ startedAt: iso(2 * 3600) }]);
  });

  it("starts nothing for a title of no imported game and asks Sony's list once", async () => {
    mocks.saved = { status: "valid", value: { games: [], incomplete: false } };
    await pollAt(0, playing("PPSA99999_00"));
    expect(consoleSessions()).toEqual([]);
    await vi.waitFor(() => expect(savedCalls()).toBe(1));
    await pollAt(60, playing("PPSA99999_00"));
    expect(savedCalls()).toBe(1);
  });

  it("opens no second session when the game already runs on this PC", async () => {
    useAppStore.setState({
      activeSessions: [
        {
          id: 1,
          gameId: 7,
          igdbId: 119133,
          source: "igdb",
          gameName: "Elden Ring",
          exeName: "eldenring.exe",
          coverUrl: "",
          startedAt: iso(0),
          checkpointedAt: iso(0),
        },
      ],
    });
    await pollAt(0, playing());
    expect(useAppStore.getState().activeSessions).toHaveLength(1);
    expect(consoleSessions()).toEqual([]);
  });

  it("reads nothing with the switch off and ends a running session", async () => {
    await pollAt(0, playing());
    await pollAt(60, playing());
    useAppStore.getState().setPlayStationLive(false);
    const before = presenceCalls();
    await pollAt(120, playing());
    expect(presenceCalls()).toBe(before);
    expect(consoleSessions()).toEqual([]);
    expect(savedSessions()).toMatchObject([{ endedAt: iso(60) }]);
  });

  it("ends the session and asks for a sign-in when Sony refuses it", async () => {
    await pollAt(0, playing());
    await pollAt(60, { status: "needsSignIn" });
    expect(consoleSessions()).toEqual([]);
    expect(getLoginHealth("playstation")?.status).toBe("needsSignIn");
  });

  it("waits ten minutes after Sony answers 429", async () => {
    await pollAt(0, { status: "unavailable", rateLimited: true });
    const before = presenceCalls();
    await pollAt(9 * 60, playing());
    expect(presenceCalls()).toBe(before);
    await pollAt(10 * 60 + 1, playing());
    expect(presenceCalls()).toBe(before + 1);
  });

  it("ends a session from before a restart at its last sighting", async () => {
    live.disposePlayStationLive();
    useAppStore.setState({
      activeSessions: [
        {
          id: 5,
          gameId: 7,
          igdbId: 119133,
          source: "igdb",
          gameName: "Elden Ring",
          exeName: "PPSA04609_00",
          coverUrl: "",
          startedAt: iso(0),
          checkpointedAt: iso(600),
          console: "PS5",
          recoveredFromCheckpoint: true,
        },
      ],
    });
    vi.setSystemTime(at(3600));
    live.initializePlayStationLive({
      start: tracker.startConsoleSession,
      see: tracker.seeConsoleSession,
      end: tracker.endConsoleSession,
    });
    await vi.waitFor(() => expect(consoleSessions()).toEqual([]));
    expect(savedSessions()).toMatchObject([{ endedAt: iso(600) }]);
  });
});

describe("Sony's totals refresh by themselves", () => {
  const sonyGame = (conceptId: string, title: string, hours: number) => ({
    conceptId,
    title,
    playtimeSeconds: hours * 3600,
    lastPlayedAt: null,
    platforms: ["PS5"],
    titleIds: [conceptId === "10000333" ? "PPSA04609_00" : "PPSA11110_00"],
  });

  it("takes Sony's higher total and reads an unchanged one no further", async () => {
    mocks.saved = {
      status: "valid",
      value: { games: [sonyGame("10000333", "ELDEN RING", 13)], incomplete: false },
    };
    vi.setSystemTime(at(100));
    await live.refreshPlayStationGames("test");
    const updated = useAppStore.getState().libraryImports.get("playstation:10000333")!;
    expect(updated.providerSeconds).toBe(13 * 3600);
    expect(updated.lastReadAt).toBe(iso(100));
    vi.setSystemTime(at(200));
    await live.refreshPlayStationGames("test");
    expect(
      useAppStore.getState().libraryImports.get("playstation:10000333")!.lastReadAt,
    ).toBe(iso(100));
  });

  it("adds a new game IGDB knows, unless adding new games is off or the player removed it", async () => {
    mocks.saved = {
      status: "valid",
      value: {
        games: [sonyGame("10000333", "ELDEN RING", 10), sonyGame("10002684", "Astro Bot", 6)],
        incomplete: false,
      },
    };
    mocks.resolve.mockResolvedValue({
      capability: "supported",
      games: [
        {
          key: "playstation:10002684",
          status: "resolved",
          game: { id: 8, igdbId: 303811, name: "Astro Bot", coverUrl: "", source: "igdb" },
          executables: [],
        },
      ],
    });

    useAppStore.setState((state) => ({
      settings: { ...state.settings, autoAddInstalledGames: false },
    }));
    await live.refreshPlayStationGames("off");
    expect(useAppStore.getState().libraryImports.has("playstation:10002684")).toBe(false);

    useAppStore.setState((state) => ({
      settings: { ...state.settings, autoAddInstalledGames: true },
    }));
    dismissLauncherGames([{ provider: "playstation", externalId: "10002684" }]);
    await live.refreshPlayStationGames("dismissed");
    expect(useAppStore.getState().libraryImports.has("playstation:10002684")).toBe(false);
  });

  it("never adds a game Sony names no console for: the player picks those in the importer", async () => {
    mocks.saved = {
      status: "valid",
      value: {
        games: [
          sonyGame("10002684", "Astro Bot", 6),
          // GTA V on Phil's account: Sony's "unknown" category.
          {
            ...sonyGame("201930", "Grand Theft Auto V (PlayStation®5)", 810),
            titleIds: ["CUSA00411_00"],
            consoleUnknown: true,
          },
        ],
        incomplete: false,
      },
    };
    mocks.resolve.mockResolvedValue({
      capability: "supported",
      games: [
        {
          key: "playstation:10002684",
          status: "resolved",
          game: { id: 8, igdbId: 303811, name: "Astro Bot", coverUrl: "", source: "igdb" },
          executables: [],
        },
        {
          key: "playstation:201930",
          status: "resolved",
          game: { id: 9, igdbId: 1020, name: "Grand Theft Auto V", coverUrl: "", source: "igdb" },
          executables: [],
        },
      ],
    });
    expect(await live.refreshPlayStationGames("test")).toBe(1);
    const imports = useAppStore.getState().libraryImports;
    expect(imports.has("playstation:10002684")).toBe(true);
    expect(imports.has("playstation:201930")).toBe(false);
  });

  it("adds the new game with its title ids, so it plays live next time", async () => {
    mocks.saved = {
      status: "valid",
      value: { games: [sonyGame("10002684", "Astro Bot", 6)], incomplete: false },
    };
    mocks.resolve.mockResolvedValue({
      capability: "supported",
      games: [
        {
          key: "playstation:10002684",
          status: "resolved",
          game: { id: 8, igdbId: 303811, name: "Astro Bot", coverUrl: "", source: "igdb" },
          executables: [],
        },
      ],
    });
    await expect(live.refreshPlayStationGames("new")).resolves.toBe(1);
    expect(
      useAppStore.getState().libraryImports.get("playstation:10002684"),
    ).toMatchObject({ providerSeconds: 6 * 3600, consoleTitleIds: ["PPSA11110_00"] });
    await pollAt(300, playing("PPSA11110_00"));
    expect(consoleSessions()).toMatchObject([{ gameId: 8 }]);
  });
});

describe("trophies after a console session", () => {
  const commands = () =>
    vi.mocked(invoke).mock.calls.map(([command]) => command);

  it("are read again with the kept sign-in a little after the session ends, never with a window", async () => {
    await pollAt(0, playing());
    await pollAt(60, playing());
    await pollAt(120, nothing);
    expect(savedSessions()).toHaveLength(1);
    expect(commands()).not.toContain("playstation_read_trophies");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(invoke).toHaveBeenCalledWith("playstation_read_trophies", {
      titleIds: ["PPSA04609_00", "CUSA18638_00"],
      language: "en-US",
    });
    expect(commands()).not.toContain("library_playstation_sign_in");
    expect(commands()).not.toContain("library_playstation_account_games");
  });
});
