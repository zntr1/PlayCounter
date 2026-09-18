// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryScanResult } from "../../library/types";

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  lookup: vi.fn(),
  reverse: vi.fn(),
  search: vi.fn(),
  run: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (v: string) => v,
}));
vi.mock("../../library/providers", () => ({
  loadLibraryProvider: async (provider: string) => ({
    accountMode: provider === "battlenet" ? "none" : undefined,
    detect: async () => ({ provider, available: true, checkedPaths: [] }),
    listAccounts: async () =>
      provider === "battlenet"
        ? []
        : [{ accountId: 1, mostRecent: true, gamesWithPlaytime: 1 }],
    scan: mocks.scan,
  }),
}));
vi.mock("../../library/resolve", () => ({ resolveLibraryGames: mocks.lookup }));
vi.mock("../../library/gameLookup", () => ({
  reverseResolveLibraryGame: mocks.reverse,
  searchLibraryGames: mocks.search,
}));
vi.mock("../../library/importRun", () => ({ runLibraryImport: mocks.run }));

let root: Root;
let container: HTMLDivElement;
let store: typeof import("../../store").useAppStore;
let View: typeof import("./ImportLibraryView").ImportLibraryView;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function scanResult(name: string): LibraryScanResult {
  return {
    games: [
      {
        externalId: "42",
        name,
        playtimeSeconds: 3600,
        installed: false,
        executables: [],
      },
    ],
    warnings: [],
    partial: false,
    resolvedGames: [
      {
        key: "steam:42",
        status: "resolved",
        game: { id: 42, igdbId: 42, name, coverUrl: "", source: "igdb" },
        executables: [],
      },
    ],
  };
}

async function click(label: string) {
  const button = [...document.body.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === label,
  );
  expect(button, label).toBeDefined();
  await act(() => button!.click());
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ({ useAppStore: store } = await import("../../store"));
  ({ ImportLibraryView: View } = await import("./ImportLibraryView"));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(createElement(View)));
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("opening the importer only detects local accounts and does not start API lookups", () => {
  expect(mocks.scan).not.toHaveBeenCalled();
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(mocks.reverse).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each([
  ["Find installed games", false],
  ["Sign in and find games", true],
] as const)(
  "requires OK before a Battle.net scan starts via %s",
  async (label, account) => {
    await act(() => store.setState({ libraryImportProvider: "battlenet" }));
    mocks.scan.mockResolvedValue({
      games: [],
      resolvedGames: [],
      warnings: [],
      partial: false,
    });
    await click(label);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Adjust total playtime");
    expect(dialog?.textContent).toContain("/played");
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
    await click("OK");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.scan).toHaveBeenCalledExactlyOnceWith(
      0,
      expect.objectContaining({ battleNetAccount: account }),
    );
    await click(label);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(mocks.scan).toHaveBeenCalledTimes(1);
    await click("Cancel");
    expect(mocks.scan).toHaveBeenCalledTimes(1);
  },
);

it.each(["Cancel", "Close", "Escape"])(
  "does not scan when the Battle.net notice is dismissed with %s",
  async (dismiss) => {
    await act(() => store.setState({ libraryImportProvider: "battlenet" }));
    await click("Sign in and find games");
    if (dismiss === "Cancel") {
      await click("Cancel");
    } else {
      await act(() => {
        if (dismiss === "Close")
          document
            .querySelector<HTMLButtonElement>(
              '[role="dialog"] button[aria-label="Close"]',
            )!
            .click();
        else
          document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          );
      });
    }
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  },
);

