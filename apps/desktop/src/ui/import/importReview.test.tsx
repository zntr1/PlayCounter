// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryKnownExecutable } from "@playcounter/shared";
import type { BuiltinImportProviderId } from "../../library/importProviders";
import type {
  LibraryImportEntry,
  LibraryScanResult,
  ResolvedLibraryGame,
  ScannedExecutable,
  ScannedLibraryGame,
} from "../../library/types";
import type { GameMetadata } from "../../store";

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  reverse: vi.fn(),
  search: vi.fn(),
  run: vi.fn(),
  invoke: vi.fn(),
  localAccounts: 1,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (v: string) => v,
}));
vi.mock("../../library/providers", () => ({
  loadLibraryProvider: async (provider: string) => ({
    accountMode:
      provider === "epic" || provider === "battlenet" ? "none" : undefined,
    detect: async () => ({ provider, available: true, checkedPaths: [] }),
    listAccounts: async () =>
      provider === "epic" || provider === "battlenet"
        ? []
        : Array.from({ length: mocks.localAccounts }, (_, index) => ({
            accountId: index + 1,
            mostRecent: index === 0,
            gamesWithPlaytime: 1,
          })),
    scan: mocks.scan,
  }),
}));
vi.mock("../../library/gameLookup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../library/gameLookup")>()),
  reverseResolveLibraryGame: mocks.reverse,
  searchLibraryGames: mocks.search,
}));
vi.mock("../../library/importRun", () => ({ runLibraryImport: mocks.run }));

type Shelf = "ready" | "attention" | "imported" | "unavailable";

let root: Root;
let container: HTMLDivElement;
let store: typeof import("../../store").useAppStore;

function game(
  externalId: string,
  name: string,
  extra: Partial<ScannedLibraryGame> = {},
): ScannedLibraryGame {
  return {
    externalId,
    name,
    playtimeSeconds: 3_600,
    installed: false,
    executables: [],
    ...extra,
  };
}

function exe(
  fileName: string,
  extra: Partial<ScannedExecutable> = {},
): ScannedExecutable {
  return {
    fileName,
    relativePath: fileName,
    sizeBytes: 1_000_000,
    depth: 0,
    ...extra,
  };
}

function metadata(
  id: number,
  name: string,
  extra: Partial<GameMetadata> = {},
): GameMetadata {
  return { id, igdbId: id, name, coverUrl: "", source: "igdb", ...extra };
}

function matched(
  key: string,
  match: GameMetadata,
  executables: LibraryKnownExecutable[] = [],
): ResolvedLibraryGame {
  return { key, status: "resolved", game: match, executables };
}

function unmatched(
  key: string,
  candidates: GameMetadata[] = [],
): ResolvedLibraryGame {
  return { key, status: "unknown", executables: [], candidates };
}

function inMyGames(
  provider: BuiltinImportProviderId,
  externalId: string,
  match: GameMetadata,
  extra: Partial<LibraryImportEntry> = {},
): LibraryImportEntry {
  return {
    provider,
    externalId,
    igdbId: match.igdbId!,
    gameId: match.id,
    source: "igdb",
    name: match.name,
    coverUrl: "",
    importedAt: "2026-10-01T12:00:00.000Z",
    providerSeconds: 3_600,
    lastReadAt: "2026-10-01T12:00:00.000Z",
    linkedExeNames: [],
    linkedExeSources: [],
    ...extra,
  };
}

