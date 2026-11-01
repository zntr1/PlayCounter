// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LibraryScanOptions } from "../../library/provider";
import type { LibraryScanResult } from "../../library/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  scan: vi.fn(),
  lookup: vi.fn(),
  logins: [] as { service: string; name: string | null; savedAt: number }[],
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
        : [{ accountId: 1, mostRecent: true, gamesWithPlaytime: 1 }],
    scan: mocks.scan,
  }),
}));
vi.mock("../../library/resolve", () => ({ resolveLibraryGames: mocks.lookup }));

type Launcher = "steam" | "xbox" | "epic" | "battlenet";

let root: Root;
let container: HTMLDivElement;
let options: LibraryScanOptions;
let finishScan: (result: LibraryScanResult) => void;
let serverWait: (waiting: boolean) => void;

const oneGame: LibraryScanResult = {
  games: [
    {
      externalId: "1",
      name: "Example Game",
      playtimeSeconds: 3_600,
      installed: false,
      executables: [],
    },
  ],
  warnings: [],
  partial: false,
};

/** The text under PlayCounter's loader. */
function label() {
  return container.querySelector(".pc-loader__label")?.textContent;
}

function buttons() {
  return [...container.querySelectorAll("button")].map(
    (button) => button.textContent?.trim() ?? "",
  );
}

async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  expect(button, text).toBeDefined();
  await act(() => button!.click());
}

async function choose(text: string) {
  const input = [...container.querySelectorAll("label")]
    .find((item) => item.textContent?.includes(text))
    ?.querySelector("input");
  expect(input, text).toBeDefined();
  await act(() => input!.click());
}

async function open(provider: Launcher) {
  const { useAppStore } = await import("../../store");
  const { ImportLibraryView } = await import("./ImportLibraryView");
  await act(() =>
    useAppStore.setState({
      libraryImportProvider: provider,
      // The Battle.net pop-up has its own tests.
      battleNetPlaytimeNoticeSeen: true,
    }),
  );
  await act(() => root.render(createElement(ImportLibraryView)));
  await act(async () => {});
}

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", {
    ...navigator,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    platform: "Win32",
  });
  mocks.logins = [];
  // Loaded before the test, so a busy test run does not time it out.
  await import("./ImportLibraryView");
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "logins_list" ? mocks.logins : undefined,
  );
  mocks.scan.mockImplementation(
    (_accountId: number, scanOptions: LibraryScanOptions) => {
      options = scanOptions;
      return new Promise<LibraryScanResult>((resolve) => {
        finishScan = resolve;
      });
    },
  );
  mocks.lookup.mockImplementation(
    (
      _endpoint: string,
      _provider: string,
      _games: unknown,
      _signal: AbortSignal,
      onWait: (waiting: boolean) => void,
    ) => {
      serverWait = onWait;
      return new Promise(() => {});
    },
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("names the Steam scan, then the matching, then a busy server", async () => {
  await open("steam");
  await click("Find games");
  expect(label()).toBe("Scanning your Steam library…");

  await act(() => finishScan(oneGame));
  expect(label()).toBe("Matching your games…");

  await act(() => serverWait(true));
  expect(label()).toBe(
    "The server is busy. Your import will continue automatically…",
  );
});

it("names each Xbox step, and keeps the sign-in link while the browser waits", async () => {
  await open("xbox");
  await click("Sign in and find games");
  expect(label()).toBe("Connecting to Xbox…");

  await act(() => options.onAuthorizeUrl?.("https://login.live.com/example"));
  expect(label()).toBe("Waiting for Microsoft sign-in…");
  expect(buttons()).toContain("Copy sign-in link");

  await act(() => options.onXboxProgress?.("history"));
  expect(label()).toBe("Reading your Xbox history…");
  expect(buttons()).not.toContain("Copy sign-in link");

  await act(() => finishScan(oneGame));
  expect(label()).toBe("Matching your games…");
});

it.each([
  ["epic", "Epic Games"],
  ["battlenet", "Battle.net"],
] as const)(
  "names the %s sign-in window until the account is read, then the installs",
  async (provider, name) => {
    await open(provider);
    await click("Sign in and find games");
    const signIn = `Complete the ${name} sign-in in the window that opened…`;
    expect(label()).toBe(signIn);

    // Signing in and reading the account are one call.
    await act(() => options.onStage?.("account"));
    expect(label()).toBe(signIn);

    await act(() => options.onStage?.("installs"));
    expect(label()).toBe(`Looking for ${name} games on this PC…`);

    await act(() => finishScan(oneGame));
    expect(label()).toBe("Matching your games…");
  },
);

it("reads an Epic account at once when its sign-in is kept", async () => {
  mocks.logins = [{ service: "epic", name: "Player One", savedAt: 1 }];
  await open("epic");
  await click("Find games");
  expect(label()).toBe("Reading your Epic Games library…");

  await act(() => options.onStage?.("account"));
  expect(label()).toBe("Reading your Epic Games library…");

  await act(() => options.onStage?.("installs"));
  expect(label()).toBe("Looking for Epic Games games on this PC…");
});

it.each([
  ["epic", "Epic Games"],
  ["battlenet", "Battle.net"],
] as const)(
  "goes straight to this PC when %s imports only installed games",
  async (provider, name) => {
    await open(provider);
    await choose("Only installed games");
    await click("Find games");
    expect(label()).toBe(`Looking for ${name} games on this PC…`);
  },
);
