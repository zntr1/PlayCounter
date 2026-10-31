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
  result: Omit<LibraryScanResult, "warnings" | "partial">,
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
  mocks.run.mockResolvedValue({ shareOutcomes: [] });
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
  await act(() => shelf("imported").tab.click());
  await act(() => checkbox("DOOM II")!.click());
  expect(container.textContent).toContain("3 games selected");
  expect(container.textContent).toContain("2 new");
  expect(container.textContent).toContain("1 update");

  await click("Import 3 games");
  expect(container.querySelector("h2")?.textContent).toBe(
    "2 games imported from Steam",
  );
  expect(container.textContent).toContain("1 game in My Games updated");
  expect(container.textContent).toContain("1 game still needs you");
  expect(findButton("Open My Games")).toBeDefined();

  await click("Decide 1 game");
  expect(shelf("attention").open).toBe(true);
  expect(listed()).toEqual(["Ultimate Doom"]);
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