function findButton(label: string) {
  return [...document.body.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
}

async function click(label: string) {
  const button = findButton(label);
  expect(button, label).toBeDefined();
  await act(() => button!.click());
}

/** Opens the launcher with these games already in My Games, and scans. */
async function scan(
  provider: BuiltinImportProviderId,
  result: Omit<LibraryScanResult, "warnings" | "partial"> & {
    partial?: boolean;
  },
  imports: LibraryImportEntry[] = [],
) {
  await act(() =>
    store.setState({
      libraryImportProvider: provider,
      battleNetPlaytimeNoticeSeen: true,
      libraryImports: new Map(
        imports.map((entry) => [
          `${entry.provider}:${entry.externalId}`,
          entry,
        ]),
      ),
    }),
  );
  mocks.scan.mockResolvedValue({ warnings: [], partial: false, ...result });
  await click(
    findButton("Find games") ? "Find games" : "Sign in and find games",
  );
}

function shelf(group: Shelf) {
  const tab = container.querySelector<HTMLButtonElement>(
    `#import-tab-${group}`,
  )!;
  return {
    tab,
    count: Number(tab.querySelector(".tabular-nums")?.textContent),
    open: tab.getAttribute("aria-selected") === "true",
  };
}

function counts() {
  return Object.fromEntries(
    (["ready", "attention", "imported", "unavailable"] as const).map(
      (group) => [group, shelf(group).count],
    ),
  );
}

/** The game titles in the list of the open shelf. */
function listed() {
  return [
    ...container.querySelectorAll(
      '[role="tabpanel"] button[aria-current] .font-semibold',
    ),
  ].map((title) => title.textContent);
}

/** A game's row in the list of the open shelf. */
function row(title: string) {
  const found = [
    ...container.querySelectorAll<HTMLButtonElement>(
      '[role="tabpanel"] button[aria-current]',
    ),
  ].find((item) => item.querySelector(".font-semibold")?.textContent === title);
  expect(found, title).toBeDefined();
  return found!;
}

function key(name: string, repeat = false) {
  return new KeyboardEvent("keydown", {
    key: name,
    repeat,
    bubbles: true,
    cancelable: true,
  });
}

function checkbox(title: string) {
  return container.querySelector<HTMLInputElement>(
    `input[aria-label="Import ${title}"]`,
  );
}

function fileChoice(gameName: string, fileName: string) {
  return container.querySelector<HTMLInputElement>(
    `[role="radiogroup"][aria-label="Game file for ${gameName}"] input[value="${fileName}"]`,
  );
}

function checkedFile(gameName: string) {
  return [
    ...container.querySelectorAll<HTMLInputElement>(
      `[role="radiogroup"][aria-label="Game file for ${gameName}"] input`,
    ),
  ].find((input) => input.checked)?.value;
}

async function type(input: HTMLInputElement, value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.localAccounts = 1;
  mocks.search.mockResolvedValue([]);
  // Importing puts the games in My Games, as the real import does.
  mocks.run.mockImplementation(
    async (commits: { entry: LibraryImportEntry }[]) => {
      store.setState((state) => ({
        libraryImports: new Map([
          ...state.libraryImports,
          ...commits.map(
            ({ entry }) =>
              [`${entry.provider}:${entry.externalId}`, entry] as const,
          ),
        ]),
      }));
      return { shareOutcomes: [] };
    },
  );
  // A shown game is looked up at once; tests that import one set the answer.
  mocks.reverse.mockReturnValue(new Promise(() => {}));
  ({ useAppStore: store } = await import("../../store"));
  const { ImportLibraryView } = await import("./ImportLibraryView");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(createElement(ImportLibraryView)));
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("is the default export the app loads lazily", async () => {
  const view = await import("./ImportLibraryView");
  expect(view.default).toBeTypeOf("function");
});

describe("the shelves", () => {
  const portal2 = metadata(72, "Portal 2");
  const portal = metadata(71, "Portal");
  const halfLife = metadata(233, "Half-Life 2");
  const counterStrike = metadata(242_408, "Counter-Strike 2");
  const steamLibrary = {
    games: [
      game("620", "Portal 2"),
      game("220", "Half-Life 2", {
        installed: true,
        installPath: String.raw`C:\Steam\steamapps\common\Half-Life 2`,
        executables: [exe("hl2.exe"), exe("hl2_linux.exe")],
      }),
      game("730", "Counter-Strike 2", { playtimeSeconds: 7_200 }),
      game("431960", "Wallpaper Engine"),
      game("400", "Portal"),
    ],
    resolvedGames: [
      matched("steam:620", portal2),
      matched("steam:220", halfLife),
      matched("steam:730", counterStrike),
      unmatched("steam:431960"),
      matched("steam:400", portal),
    ],
  };

  it("count their games, open on the first one with games and filter the list", async () => {
    await scan("steam", steamLibrary, [
      inMyGames("steam", "730", counterStrike),
    ]);

    expect(counts()).toEqual({
      ready: 2,
      attention: 1,
      imported: 1,
      unavailable: 1,
    });
    expect(shelf("ready").open).toBe(true);
    expect(listed()).toEqual(["Portal 2", "Portal"]);

    await act(() => shelf("attention").tab.click());
    expect(shelf("attention").open).toBe(true);
    expect(listed()).toEqual(["Half-Life 2"]);
    expect(container.textContent).toContain("Which file starts the game?");

    await act(() => shelf("imported").tab.click());
    expect(listed()).toEqual(["Counter-Strike 2"]);

    await act(() => shelf("unavailable").tab.click());
    expect(listed()).toEqual(["Wallpaper Engine"]);
  });

  it("opens on Needs you when nothing is ready", async () => {
    await scan("steam", {
      games: [steamLibrary.games[1], steamLibrary.games[3]],
      resolvedGames: [
        steamLibrary.resolvedGames[1],
        steamLibrary.resolvedGames[3],
      ],
    });
    expect(shelf("attention").open).toBe(true);
    expect(listed()).toEqual(["Half-Life 2"]);
  });

  it("searches the open shelf", async () => {
    await scan("steam", steamLibrary);
    await type(
      container.querySelector<HTMLInputElement>(
        'input[placeholder="Search games"]',
      )!,
      "portal 2",
    );
    expect(listed()).toEqual(["Portal 2"]);
  });
});

it.each([
  [
    "epic",
    game("Freebie", "Free Game", {
      playtimeSeconds: 0,
      hasPlayedEvidence: false,
      inAccountLibrary: true,
    }),
    game("Hades", "Hades", { playtimeSeconds: 7_200, inAccountLibrary: true }),
  ],
  [
    "battlenet",
    // An account game as the Battle.net account read reports it.
    game("s1", "StarCraft: Remastered", {
      playtimeSeconds: null,
      hasPlayedEvidence: false,
      inAccountLibrary: true,
    }),
    game("fenris", "Diablo IV", {
      playtimeSeconds: null,
      hasPlayedEvidence: false,
      inAccountLibrary: true,
      installed: true,
      installPath: String.raw`C:\Program Files (x86)\Diablo IV`,
      executables: [exe("Diablo IV.exe")],
    }),
  ],
] as const)(
  "%s: games you never played and have not installed start unchecked",
  async (provider, neverPlayed, played) => {
    const diabloFile: LibraryKnownExecutable = {
      platform: "windows",
      kind: "exe",
      value: "Diablo IV.exe",
      provenance: "igdb",
      verified: true,
    };
    await scan(provider, {
      games: [neverPlayed, played],
      resolvedGames: [
        matched(
          `${provider}:${neverPlayed.externalId}`,
          metadata(1, neverPlayed.name!),
        ),
        matched(`${provider}:${played.externalId}`, metadata(2, played.name!), [
          diabloFile,
        ]),
      ],
    });

    expect(listed()).toEqual([neverPlayed.name, played.name]);
    expect(checkbox(neverPlayed.name!)?.checked).toBe(false);
    expect(checkbox(played.name!)?.checked).toBe(true);
    expect(container.textContent).toContain("1 game selected");
  },
);

it("playstation: a game Sony names no console for starts unchecked, and its details say why", async () => {
  // Phil's account: Bloodborne he played himself; GTA V someone else played
  // on it, in Sony's "unknown" category.
  const own = game("200520", "Bloodborne", {
    playtimeSeconds: 264_060,
    hasPlayedEvidence: true,
    inAccountLibrary: true,
    consoleTitleIds: ["CUSA00207_00"],
  });
  const unknown = game("201930", "Grand Theft Auto V", {
    playtimeSeconds: 2_917_966,
    hasPlayedEvidence: true,
    inAccountLibrary: true,
    consoleTitleIds: ["CUSA00411_00"],
    consoleUnknown: true,
  });
  await scan("playstation", {
    games: [own, unknown],
    resolvedGames: [
      matched("playstation:200520", metadata(1, "Bloodborne")),
      matched("playstation:201930", metadata(2, "Grand Theft Auto V")),
    ],
  });
  expect(listed()).toEqual(["Bloodborne", "Grand Theft Auto V"]);
  expect(checkbox("Bloodborne")?.checked).toBe(true);
  expect(checkbox("Grand Theft Auto V")?.checked).toBe(false);
  expect(container.textContent).toContain("1 game selected");

  const why =
    "Sony lists this game without a console. Check it only if you played it yourself and want to add it to your PlayCounter library.";
  await act(() => row("Grand Theft Auto V").click());
  expect(detailTitle()).toBe("Grand Theft Auto V");
  expect(container.textContent).toContain(why);
  await act(() => row("Bloodborne").click());
  expect(detailTitle()).toBe("Bloodborne");
  expect(container.textContent).not.toContain(why);
});

it("playstation: a game's details name no PC install and no PC game files", async () => {
  // The database knows the PC version's .exe; the PlayStation copy has none.
  const horizon = game("200937", "Horizon Zero Dawn", {
    playtimeSeconds: 22_576,
    hasPlayedEvidence: true,
    inAccountLibrary: true,
    consoleTitleIds: ["CUSA01967_00"],
  });
  await scan("playstation", {
    games: [horizon],
    resolvedGames: [
      matched("playstation:200937", metadata(21, "Horizon Zero Dawn"), [
        knownFile("HorizonZeroDawn.exe"),
      ]),
    ],
  });
  await act(() => row("Horizon Zero Dawn").click());
  const details =
    container.querySelector('section[aria-label="Horizon Zero Dawn"]')
      ?.textContent ?? "";
  expect(details).toContain("Concept ID");
  expect(details).not.toContain("On this PC");
  expect(details).not.toContain("Game files");
});

it("playstation: importing a game you confirmed names no PC game files", async () => {
  // Sony's title isn't matched, so the player confirms the game; the
  // database knows the PC version's .exe.
  const ghost = metadata(22, "Ghost of Tsushima");
  mocks.reverse.mockResolvedValue({
    game: ghost,
    executables: [knownFile("GhostOfTsushima.exe")],
  });
  await scan("playstation", {
    games: [
      game("10000886", "Ghost of Tsushima", {
        playtimeSeconds: 180_000,
        hasPlayedEvidence: true,
        inAccountLibrary: true,
        consoleTitleIds: ["CUSA13323_00"],
      }),
    ],
    resolvedGames: [unmatched("playstation:10000886", [ghost])],
  });
  expect(detailTitle()).toBe("Ghost of Tsushima");

  await click("Import");
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(mocks.run.mock.calls[0][0][0].exeCacheEntries).toEqual([]);
  const [toast] = store.getState().toasts;
  expect(toast?.title).toBe("Ghost of Tsushima imported");
  expect(toast?.detail ?? "").not.toMatch(/game file/i);
});

describe("Needs you", () => {
  const forza5 = metadata(42, "Forza Horizon 5", { releaseYear: 2021 });
  const forza4 = metadata(41, "Forza Horizon 4", { releaseYear: 2018 });

  it("looks up the picked game when it is shown, so Import does not wait for the server", async () => {
    mocks.reverse.mockImplementation(async (_endpoint: string, id: number) => ({
      game: id === forza4.id ? forza4 : forza5,
      executables: [],
    }));
    await scan("xbox", {
      games: [game("1234", "Forza Horizon")],
      resolvedGames: [unmatched("xbox:1234", [forza5, forza4])],
    });
    expect(shelf("attention").open).toBe(true);
    expect(container.textContent).toContain("Which game is “Forza Horizon”?");
    const endpoint = store.getState().settings.apiEndpoint;
    // Shown with the first suggestion picked: the server is asked at once.
    expect(mocks.reverse).toHaveBeenCalledExactlyOnceWith(
      endpoint,
      forza5.id,
      expect.any(AbortSignal),
    );

    const tiles = [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[role="group"][aria-label="Game match for Forza Horizon"] button',
      ),
    ];
    expect(tiles.map((tile) => tile.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
    ]);
    await act(() => tiles[1].click());
    expect(tiles[1].getAttribute("aria-pressed")).toBe("true");
    // Another pick is asked about too.
    expect(mocks.reverse).toHaveBeenCalledTimes(2);
    expect(mocks.reverse).toHaveBeenLastCalledWith(
      endpoint,
      forza4.id,
      expect.any(AbortSignal),
    );
    expect(mocks.run).not.toHaveBeenCalled();

    // The server would not answer again: Import uses what it already said.
    mocks.reverse.mockImplementation(() => new Promise(() => {}));
    await click("Import");
    expect(mocks.reverse).toHaveBeenCalledTimes(2);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        entry: expect.objectContaining({
          provider: "xbox",
          externalId: "1234",
          igdbId: forza4.igdbId,
        }),
      }),
    ]);
    // Done: the decision is gone and the game moved to My Games.
    expect(findButton("Import")).toBeUndefined();
    expect(shelf("imported").count).toBe(1);
  });

  it("asks the server again on Import when the lookup made on showing failed", async () => {
    mocks.reverse.mockRejectedValueOnce(new Error("Server unreachable"));
    mocks.reverse.mockImplementation(async () => ({
      game: forza5,
      executables: [],
    }));
    await scan("xbox", {
      games: [game("1234", "Forza Horizon")],
      resolvedGames: [unmatched("xbox:1234", [forza5])],
    });
    expect(mocks.reverse).toHaveBeenCalledTimes(1);
    // Nobody asked for it yet, so a failure shows nothing.
    expect(container.textContent).not.toContain("Server unreachable");

    await click("Import");
    expect(mocks.reverse).toHaveBeenCalledTimes(2);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(shelf("imported").count).toBe(1);
  });

  it("does not wait for the server on Import after a visit to another page", async () => {
    mocks.reverse.mockImplementation(async () => ({
      game: forza5,
      executables: [],
    }));
    await act(() => store.getState().setActiveView("import"));
    await scan("xbox", {
      games: [game("1234", "Forza Horizon")],
      resolvedGames: [unmatched("xbox:1234", [forza5])],
    });
    expect(mocks.reverse).toHaveBeenCalledTimes(1);

    await act(() => store.getState().setActiveView("games"));
    await act(() => store.getState().setActiveView("import"));
    // The server would not answer again.
    mocks.reverse.mockImplementation(() => new Promise(() => {}));
    await click("Import");
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(shelf("imported").count).toBe(1);
  });
});

