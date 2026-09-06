// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryScanResult } from "../../library/types";

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  lookup: vi.fn(),
  reverse: vi.fn(),
  run: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (v: string) => v,
}));
vi.mock("../../library/providers", () => ({
  loadLibraryProvider: async (provider: string) => ({
    detect: async () => ({ provider, available: true, checkedPaths: [] }),
    listAccounts: async () => [
      { accountId: 1, mostRecent: true, gamesWithPlaytime: 1 },
    ],
    scan: mocks.scan,
  }),
}));
vi.mock("../../library/resolve", () => ({ resolveLibraryGames: mocks.lookup }));
vi.mock("../../library/providers/xbox", () => ({
  reverseResolveXboxGame: mocks.reverse,
  searchXboxGames: vi.fn(),
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
  const button = [...container.querySelectorAll("button")].find(
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
