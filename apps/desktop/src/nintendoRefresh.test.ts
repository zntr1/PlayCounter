import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryImportEntry } from "./library/types";

// docs/nintendo-import-plan.md, D3 A and D4 B: the play history is read
// every hour while PlayCounter runs; imported games take Nintendo's higher
// totals, and a new game comes in when the name search finds exactly one
// game of that name.

const mocks = vi.hoisted(() => ({
  saved: undefined as unknown,
  search: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "library_nintendo_saved_games") return mocks.saved;
    return undefined;
  }),
  convertFileSrc: (value: string) => value,
}));
vi.mock("./platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("./library/gameLookup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./library/gameLookup")>()),
  searchLibraryGames: mocks.search,
}));

const { invoke } = await import("@tauri-apps/api/core");
const { useAppStore } = await import("./store");
const { useKeptLogins } = await import("./library/keptLogins");
const { getLoginHealth, recordLoginHealth } =
  await import("./library/loginHealth");
const { dismissLauncherGames } = await import("./library/libraryAutoAddState");
const refresh = await import("./nintendoRefresh");

const START = Date.parse("2026-11-14T20:00:00.000Z");
const at = (seconds: number) => START + seconds * 1000;
const iso = (seconds: number) => new Date(at(seconds)).toISOString();

const odyssey: LibraryImportEntry = {
  provider: "nintendo",
  externalId: "0100000000010000",
  igdbId: 26_758,
  gameId: 3,
  source: "igdb",
  name: "Super Mario Odyssey",
  coverUrl: "",
  importedAt: iso(-86_400),
  lastReadAt: iso(-86_400),
  providerSeconds: 300 * 60,
  recordedSecondsAtRead: 0,
  linkedExeNames: [],
  linkedExeSources: [],
};

// Rows as Rust passes them on (Phil's account, 2026-11-14).
const nintendoGame = (titleId: string, title: string, minutes: number) => ({
  titleId,
  title,
  playtimeSeconds: minutes * 60,
  lastPlayedAt: "2019-12-03T22:20:33Z",
});
const history = (...games: ReturnType<typeof nintendoGame>[]) => ({
  status: "valid",
  value: { games },
});
const tetris99 = {
  id: 9,
  igdbId: 113_112,
  name: "Tetris 99",
  coverUrl: "",
  source: "igdb" as const,
};

function savedCalls() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(
      ([command]) => command === "library_nintendo_saved_games",
    ).length;
}

function imported(externalId: string) {
  return useAppStore.getState().libraryImports.get(`nintendo:${externalId}`);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    libraryImports: new Map([["nintendo:0100000000010000", odyssey]]),
  });
  useKeptLogins.setState({
    logins: [{ service: "nintendo", name: "Phil", savedAt: 1 }],
  });
  recordLoginHealth("nintendo", "valid");
  mocks.saved = undefined;
  mocks.search.mockReset();
  mocks.search.mockResolvedValue([]);
  vi.mocked(invoke).mockClear();
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
    removeItem: (key: string) => items.delete(key),
  });
});