// Phil, 2026-11-02: keep clicking Import game after game without looking for
// the button, and no jump back to the top of the list after an import.
describe("deciding one game after another", () => {
  const flightSimulator = metadata(108_603, "Microsoft Flight Simulator");
  const masterChief = metadata(1_255, "Halo: The Master Chief Collection");
  const gears = metadata(103_303, "Gears 5");
  const seaOfThieves = metadata(11_137, "Sea of Thieves");
  const xboxLibrary = {
    games: [
      game("1", "Microsoft Flight Simulator 40th Anniversary Edition"),
      game("2", "Halo: The Master Chief Collection (PC)"),
      game("3", "Gears 5 Game of the Year Edition"),
      game("4", "Sea of Thieves 2024 Edition"),
    ],
    resolvedGames: [
      unmatched("xbox:1", [flightSimulator]),
      unmatched("xbox:2", [masterChief]),
      unmatched("xbox:3", [gears]),
      unmatched("xbox:4", [seaOfThieves]),
    ],
  };

  beforeEach(() => {
    mocks.reverse.mockImplementation(async (_endpoint: string, id: number) => ({
      game: [flightSimulator, masterChief, gears, seaOfThieves].find(
        (item) => item.id === id,
      ),
      executables: [],
    }));
  });

  it("puts Skip for now and Import beside the game's name, above its choices, for every game", async () => {
    await scan("xbox", {
      games: [
        game("1", "Microsoft Flight Simulator 40th Anniversary Edition"),
        // Installed: it asks for the game and for its file.
        game("2", "Halo: The Master Chief Collection (PC)", {
          installed: true,
          installPath: String.raw`C:\XboxGames\Halo MCC\Content`,
          executables: [exe("mcclauncher.exe"), exe("MCC-Win64-Shipping.exe")],
        }),
      ],
      resolvedGames: [
        unmatched("xbox:1", [flightSimulator]),
        unmatched("xbox:2", [masterChief, gears, seaOfThieves]),
      ],
    });
    for (const title of [
      "Microsoft Flight Simulator 40th Anniversary Edition",
      "Halo: The Master Chief Collection (PC)",
    ]) {
      await act(() => row(title).click());
      const top = container.querySelector(
        "section[aria-label]",
      )!.firstElementChild!;
      expect(top.querySelector("h3")?.textContent).toBe(title);
      expect(top.contains(findButton("Skip for now")!)).toBe(true);
      expect(top.contains(findButton("Import")!)).toBe(true);
      // "Which game is …?" and "Which file starts the game?" come below.
      expect(top.querySelector("h4")).toBeNull();
    }
    expect(container.textContent).toContain("Which file starts the game?");
  });

  it("shows the next game that needs you after an import, not the first one in the list", async () => {
    await scan("xbox", xboxLibrary);
    await click("Skip for now");
    expect(detailTitle()).toBe("Halo: The Master Chief Collection (PC)");

    await click("Import");
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(listed()).toEqual([
      "Microsoft Flight Simulator 40th Anniversary Edition",
      "Gears 5 Game of the Year Edition",
      "Sea of Thieves 2024 Edition",
    ]);
    expect(detailTitle()).toBe("Gears 5 Game of the Year Edition");
  });

  it("stays on the game you opened while the import ran", async () => {
    await scan("xbox", xboxLibrary);
    let finishImport!: () => void;
    const importing = new Promise<void>((resolve) => (finishImport = resolve));
    const putInMyGames = mocks.run.getMockImplementation()!;
    mocks.run.mockImplementationOnce(async (...args: unknown[]) => {
      await importing;
      return putInMyGames(...args);
    });

    await click("Import");
    await act(() => row("Sea of Thieves 2024 Edition").click());
    await act(async () => finishImport());
    expect(shelf("imported").count).toBe(1);
    expect(detailTitle()).toBe("Sea of Thieves 2024 Edition");
  });

  it("ignores a click on Import right after an import moved on to the next game", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await scan("xbox", xboxLibrary);
      await click("Import");
      expect(detailTitle()).toBe("Halo: The Master Chief Collection (PC)");

      // A second click as the next game shows up was meant for the one before.
      await click("Import");
      expect(mocks.run).toHaveBeenCalledTimes(1);
      expect(detailTitle()).toBe("Halo: The Master Chief Collection (PC)");

      vi.setSystemTime(Date.now() + 500);
      await click("Import");
      expect(mocks.run).toHaveBeenCalledTimes(2);
      expect(detailTitle()).toBe("Gears 5 Game of the Year Edition");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the file that starts a game", () => {
  it("is preselected when it was linked before", async () => {
    const diablo = metadata(125_165, "Diablo IV");
    await scan(
      "battlenet",
      {
        games: [
          game("fenris", "Diablo IV", {
            playtimeSeconds: null,
            hasPlayedEvidence: false,
            installed: true,
            installPath: String.raw`D:\Games\Diablo IV`,
            executables: [exe("Diablo IV Launcher.exe"), exe("Diablo IV.exe")],
          }),
        ],
        resolvedGames: [matched("battlenet:fenris", diablo)],
      },
      [
        inMyGames("battlenet", "fenris", diablo, {
          providerSeconds: null,
          linkedExeNames: ["Diablo IV.exe"],
        }),
      ],
    );
    expect(shelf("imported").open).toBe(true);
    expect(checkedFile("Diablo IV")).toBe("Diablo IV.exe");
  });

  it("is preselected when the game names it", async () => {
    const halo = metadata(103_281, "Halo Infinite");
    await scan("xbox", {
      games: [
        game("2043073184", "Halo Infinite", {
          installed: true,
          installPath: String.raw`C:\XboxGames\Halo Infinite\Content`,
          executables: [
            exe("HaloInfiniteLauncher.exe"),
            exe("HaloInfinite.exe", { declared: true }),
          ],
        }),
      ],
      resolvedGames: [unmatched("xbox:2043073184", [halo])],
    });
    expect(checkedFile("Halo Infinite")).toBe("HaloInfinite.exe");
    expect(container.textContent).toContain("Named by the game");
  });

  it("is preselected when it is the only one", async () => {
    await scan("steam", {
      games: [
        game("70", "Half-Life", {
          installed: true,
          installPath: String.raw`C:\Steam\steamapps\common\Half-Life`,
          executables: [exe("hl.exe"), exe("unins000.exe")],
        }),
      ],
      resolvedGames: [matched("steam:70", metadata(231, "Half-Life"))],
    });
    expect(checkedFile("Half-Life")).toBe("hl.exe");
  });
});

describe("Already in My Games", () => {
  const hades = metadata(113_112, "Hades");

  it("shows what an import again changes", async () => {
    await scan(
      "steam",
      {
        games: [game("1145360", "Hades", { playtimeSeconds: 770_400 })],
        resolvedGames: [matched("steam:1145360", hades)],
      },
      [inMyGames("steam", "1145360", hades, { providerSeconds: 756_000 })],
    );
    expect(shelf("imported").open).toBe(true);
    expect(container.textContent).toContain("210h 0m → 214h 0m");
    expect(container.textContent).toContain(
      "Already in My Games. Check it in the list to import it again.",
    );
    expect(checkbox("Hades")?.checked).toBe(false);
  });

  it("checks the game when you pick its file, and the import saves the file", async () => {
    await scan(
      "steam",
      {
        games: [
          game("1145360", "Hades", {
            installed: true,
            installPath: String.raw`C:\Steam\steamapps\common\Hades`,
            executables: [exe("Hades.exe"), exe("Hades_Vulkan.exe")],
          }),
        ],
        resolvedGames: [matched("steam:1145360", hades)],
      },
      [inMyGames("steam", "1145360", hades)],
    );
    expect(checkedFile("Hades")).toBeUndefined();
    expect(checkbox("Hades")?.checked).toBe(false);

    await act(() => fileChoice("Hades", "Hades_Vulkan.exe")!.click());
    expect(checkbox("Hades")?.checked).toBe(true);
    expect(container.textContent).toContain("1 update");

    await click("Import 1 game");
    expect(mocks.run).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          entry: expect.objectContaining({
            externalId: "1145360",
            linkedExeNames: ["Hades_Vulkan.exe"],
          }),
        }),
      ],
      expect.any(AbortSignal),
    );
  });
});

