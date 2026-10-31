// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  available: true,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: (v: string) => v,
}));
vi.mock("../../library/providers", () => ({
  loadLibraryProvider: async (provider: string) => ({
    accountMode:
      provider === "epic" || provider === "battlenet" ? "none" : undefined,
    detect: async () => ({
      provider,
      available: mocks.available,
      checkedPaths: [],
    }),
    listAccounts: async () =>
      provider === "steam"
        ? [
            {
              accountId: 7,
              personaName: "Phil",
              mostRecent: true,
              gamesWithPlaytime: 142,
            },
          ]
        : provider === "xbox"
          ? [{ accountId: 0, mostRecent: true, gamesWithPlaytime: 0 }]
          : [],
    scan: vi.fn(),
  }),
}));

type Launcher = "steam" | "xbox" | "epic" | "battlenet";

let root: Root;
let container: HTMLDivElement;

function text() {
  return container.textContent ?? "";
}

function buttons() {
  return [...container.querySelectorAll("button")].map(
    (button) => button.textContent?.trim() ?? "",
  );
}

function findButton(label: string) {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

function mainButtons() {
  return buttons().filter(
    (label) => label === "Find games" || label === "Sign in and find games",
  );
}

/** The choices under "What to import", by their title. */
function choices() {
  const fieldset = [...container.querySelectorAll("fieldset")].find(
    (item) => item.querySelector("legend")?.textContent === "What to import",
  );
  expect(fieldset).toBeDefined();
  return [...fieldset!.querySelectorAll(".font-semibold")]
    .filter((title) => title.tagName !== "LEGEND")
    .map((title) => title.textContent);
}

async function choose(label: string) {
  const input = [...container.querySelectorAll("label")]
    .find((item) => item.textContent?.includes(label))
    ?.querySelector("input");
  expect(input, label).toBeDefined();
  await act(() => input!.click());
}

async function open(provider: Launcher) {
  const { useAppStore } = await import("../../store");
  const { ImportLibraryView } = await import("./ImportLibraryView");
  await act(() => useAppStore.setState({ libraryImportProvider: provider }));
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
  mocks.available = true;
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "logins_list" ? [] : undefined,
  );
  // Loaded before the test, so a busy test run does not time it out.
  await import("./ImportLibraryView");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the launcher card", () => {
  it.each([
    {
      provider: "steam",
      name: "Steam",
      account: "Steam account: Phil",
      choices: ["Phil"],
      note: "Your game list stays on this PC.",
      button: "Find games",
    },
    {
      provider: "xbox",
      name: "Xbox",
      account: "Not signed in",
      choices: ["Your Xbox account"],
      note: "Use the Microsoft account that belongs to your Xbox gamertag.",
      button: "Sign in and find games",
    },
    {
      provider: "epic",
      name: "Epic Games",
      account: "Not signed in",
      choices: ["Your Epic Games account", "Only installed games"],
      note: "Sign-in opens in a separate Epic Games window.",
      button: "Sign in and find games",
    },
    {
      provider: "battlenet",
      name: "Battle.net",
      account: "Not signed in",
      choices: ["Your Battle.net account", "Only installed games"],
      note: "Sign-in opens in a separate Battle.net window.",
      button: "Sign in and find games",
    },
  ] as const)(
    "has the same parts on $name: account line, what to import, one note, one button",
    async (launcher) => {
      await open(launcher.provider);

      expect(container.querySelector("h2")?.textContent).toBe(launcher.name);
      expect(text()).toContain(launcher.account);
      expect(choices()).toEqual(launcher.choices);
      expect(text()).toContain(launcher.note);
      expect(mainButtons()).toEqual([launcher.button]);
      // One launcher per visit: no buttons for the others.
      for (const other of ["Steam", "Xbox", "Epic Games", "Battle.net"]) {
        expect(buttons()).not.toContain(other);
      }
    },
  );

  it.each([
    ["epic", "Your Epic Games account"],
    ["battlenet", "Your Battle.net account"],
  ] as const)(
    "asks %s to sign in only for the account, not for installed games",
    async (provider, account) => {
      await open(provider);
      expect(mainButtons()).toEqual(["Sign in and find games"]);

      await choose("Only installed games");
      expect(mainButtons()).toEqual(["Find games"]);

      await choose(account);
      expect(mainButtons()).toEqual(["Sign in and find games"]);
    },
  );

  it("offers Xbox's sign-in link only while there is no sign-in", async () => {
    await open("xbox");
    expect(buttons()).toContain("Copy sign-in link");
  });

  it("says when the launcher is not on this PC, and offers no scan", async () => {
    mocks.available = false;
    await open("epic");

    expect(container.querySelector("h2")?.textContent).toBe("Epic Games");
    expect(text()).toContain("Epic Games was not found");
    expect(text()).toContain("Epic Games import is available on Windows.");
    expect(findButton("Find games")?.disabled ?? true).toBe(true);
    expect(findButton("Sign in and find games")?.disabled ?? true).toBe(true);
  });
});