afterEach(() => {
  refresh.disposeNintendoRefresh();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Nintendo's totals refresh by themselves", () => {
  it("reads once an hour while signed in, and not at all when signed out", async () => {
    mocks.saved = history(
      nintendoGame("0100000000010000", "SUPER MARIO ODYSSEY", 300),
    );
    refresh.initializeNintendoRefresh();
    await vi.advanceTimersByTimeAsync(29_000);
    expect(savedCalls()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(savedCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(savedCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(savedCalls()).toBe(2);

    useKeptLogins.setState({ logins: [] });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(savedCalls()).toBe(2);
  });

  it("takes Nintendo's higher total and reads an unchanged one no further", async () => {
    mocks.saved = history(
      nintendoGame("0100000000010000", "SUPER MARIO ODYSSEY", 397),
    );
    vi.setSystemTime(at(100));
    await refresh.refreshNintendoGames("test");
    expect(imported("0100000000010000")?.providerSeconds).toBe(23_820);
    expect(imported("0100000000010000")?.lastReadAt).toBe(iso(100));
    // The card keeps the game it was matched to.
    expect(imported("0100000000010000")?.name).toBe("Super Mario Odyssey");

    vi.setSystemTime(at(200));
    await refresh.refreshNintendoGames("test");
    expect(imported("0100000000010000")?.lastReadAt).toBe(iso(100));
  });

  // docs/remove-account-hours-plan.md, Q4: a background read never adds an
  // account the game doesn't have (one removed in Details would be back
  // within the hour); another account joins a game only through the
  // importer.
  it("updates only the accounts a game has, and adds no other", async () => {
    const phil = { key: "a".repeat(32), name: "Phil" };
    const kid = { key: "b".repeat(32), name: "Kid" };
    useAppStore.setState({
      libraryImports: new Map([
        [
          "nintendo:0100000000010000",
          {
            ...odyssey,
            accounts: [{ ...phil, seconds: 300 * 60, readAt: iso(-86_400) }],
          },
        ],
      ]),
    });
    const readAs = async (
      account: typeof phil,
      minutes: number,
      second: number,
    ) => {
      mocks.saved = {
        ...history(
          nintendoGame("0100000000010000", "SUPER MARIO ODYSSEY", minutes),
        ),
      };
      (mocks.saved as { value: Record<string, unknown> }).value.account =
        account;
      vi.setSystemTime(at(second));
      await refresh.refreshNintendoGames("test");
      const entry = imported("0100000000010000")!;
      return {
        minutes: entry.providerSeconds! / 60,
        accounts: entry.accounts?.map((item) => item.key),
      };
    };

    expect(await readAs(kid, 120, 100)).toEqual({
      minutes: 300,
      accounts: [phil.key],
    });
    expect(await readAs(phil, 397, 200)).toEqual({
      minutes: 397,
      accounts: [phil.key],
    });
  });

  it("adds a new game when the name search finds exactly one game of that name", async () => {
    mocks.saved = history(
      nintendoGame("0100000000010000", "SUPER MARIO ODYSSEY", 300),
      nintendoGame("010040600c5ce000", "TETRIS 99", 16),
    );
    mocks.search.mockResolvedValue([
      tetris99,
      { ...tetris99, id: 10, igdbId: 1, name: "Tetris" },
    ]);
    const added = await refresh.refreshNintendoGames("test");
    expect(added).toBe(1);
    expect(mocks.search).toHaveBeenCalledTimes(1);
    expect(mocks.search).toHaveBeenCalledWith(
      useAppStore.getState().settings.apiEndpoint,
      "TETRIS 99",
      expect.anything(),
    );
    const entry = imported("010040600c5ce000");
    expect(entry).toMatchObject({
      provider: "nintendo",
      igdbId: 113_112,
      name: "Tetris 99",
      providerSeconds: 960,
      linkedExeNames: [],
    });
    expect(useAppStore.getState().exeCache.size).toBe(0);
    expect(useAppStore.getState().toasts[0]?.title).toBe("1 game added");
  });

  it("adds no game when the search finds none or two of that name, and asks again only a day later", async () => {
    mocks.saved = history(
      nintendoGame("0100000000010000", "SUPER MARIO ODYSSEY", 300),
      nintendoGame("0100633007d48000", "Hollow Knight", 600),
    );
    mocks.search.mockResolvedValue([
      { ...tetris99, id: 20, igdbId: 14_593, name: "Hollow Knight" },
      { ...tetris99, id: 21, igdbId: 99_999, name: "Hollow Knight" },
    ]);
    expect(await refresh.refreshNintendoGames("test")).toBe(0);
    expect(imported("0100633007d48000")).toBeUndefined();
    expect(mocks.search).toHaveBeenCalledTimes(1);

    vi.setSystemTime(at(60 * 60));
    await refresh.refreshNintendoGames("an hour later");
    expect(mocks.search).toHaveBeenCalledTimes(1);

    vi.setSystemTime(at(24 * 60 * 60));
    mocks.search.mockResolvedValue([]);
    await refresh.refreshNintendoGames("a day later");
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(imported("0100633007d48000")).toBeUndefined();
  });

  it("adds nothing with Add new games automatically off, or for a game the player removed", async () => {
    mocks.saved = history(
      nintendoGame("0100000000010000", "SUPER MARIO ODYSSEY", 300),
      nintendoGame("010040600c5ce000", "TETRIS 99", 16),
    );
    mocks.search.mockResolvedValue([tetris99]);

    useAppStore.setState((state) => ({
      settings: { ...state.settings, autoAddInstalledGames: false },
    }));
    await refresh.refreshNintendoGames("off");
    expect(imported("010040600c5ce000")).toBeUndefined();

    useAppStore.setState((state) => ({
      settings: { ...state.settings, autoAddInstalledGames: true },
    }));
    dismissLauncherGames([
      { provider: "nintendo", externalId: "010040600c5ce000" },
    ]);
    await refresh.refreshNintendoGames("dismissed");
    expect(imported("010040600c5ce000")).toBeUndefined();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("a refresh Nintendo refuses shows the sign-in warning, not an error toast", async () => {
    mocks.saved = { status: "needsSignIn" };
    await refresh.refreshNintendoGames("test");
    expect(getLoginHealth("nintendo")?.status).toBe("needsSignIn");
    expect(
      useAppStore.getState().toasts.some((toast) => toast.tone === "error"),
    ).toBe(false);
    expect(imported("0100000000010000")?.providerSeconds).toBe(300 * 60);
  });

  it("reads nothing without games from Nintendo in My Games", async () => {
    useAppStore.setState({ libraryImports: new Map() });
    await refresh.refreshNintendoGames("test");
    expect(savedCalls()).toBe(0);
  });
});