it("counts what the import brought and what still needs you", async () => {
  const doom = metadata(7_351, "DOOM");
  await scan(
    "steam",
    {
      games: [
        game("379720", "DOOM"),
        game("782330", "DOOM Eternal"),
        game("2280", "DOOM II"),
        game("2300", "Ultimate Doom", {
          installed: true,
          installPath: String.raw`C:\Steam\steamapps\common\Ultimate Doom`,
          executables: [exe("dosbox.exe"), exe("gzdoom.exe")],
        }),
      ],
      resolvedGames: [
        matched("steam:379720", doom),
        matched("steam:782330", metadata(103_298, "DOOM Eternal")),
        matched("steam:2280", metadata(312, "DOOM II")),
        matched("steam:2300", metadata(1_456, "Ultimate Doom")),
      ],
    },
    [inMyGames("steam", "2280", metadata(312, "DOOM II"))],
  );
  expect(shelf("ready").open).toBe(true);
  expect(container.textContent).toContain("2 games selected");
  expect(container.textContent).toContain("2 new");

  await click("Import 2 games");
  expect(container.querySelector("h2")?.textContent).toBe(
    "2 games imported from Steam",
  );
  expect(container.textContent).toContain("1 game still needs you");
  expect(findButton("Open My Games")).toBeDefined();
  // "Back to the games" read like My Games.
  expect(findButton("Back to the importer")).toBeDefined();
  expect(findButton("Back to the games")).toBeUndefined();

  // Phil, 2026-11-02: "Decide 1 game" became "Review 1 game".
  await click("Review 1 game");
  expect(shelf("attention").open).toBe(true);
  expect(listed()).toEqual(["Ultimate Doom"]);

  // An update of a game in My Games is an import of its own tab.
  await act(() => shelf("imported").tab.click());
  await act(() => checkbox("DOOM II")!.click());
  expect(container.textContent).toContain("1 game selected");
  expect(container.textContent).toContain("1 update");
  await click("Import 1 game");
  expect(container.querySelector("h2")?.textContent).toBe(
    "1 game in My Games updated",
  );
});