it("clears a pending Battle.net notice when the provider changes", async () => {
  await act(() => store.setState({ libraryImportProvider: "battlenet" }));
  await click("Find installed games");
  await act(() => store.setState({ libraryImportProvider: "steam" }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(() => store.setState({ libraryImportProvider: "battlenet" }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.scan).not.toHaveBeenCalled();
});

it.each([false, true])(
  "imports an uninstalled Battle.net account game after review (manual=%s)",
  async (manual) => {
    await act(() => store.setState({ libraryImportProvider: "battlenet" }));
    expect(mocks.scan).not.toHaveBeenCalled();
    const result = scanResult("Account game");
    const match = result.resolvedGames![0].game!;
    result.games[0] = {
      externalId: "example",
      name: "Account game",
      playtimeSeconds: null,
      hasPlayedEvidence: false,
      inAccountLibrary: true,
      installed: false,
      executables: [],
    };
    result.resolvedGames = [
      {
        key: "battlenet:example",
        status: manual ? "unknown" : "resolved",
        game: manual ? undefined : match,
        candidates: [match],
        executables: [],
      },
    ];
    mocks.scan.mockResolvedValue(result);
    mocks.reverse.mockResolvedValue({
      game: match,
      executables: [
        {
          platform: "windows",
          kind: "exe",
          value: "Example.exe",
          provenance: "igdb",
          verified: true,
        },
      ],
    });
    mocks.run.mockResolvedValue({ shareOutcomes: [] });
    await click("Sign in and find games");
    await click("OK");
    expect(mocks.scan).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ battleNetAccount: true }),
    );
    expect(container.textContent).toContain("Not installed");
    expect(
      container.querySelector('select[aria-label^="Game file"]'),
    ).toBeNull();
    expect(mocks.run).not.toHaveBeenCalled();
    await click(manual ? "Confirm and Import" : "Import 1");
    expect(mocks.run).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          entry: expect.objectContaining({
            provider: "battlenet",
            providerSeconds: null,
            providerHasPlayedEvidence: false,
            linkedExeNames: [],
          }),
          exeCacheEntries: [],
          scopedLinks: [],
          install: undefined,
        }),
      ],
      expect.any(AbortSignal),
    );
    expect(container.textContent).not.toContain("Pick the game file to track");
    if (manual)
      expect(store.getState().toasts[0].detail).toContain(
        "After installing it",
      );
  },
);

it("cancels Battle.net sign-in on provider switch and does not apply late account results", async () => {
  await act(() => store.setState({ libraryImportProvider: "battlenet" }));
  const pending = deferred<LibraryScanResult>();
  mocks.scan.mockReturnValue(pending.promise);
  await click("Sign in and find games");
  await click("OK");
  expect(container.textContent).toContain("Complete Battle.net sign-in");
  const signal = mocks.scan.mock.calls[0][1].signal as AbortSignal;
  await act(() => store.setState({ libraryImportProvider: "steam" }));
  expect(signal.aborted).toBe(true);
  await act(() => pending.resolve(scanResult("Previous account game")));
  expect(container.textContent).not.toContain("Previous account game");
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each(["steam", "xbox", "battlenet"] as const)(
  "preselects the only eligible %s game file and imports it only after confirmation",
  async (provider) => {
    await act(() => store.setState({ libraryImportProvider: provider }));
    const result = scanResult("Example Game");
    const matchedGame = result.resolvedGames![0].game!;
    result.games[0] = {
      ...result.games[0],
      externalId: provider === "battlenet" ? "example" : "42",
      playtimeSeconds: provider === "battlenet" ? null : 3600,
      hasPlayedEvidence: provider === "battlenet" ? false : undefined,
      installed: true,
      installPath: String.raw`C:\Games\Example`,
      executables: [
        {
          fileName: "Example.exe",
          relativePath: String.raw`bin\Example.exe`,
          sizeBytes: 1_000_000,
          depth: 1,
        },
        {
          fileName: "uninstall.exe",
          relativePath: "uninstall.exe",
          sizeBytes: 1_000_000,
          depth: 0,
        },
      ],
    };
    result.resolvedGames = [
      provider === "xbox"
        ? {
            key: "xbox:42",
            status: "unknown",
            executables: [],
            candidates: [matchedGame],
          }
        : {
            ...result.resolvedGames![0],
            key: provider === "battlenet" ? "battlenet:example" : "steam:42",
          },
    ];
    mocks.scan.mockResolvedValue(result);
    mocks.reverse.mockResolvedValue({ game: matchedGame, executables: [] });
    mocks.run.mockResolvedValue({
      shareOutcomes: [{ outcome: { kind: "submitted" } }],
    });

    await click(
      provider === "xbox"
        ? "Sign in and find games"
        : provider === "battlenet"
          ? "Find installed games"
          : "Find games",
    );
    if (provider === "battlenet") await click("OK");
    const picker = container.querySelector<HTMLSelectElement>(
      'select[aria-label="Game file for Example Game"]',
    );
    expect(picker?.value).toBe(String.raw`bin\Example.exe`);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(store.getState().libraryImports.size).toBe(0);

    await click(provider === "xbox" ? "Confirm and Import" : "Add and Share");
    expect(mocks.run).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          entry: expect.objectContaining({
            provider,
            linkedExeNames: ["Example.exe"],
          }),
        }),
      ],
      expect.any(AbortSignal),
    );
    if (provider === "battlenet") {
      expect(store.getState().toasts[0].detail).toContain(
        "sent to the community for review",
      );
    }
  },
);