// Phil, 2026-11-02: "Needs you" games are imported one by one, so the bar
// with "Import N games" was confusing there; and it imports the open tab only.
describe("the bar at the bottom", () => {
  /** The bar's "Import N games" button. */
  function bulkImport() {
    return [...document.body.querySelectorAll("button")].find((item) =>
      /^Import \d+ games?$/.test(item.textContent?.trim() ?? ""),
    );
  }

  it("shows only on a tab whose games can be checked", async () => {
    await scan(
      "steam",
      {
        games: [
          game("620", "Portal 2"),
          game("2300", "Ultimate Doom", {
            installed: true,
            installPath: String.raw`C:\Steam\steamapps\common\Ultimate Doom`,
            executables: [exe("dosbox.exe"), exe("gzdoom.exe")],
          }),
          game("1145360", "Hades"),
          // Never played: nothing to import.
          game("480", "Spacewar", { playtimeSeconds: 0 }),
        ],
        resolvedGames: [
          matched("steam:620", metadata(72, "Portal 2")),
          matched("steam:2300", metadata(1_456, "Ultimate Doom")),
          matched("steam:1145360", metadata(113_112, "Hades")),
          matched("steam:480", metadata(1_234, "Spacewar")),
        ],
      },
      [inMyGames("steam", "1145360", metadata(113_112, "Hades"))],
    );
    expect(counts()).toEqual({
      ready: 1,
      attention: 1,
      imported: 1,
      unavailable: 1,
    });
    for (const [group, shown] of [
      ["ready", true],
      ["attention", false],
      ["imported", true],
      ["unavailable", false],
    ] as const) {
      await act(() => shelf(group).tab.click());
      expect(Boolean(bulkImport()), group).toBe(shown);
    }
  });

  it("imports the open tab's checked games only, and each tab keeps its checks", async () => {
    await scan(
      "steam",
      {
        games: [
          game("620", "Portal 2"),
          game("400", "Portal"),
          game("1145360", "Hades"),
        ],
        resolvedGames: [
          matched("steam:620", metadata(72, "Portal 2")),
          matched("steam:400", metadata(71, "Portal")),
          matched("steam:1145360", metadata(113_112, "Hades")),
        ],
      },
      [inMyGames("steam", "1145360", metadata(113_112, "Hades"))],
    );
    await act(() => shelf("imported").tab.click());
    await act(() => checkbox("Hades")!.click());
    expect(container.textContent).toContain("1 game selected");

    await act(() => shelf("ready").tab.click());
    expect(container.textContent).toContain("2 games selected");
    await act(() => checkbox("Portal")!.click());
    // A look at another tab undoes nothing.
    await act(() => shelf("imported").tab.click());
    await act(() => shelf("ready").tab.click());
    expect(checkbox("Portal")?.checked).toBe(false);
    expect(checkbox("Portal 2")?.checked).toBe(true);

    await click("Import 1 game");
    const imported = (call: number) =>
      mocks.run.mock.calls[call][0].map(
        ({ entry }: { entry: LibraryImportEntry }) => entry.name,
      );
    expect(imported(0)).toEqual(["Portal 2"]);

    await click("Back to the importer");
    await act(() => shelf("imported").tab.click());
    expect(checkbox("Hades")?.checked).toBe(true);
    await click("Import 1 game");
    expect(imported(1)).toEqual(["Hades"]);
  });
});

it("shows suggestions as covers to click, with the year", async () => {
  const { GameMatchPicker } = await import("./GameMatchPicker");
  const html = renderToStaticMarkup(
    createElement(GameMatchPicker, {
      title: "Forza Horizon 5",
      candidates: [
        metadata(133_430, "Forza Horizon 5", {
          coverUrl: "https://images.example/forza.jpg",
          releaseYear: 2021,
        }),
      ],
      selectedId: 133_430,
      onSelect: () => undefined,
      onResults: () => undefined,
      search: async () => [],
    }),
  );

  expect(html).toContain('src="https://images.example/forza.jpg"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("Forza Horizon 5");
  expect(html).toContain("2021");
  expect(html).not.toContain("Released 2021");
});

describe("the list", () => {
  const twoReady = {
    games: [game("620", "Portal 2"), game("400", "Portal")],
    resolvedGames: [
      matched("steam:620", metadata(72, "Portal 2")),
      matched("steam:400", metadata(71, "Portal")),
    ],
  };

  it("checks and unchecks a game with a double click", async () => {
    await scan("steam", twoReady);
    expect(checkbox("Portal 2")?.checked).toBe(true);

    await act(() =>
      row("Portal 2").dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true }),
      ),
    );
    expect(checkbox("Portal 2")?.checked).toBe(false);
    expect(checkbox("Portal")?.checked).toBe(true);

    await act(() =>
      row("Portal 2").dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true }),
      ),
    );
    expect(checkbox("Portal 2")?.checked).toBe(true);
  });

  it("checks and unchecks the focused game with Space, once per press", async () => {
    await scan("steam", twoReady);

    await act(() => row("Portal").dispatchEvent(key(" ")));
    expect(checkbox("Portal")?.checked).toBe(false);
    // Holding Space down repeats the key: still one change.
    await act(() => row("Portal").dispatchEvent(key(" ", true)));
    expect(checkbox("Portal")?.checked).toBe(false);

    await act(() => row("Portal").dispatchEvent(key(" ")));
    expect(checkbox("Portal")?.checked).toBe(true);
  });

  it("only shows the game on a single click", async () => {
    await scan("steam", twoReady);
    await act(() => row("Portal").click());
    expect(checkbox("Portal")?.checked).toBe(true);
    expect(
      container.querySelector('section[aria-label="Portal"]'),
    ).not.toBeNull();
  });

  it("clears its search with Escape, from the search box or a game", async () => {
    await scan("steam", twoReady);
    const search = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search games"]',
    )!;
    // Without a search, Escape is left to others.
    expect(search.dispatchEvent(key("Escape"))).toBe(true);

    await type(search, "portal 2");
    expect(listed()).toEqual(["Portal 2"]);
    await act(() => search.dispatchEvent(key("Escape")));
    expect(search.value).toBe("");
    expect(listed()).toEqual(["Portal 2", "Portal"]);

    await type(search, "portal 2");
    await act(() => row("Portal 2").dispatchEvent(key("Escape")));
    expect(search.value).toBe("");
    expect(listed()).toEqual(["Portal 2", "Portal"]);
  });
});

describe("the bar above the shelves", () => {
  const twoGames = (provider: BuiltinImportProviderId) => ({
    games: [game("a", "Hades"), game("b", "Celeste")],
    resolvedGames: [
      matched(`${provider}:a`, metadata(113_112, "Hades")),
      matched(`${provider}:b`, metadata(26_226, "Celeste")),
    ],
  });

  it("offers to change what to import next to Scan again, without a game count", async () => {
    await scan("epic", twoGames("epic"));
    const change = findButton("Change what to import");
    expect(change?.nextElementSibling).toBe(findButton("Scan again"));
    expect(container.textContent).not.toContain("games in your account");
    expect(container.textContent).not.toContain("games found");

    await click("Change what to import");
    expect(container.textContent).toContain("What to import");
    expect(findButton("Back to the games")).toBeDefined();
  });

  it.each([
    ["xbox", 1, false],
    ["steam", 1, false],
    ["steam", 2, true],
  ] as const)(
    "offers it on %s with %i local account(s) only when there is a choice: %s",
    async (provider, accounts, offered) => {
      mocks.localAccounts = accounts;
      // Another launcher first, so this one is detected with these accounts.
      await act(() => store.setState({ libraryImportProvider: "epic" }));
      await scan(provider, twoGames(provider));
      expect(findButton("Scan again")).toBeDefined();
      expect(Boolean(findButton("Change what to import"))).toBe(offered);
    },
  );
});

// The case from 2026-11-01: Xbox's "The High lifE" was imported as the wrong
// game. Ids are the server's, so a mix-up of id and IGDB id shows.
const highOnLife = metadata(158_057, "High on Life", {
  igdbId: 204_618,
  releaseYear: 2022,
});
const theHighLife = metadata(164_870, "The High Life", {
  igdbId: 374_657,
  releaseYear: 2016,
});
const anno = metadata(346_930, "Anno 1800: The High Life", {
  igdbId: 165_588,
  releaseYear: 2021,
});

function knownFile(value: string): LibraryKnownExecutable {
  return { platform: "windows", kind: "exe", value, provenance: "igdb", verified: true };
}

/** The covers of "Which game is …?" for the launcher's title. */
function tiles(title: string) {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      `[role="group"][aria-label="Game match for ${title}"] button`,
    ),
  ];
}

function tile(title: string, name: string) {
  const found = tiles(title).find(
    (item) => item.querySelector(".font-semibold")?.textContent === name,
  );
  expect(found, name).toBeDefined();
  return found!;
}

function detailTitle() {
  return container.querySelector("section[aria-label] h3")?.textContent;
}

describe("a game removed from My Games while the review is open", () => {
  it("Xbox: goes back to Needs you with the suggestions, not to Ready to import", async () => {
    await scan(
      "xbox",
      {
        games: [game("1810393564", "The High lifE")],
        resolvedGames: [
          unmatched("xbox:1810393564", [theHighLife, highOnLife]),
        ],
      },
      [inMyGames("xbox", "1810393564", highOnLife)],
    );
    expect(shelf("imported").open).toBe(true);
    expect(listed()).toEqual(["High on Life"]);
    // Already in My Games is fixed in My Games, not here.
    expect(findButton("Wrong game?")).toBeUndefined();

    await act(() =>
      store.getState().removeLibraryImport("xbox", "1810393564"),
    );
    expect(counts()).toMatchObject({ ready: 0, attention: 1, imported: 0 });
    await act(() => shelf("attention").tab.click());
    expect(listed()).toEqual(["The High lifE"]);
    expect(container.textContent).toContain("Which game is “The High lifE”?");
  });

  it("Steam: goes back to Ready to import with the server's game, where you can say it's the wrong one", async () => {
    await scan(
      "steam",
      {
        games: [game("1234560", "The High lifE")],
        resolvedGames: [matched("steam:1234560", highOnLife)],
      },
      [inMyGames("steam", "1234560", highOnLife)],
    );
    await act(() => store.getState().removeLibraryImport("steam", "1234560"));
    expect(counts()).toMatchObject({ ready: 1, imported: 0 });
    await act(() => shelf("ready").tab.click());
    expect(listed()).toEqual(["High on Life"]);
    expect(findButton("Wrong game?")).toBeDefined();
  });

  it("no longer says Imported just now for a game imported in this review", async () => {
    mocks.reverse.mockResolvedValue({ game: theHighLife, executables: [] });
    await scan("xbox", {
      games: [game("1810393564", "The High lifE")],
      resolvedGames: [unmatched("xbox:1810393564", [theHighLife, highOnLife])],
    });
    await click("Import");
    await act(() => shelf("imported").tab.click());
    expect(listed()).toEqual(["The High Life"]);
    expect(container.textContent).toContain("Imported just now");

    await act(() =>
      store.getState().removeLibraryImport("xbox", "1810393564"),
    );
    expect(counts()).toMatchObject({ attention: 1, imported: 0 });
    expect(container.textContent).not.toContain("Imported just now");
  });
});