it("leaves multiple eligible game files for the user to choose", async () => {
  const result = scanResult("Example Game");
  result.games[0] = {
    ...result.games[0],
    installed: true,
    installPath: String.raw`C:\Games\Example`,
    executables: ["Example.exe", "ExampleDX12.exe"].map((fileName) => ({
      fileName,
      relativePath: fileName,
      sizeBytes: 1_000_000,
      depth: 0,
    })),
  };
  mocks.scan.mockResolvedValue(result);
  await click("Find games");
  expect(
    container.querySelector<HTMLSelectElement>(
      'select[aria-label="Game file for Example Game"]',
    )?.value,
  ).toBe("");
  const addButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Add and Share",
  );
  expect(addButton?.disabled).toBe(true);
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each(["xbox", "battlenet"] as const)(
  "keeps %s search filtering and executable linking separate during manual matching",
  async (provider) => {
    await act(() => store.setState({ libraryImportProvider: provider }));
    const result = scanResult("Example Game");
    const matchedGame = result.resolvedGames![0].game!;
    const externalId = provider === "battlenet" ? "example" : "42";
    result.games[0] = {
      ...result.games[0],
      externalId,
      playtimeSeconds: null,
      hasPlayedEvidence: provider === "battlenet" ? false : undefined,
      installed: true,
      installPath: String.raw`C:\Games\Example`,
      executables: [
        {
          fileName: "Example.exe",
          relativePath: "Example.exe",
          sizeBytes: 1_000_000,
          depth: 0,
        },
      ],
    };
    result.resolvedGames = [
      {
        key: `${provider}:${externalId}`,
        status: "unknown",
        executables: [],
        candidates: [],
      },
    ];
    mocks.scan.mockResolvedValue(result);
    mocks.search.mockResolvedValue([matchedGame]);
    mocks.reverse.mockResolvedValue({ game: matchedGame, executables: [] });
    mocks.run.mockResolvedValue({
      shareOutcomes: [{ outcome: { kind: "failed" } }],
    });

    await click(
      provider === "xbox" ? "Sign in and find games" : "Find installed games",
    );
    if (provider === "battlenet") await click("OK");
    await click("Search IGDB");
    expect(mocks.search).toHaveBeenCalledWith(
      store.getState().settings.apiEndpoint,
      "Example Game",
      {
        signal: expect.any(AbortSignal),
        mainGamesAndRemastersOnly: provider === "xbox",
      },
    );
    expect(mocks.run).not.toHaveBeenCalled();
    await click("Confirm and Import");
    expect(mocks.reverse).toHaveBeenCalledWith(
      store.getState().settings.apiEndpoint,
      matchedGame.id,
      expect.any(AbortSignal),
    );
    const plan = mocks.run.mock.calls[0][0][0];
    expect(plan.entry).toMatchObject({
      provider,
      externalId,
      providerSeconds: null,
      linkedExeNames: ["Example.exe"],
    });
    if (provider === "battlenet") {
      expect(store.getState().toasts[0].detail).toContain(
        "could not be verified or shared",
      );
      expect(plan.exeCacheEntries).toEqual([]);
      expect(plan.scopedLinks).toEqual([
        expect.objectContaining({
          provider: "battlenet",
          pathPrefix: "c:\\games\\example",
        }),
      ]);
    }
  },
);

it.each([false, true])(
  "only removes missing Battle.net install status after a complete scan (partial=%s)",
  async (partial) => {
    await act(() =>
      store.setState({
        libraryImportProvider: "battlenet",
        libraryInstalls: new Map([
          [
            "battlenet:wow",
            {
              provider: "battlenet",
              externalId: "wow",
              installPath: "C:\\Games\\WoW",
              scannedAt: "2026-09-17T12:00:00Z",
            },
          ],
        ]),
      }),
    );
    mocks.scan.mockResolvedValue({
      games: [],
      resolvedGames: [],
      warnings: partial ? ["Try again"] : [],
      partial,
    });
    await click("Find installed games");
    await click("OK");
    expect(store.getState().libraryInstalls.has("battlenet:wow")).toBe(partial);
    expect(mocks.run).not.toHaveBeenCalled();
  },
);

it("shows automatic cooldown recovery during a Steam lookup and still allows cancellation", async () => {
  const lookup = deferred<unknown>();
  mocks.scan.mockResolvedValue({
    ...scanResult("Delayed game"),
    resolvedGames: undefined,
  });
  mocks.lookup.mockImplementation(
    (_endpoint, _provider, _games, _signal, onWait) => {
      onWait(true);
      return lookup.promise;
    },
  );
  await click("Find games");
  expect(container.textContent).toContain(
    "Your import will continue automatically",
  );
  const signal = mocks.lookup.mock.calls[0][3] as AbortSignal;
  const onWait = mocks.lookup.mock.calls[0][4] as (waiting: boolean) => void;
  await click("Cancel import");
  expect(signal.aborted).toBe(true);
  await act(() => {
    onWait(true);
    lookup.resolve({ capability: "supported", games: [] });
  });
  expect(container.textContent).not.toContain(
    "Your import will continue automatically",
  );
  expect(mocks.run).not.toHaveBeenCalled();
});

it("ignores late native scan results after cancellation and a new scan", async () => {
  const old = deferred<LibraryScanResult>();
  mocks.scan
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(scanResult("New game"));
  await click("Find games");
  const signal = mocks.scan.mock.calls[0][1].signal as AbortSignal;
  await click("Cancel import");
  expect(signal.aborted).toBe(true);
  await click("Find games");
  expect(container.textContent).toContain("New game");
  await act(() => old.resolve(scanResult("Old game")));
  expect(container.textContent).not.toContain("Old game");
  expect(container.textContent).toContain("New game");
});

it.each([false, true])(
  "ignores a late lookup result or error after cancellation (reject=%s)",
  async (reject) => {
    const lookup = deferred<unknown>();
    mocks.scan.mockResolvedValue({
      ...scanResult("Old game"),
      resolvedGames: undefined,
    });
    mocks.lookup.mockReturnValue(lookup.promise);
    await click("Find games");
    const signal = mocks.lookup.mock.calls[0][3] as AbortSignal;
    await click("Cancel import");
    expect(signal.aborted).toBe(true);
    await act(() =>
      reject
        ? lookup.reject(new Error("Late failure"))
        : lookup.resolve({
            capability: "supported",
            games: scanResult("Old game").resolvedGames,
          }),
    );
    expect(container.textContent).not.toContain("Old game");
    expect(container.textContent).not.toContain("Late failure");
    expect(container.textContent).toContain("Find games");
  },
);

it("does not commit when the view is left during the safety backup", async () => {
  mocks.scan.mockResolvedValue(scanResult("Game"));
  const backup = deferred<unknown>();
  mocks.invoke.mockReturnValue(backup.promise);
  await click("Find games");
  await click("Import 1");
  expect(mocks.invoke).toHaveBeenCalledWith(
    "backup_local_data",
    expect.anything(),
  );
  await act(() => root.render(null));
  await act(() => backup.resolve(undefined));
  expect(mocks.run).not.toHaveBeenCalled();
});

it("does not commit an Xbox confirmation after switching providers", async () => {
  await act(() => store.setState({ libraryImportProvider: "xbox" }));
  const result = scanResult("Xbox game");
  mocks.scan.mockResolvedValue({
    ...result,
    resolvedGames: [
      {
        key: "xbox:42",
        status: "unknown",
        executables: [],
        candidates: [result.resolvedGames![0].game],
      },
    ],
  });
  const reverse = deferred<unknown>();
  mocks.reverse.mockReturnValue(reverse.promise);
  await click("Sign in and find games");
  await click("Confirm and Import");
  const signal = mocks.reverse.mock.calls[0][2] as AbortSignal;
  await act(() => store.setState({ libraryImportProvider: "steam" }));
  expect(signal.aborted).toBe(true);
  await act(() =>
    reverse.resolve({ game: result.resolvedGames![0].game, executables: [] }),
  );
  expect(mocks.run).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