describe("Wrong game?", () => {
  const epicTitle = "The High lifE";
  const epicLibrary = {
    games: [game("b7e2c41f09d84a6e", epicTitle)],
    resolvedGames: [matched("epic:b7e2c41f09d84a6e", highOnLife)],
  };

  it("sits under the facts of a matched game and opens the picker: the match first, then the search for the launcher's title", async () => {
    mocks.search.mockResolvedValue([anno, theHighLife, highOnLife]);
    await scan("epic", epicLibrary);
    expect(shelf("ready").open).toBe(true);
    expect(container.textContent).not.toContain("Which game is");
    expect(findButton("Wrong game?")?.previousElementSibling?.tagName).toBe(
      "DL",
    );

    await click("Wrong game?");
    expect(container.textContent).toContain(`Which game is “${epicTitle}”?`);
    expect(mocks.search).toHaveBeenCalledExactlyOnceWith(
      store.getState().settings.apiEndpoint,
      epicTitle,
      expect.objectContaining({ mainGamesAndRemastersOnly: false }),
    );
    expect(
      tiles(epicTitle).map(
        (item) => item.querySelector(".font-semibold")?.textContent,
      ),
    ).toEqual(["High on Life", "Anno 1800: The High Life", "The High Life"]);
    const match = tile(epicTitle, "High on Life");
    expect(match.getAttribute("aria-pressed")).toBe("true");
    expect(match.textContent).toContain("Matched");
    expect(tile(epicTitle, "The High Life").textContent).not.toContain(
      "Matched",
    );
    expect(findButton("Wrong game?")).toBeUndefined();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("shows the game you pick and imports it with its known files", async () => {
    mocks.search.mockResolvedValue([anno, theHighLife]);
    mocks.reverse.mockImplementation(async (_endpoint: string, id: number) =>
      id === theHighLife.id
        ? { game: theHighLife, executables: [knownFile("TheHighLife.exe")] }
        : { game: highOnLife, executables: [] },
    );
    await scan("epic", epicLibrary);
    await click("Wrong game?");
    await act(() => tile(epicTitle, "The High Life").click());

    expect(detailTitle()).toBe("The High Life");
    expect(listed()).toEqual(["The High Life"]);
    expect(container.textContent).toContain(
      "Your pick. Epic Games matched High on Life.",
    );
    // Asked as soon as it is picked, so Import does not wait for the server.
    expect(mocks.reverse).toHaveBeenCalledWith(
      store.getState().settings.apiEndpoint,
      theHighLife.id,
      expect.any(AbortSignal),
    );

    await click("Import 1 game");
    expect(mocks.run).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          entry: expect.objectContaining({
            provider: "epic",
            externalId: "b7e2c41f09d84a6e",
            gameId: theHighLife.id,
            igdbId: theHighLife.igdbId,
            name: "The High Life",
            linkedExeNames: ["TheHighLife.exe"],
          }),
          exeCacheEntries: [
            expect.objectContaining({
              exeName: "TheHighLife.exe",
              gameId: theHighLife.id,
              source: "igdb",
            }),
          ],
        }),
      ],
      expect.any(AbortSignal),
    );
  });

  it("imports the other games when the server can't be asked about your pick, which stays checked", async () => {
    mocks.search.mockResolvedValue([theHighLife]);
    // The server does not answer about the picked game, also not on Import.
    mocks.reverse.mockRejectedValue(
      new Error("The game file lookup failed (504)."),
    );
    await scan("steam", {
      games: [game("1234560", "The High lifE"), game("620", "Portal 2")],
      resolvedGames: [
        matched("steam:1234560", highOnLife),
        matched("steam:620", metadata(72, "Portal 2")),
      ],
    });
    await act(() => row("High on Life").click());
    await click("Wrong game?");
    await act(() => tile("The High lifE", "The High Life").click());

    await click("Import 2 games");
    expect(
      mocks.run.mock.calls[0][0].map(
        ({ entry }: { entry: LibraryImportEntry }) => entry.name,
      ),
    ).toEqual(["Portal 2"]);
    expect(container.textContent).toContain(
      "The High Life could not be imported. Please try again.",
    );
    await click("Back to the importer");
    expect(checkbox("The High Life")?.checked).toBe(true);
  });

  it("names your pick when it was the only game to import and the server can't be asked about it", async () => {
    mocks.search.mockResolvedValue([theHighLife]);
    mocks.reverse.mockRejectedValue(
      new Error("The game file lookup failed (504)."),
    );
    await scan("steam", {
      games: [game("1234560", "The High lifE")],
      resolvedGames: [matched("steam:1234560", highOnLife)],
    });
    await click("Wrong game?");
    await act(() => tile("The High lifE", "The High Life").click());

    await click("Import 1 game");
    expect(mocks.run).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "The High Life could not be imported. Please try again.",
    );
    expect(checkbox("The High Life")?.checked).toBe(true);
  });

  it("sends nothing: a file on this PC that only the matched game knows is not handed to your pick", async () => {
    mocks.search.mockResolvedValue([theHighLife]);
    mocks.reverse.mockResolvedValue({ game: theHighLife, executables: [] });
    await scan("epic", {
      games: [
        game("b7e2c41f09d84a6e", epicTitle, {
          installed: true,
          installPath: String.raw`C:\Program Files\Epic Games\TheHighLife`,
          executables: [exe("HighOnLife.exe")],
        }),
      ],
      resolvedGames: [
        matched("epic:b7e2c41f09d84a6e", highOnLife, [
          knownFile("HighOnLife.exe"),
        ]),
      ],
    });
    expect(shelf("ready").open).toBe(true);
    await click("Wrong game?");
    await act(() => tile(epicTitle, "The High Life").click());
    expect(container.textContent).toContain(
      "Your pick is imported instead of the matched game. Nothing is sent.",
    );

    await click("Import 1 game");
    const [commit] = mocks.run.mock.calls[0][0];
    expect(commit.entry).toMatchObject({
      igdbId: theHighLife.igdbId,
      linkedExeNames: [],
    });
    expect(commit.exeCacheEntries).toEqual([]);
    expect(commit.scopedLinks).toEqual([]);
  });

  it("takes your pick back when you click the matched game again", async () => {
    mocks.search.mockResolvedValue([theHighLife]);
    mocks.reverse.mockResolvedValue({ game: theHighLife, executables: [] });
    await scan("epic", epicLibrary);
    await click("Wrong game?");
    await act(() => tile(epicTitle, "The High Life").click());
    await act(() => tile(epicTitle, "High on Life").click());

    expect(detailTitle()).toBe("High on Life");
    expect(container.textContent).not.toContain("Your pick.");
    await click("Import 1 game");
    expect(mocks.run.mock.calls[0][0][0].entry).toMatchObject({
      gameId: highOnLife.id,
      igdbId: highOnLife.igdbId,
    });
  });

  it("is offered on a matched game that only asks for its file, and Import takes your pick with that file", async () => {
    mocks.search.mockResolvedValue([theHighLife]);
    mocks.reverse.mockResolvedValue({ game: theHighLife, executables: [] });
    await scan("steam", {
      games: [
        game("1234560", "The High lifE", {
          installed: true,
          installPath: String.raw`C:\Steam\steamapps\common\TheHighLife`,
          executables: [exe("TheHighLife.exe")],
        }),
      ],
      resolvedGames: [matched("steam:1234560", highOnLife)],
    });
    expect(shelf("attention").open).toBe(true);
    expect(container.textContent).toContain("Which file starts the game?");
    expect(container.textContent).not.toContain("Which game is");

    await click("Wrong game?");
    await act(() => tile("The High lifE", "The High Life").click());
    expect(detailTitle()).toBe("The High Life");
    await click("Import");
    expect(mocks.run.mock.calls[0][0][0].entry).toMatchObject({
      gameId: theHighLife.id,
      igdbId: theHighLife.igdbId,
      linkedExeNames: ["TheHighLife.exe"],
    });
  });
});

describe("a game already in My Games", () => {
  it("keeps the game saved there on Steam too, also when it is imported again", async () => {
    mocks.reverse.mockResolvedValue({ game: theHighLife, executables: [] });
    await scan(
      "steam",
      {
        games: [game("1234560", "The High lifE")],
        resolvedGames: [
          matched("steam:1234560", highOnLife, [knownFile("HighOnLife.exe")]),
        ],
      },
      [inMyGames("steam", "1234560", theHighLife)],
    );
    expect(shelf("imported").open).toBe(true);
    expect(listed()).toEqual(["The High Life"]);

    await act(() => checkbox("The High Life")!.click());
    await click("Import 1 game");
    const [commit] = mocks.run.mock.calls[0][0];
    expect(commit.entry).toMatchObject({
      gameId: theHighLife.id,
      igdbId: theHighLife.igdbId,
      name: "The High Life",
    });
    // The matched game's file is not linked to the saved one.
    expect(commit.exeCacheEntries).toEqual([]);
  });

  it("does not stop the review when the server can't be asked about it", async () => {
    // The saved game was deleted on the server, or the server did not answer.
    mocks.reverse.mockRejectedValue(
      new Error("The game file lookup failed (404)."),
    );
    await scan(
      "steam",
      {
        games: [game("1234560", "The High lifE"), game("620", "Portal 2")],
        resolvedGames: [
          matched("steam:1234560", highOnLife, [knownFile("HighOnLife.exe")]),
          matched("steam:620", metadata(72, "Portal 2")),
        ],
      },
      [inMyGames("steam", "1234560", theHighLife)],
    );
    expect(container.textContent).not.toContain("The game file lookup failed");
    expect(counts()).toMatchObject({ ready: 1, imported: 1 });
    expect(listed()).toEqual(["Portal 2"]);
    await act(() => shelf("imported").tab.click());
    expect(listed()).toEqual(["The High Life"]);
  });
});

// docs/import-accounts-plan.md: each account keeps its own hours of a game,
// the launcher's total is their sum, and D3 for games already in My Games.
describe("launcher accounts", () => {
  const H = 3_600;
  const eldenRing = metadata(119_133, "Elden Ring");
  const PHIL = { key: "a".repeat(32), name: "zesarex" };
  const KID = { key: "b".repeat(32), name: "Kid" };
  const reading = (account: typeof PHIL, hours: number) => ({
    ...account,
    seconds: hours * H,
    readAt: "2026-10-01T12:00:00.000Z",
  });
  const steamEldenRing = (hours: number) =>
    game("1245620", "ELDEN RING", { playtimeSeconds: hours * H });
  const psEldenRing = (hours: number) =>
    game("10000333", "ELDEN RING", {
      playtimeSeconds: hours * H,
      hasPlayedEvidence: true,
      inAccountLibrary: true,
      consoleTitleIds: ["PPSA04609_00"],
    });
  const firstCommit = () => mocks.run.mock.calls[0][0][0];

  it("an import keeps the account the scan read, and whole totals when only the file search ran out of time", async () => {
    await scan("steam", {
      games: [steamEldenRing(100)],
      resolvedGames: [matched("steam:1245620", eldenRing)],
      account: PHIL,
      partial: true,
    });
    await click("Import 1 game");
    expect(firstCommit().entry.accounts).toMatchObject([
      { ...PHIL, seconds: 100 * H },
    ]);
    expect(firstCommit().partialRead).toBeFalsy();
  });

  it("playstation: a list Sony cut short imports as a partial read", async () => {
    await scan("playstation", {
      games: [psEldenRing(12)],
      resolvedGames: [matched("playstation:10000333", eldenRing)],
      account: KID,
      totalsCutShort: true,
    });
    await click("Import 1 game");
    expect(firstCommit()).toMatchObject({
      partialRead: true,
      entry: { accounts: [{ ...KID, seconds: 12 * H }] },
    });
  });

  it("playstation: a game imported on its own keeps the account and the partial read too", async () => {
    const ghost = metadata(22, "Ghost of Tsushima");
    mocks.reverse.mockResolvedValue({ game: ghost, executables: [] });
    await scan("playstation", {
      games: [
        game("10000886", "Ghost of Tsushima", {
          playtimeSeconds: 50 * H,
          hasPlayedEvidence: true,
          inAccountLibrary: true,
        }),
      ],
      resolvedGames: [unmatched("playstation:10000886", [ghost])],
      account: KID,
      totalsCutShort: true,
    });
    await click("Import");
    expect(firstCommit()).toMatchObject({
      partialRead: true,
      entry: { accounts: [{ ...KID, seconds: 50 * H }] },
    });
  });

  it.each([
    {
      when: "another account",
      saved: { providerSeconds: 100 * H, accounts: [reading(PHIL, 100)] },
      growth: "100h 0m → 120h 0m",
    },
    {
      // D1: an account with fewer hours than the import from before is
      // another account.
      when: "an import from before accounts",
      saved: { providerSeconds: 120 * H },
      growth: "120h 0m → 220h 0m",
    },
  ])(
    "D3: a game in My Games starts checked when an account brings hours it doesn't hold yet ($when), and shows the total before → after",
    async ({ saved, growth }) => {
      const hours = saved.accounts ? 20 : 100;
      await scan(
        "steam",
        {
          games: [steamEldenRing(hours)],
          resolvedGames: [matched("steam:1245620", eldenRing)],
          account: KID,
        },
        [inMyGames("steam", "1245620", eldenRing, saved)],
      );
      expect(shelf("imported").open).toBe(true);
      expect(checkbox("Elden Ring")?.checked).toBe(true);
      expect(container.textContent).toContain(growth);

      await click("Import 1 game");
      expect(firstCommit().entry.accounts).toMatchObject([
        { ...KID, seconds: hours * H },
      ]);
    },
  );

  it.each([
    {
      when: "its own hours",
      saved: { providerSeconds: 100 * H, accounts: [reading(PHIL, 100)] },
    },
    {
      // D1: at least as many hours as the import from before: they were its.
      when: "an import from before accounts",
      saved: { providerSeconds: 100 * H },
    },
  ])(
    "D3: the same account read again leaves the game unchecked, as before ($when)",
    async ({ saved }) => {
      await scan(
        "steam",
        {
          games: [steamEldenRing(105)],
          resolvedGames: [matched("steam:1245620", eldenRing)],
          account: PHIL,
        },
        [inMyGames("steam", "1245620", eldenRing, saved)],
      );
      expect(checkbox("Elden Ring")?.checked).toBe(false);
      expect(container.textContent).toContain("100h 0m → 105h 0m");
    },
  );

  it("a read without an account shows no growth for a game with accounts", async () => {
    await scan(
      "steam",
      {
        games: [steamEldenRing(130)],
        resolvedGames: [matched("steam:1245620", eldenRing)],
      },
      [
        inMyGames("steam", "1245620", eldenRing, {
          providerSeconds: 120 * H,
          accounts: [reading(PHIL, 100), reading(KID, 20)],
        }),
      ],
    );
    expect(checkbox("Elden Ring")?.checked).toBe(false);
    expect(container.textContent).not.toContain("→");
  });
});
