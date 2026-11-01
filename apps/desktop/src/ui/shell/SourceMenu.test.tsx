// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Platform } from "@playcounter/shared";
import type { LibraryImportEntry } from "../../library/types";
import { useAppStore } from "../../store";
import { useLibrarySources } from "../librarySources";
import { LibraryTestShell } from "../views/libraryTestShell";

const mocks = vi.hoisted(() => ({ platform: "windows" as Platform }));
vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => mocks.platform }));

const steam: LibraryImportEntry = {
  provider: "steam",
  externalId: "100",
  gameId: 1,
  igdbId: 100,
  source: "igdb",
  name: "Steam game",
  coverUrl: "",
  importedAt: "2026-10-31T12:00:00Z",
  lastReadAt: "2026-10-31T12:00:00Z",
  providerSeconds: 0,
  linkedExeNames: [],
  linkedExeSources: [],
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  mocks.platform = "windows";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useLibrarySources.setState(useLibrarySources.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: false,
    },
    libraryImports: new Map([["steam:100", steam]]),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function rightClick(tab: string) {
  const row = container.querySelector(`#library-tab-${tab}`);
  expect(row, `missing sidebar row ${tab}`).not.toBeNull();
  await act(() =>
    row!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
      }),
    ),
  );
}

function menu() {
  return document.querySelector('[role="menu"]');
}

function menuItems() {
  return [...(menu()?.querySelectorAll('[role="menuitem"]') ?? [])].map(
    (item) => item.textContent?.trim(),
  );
}

function menuItem(label: string) {
  const item = [
    ...(menu()?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ].find((entry) => entry.textContent?.trim() === label);
  expect(item, `missing menu item ${label}`).toBeDefined();
  return item!;
}

function buttonLabels() {
  return [...container.querySelectorAll("button")].map((button) =>
    button.textContent?.trim(),
  );
}

it.each(["steam", "xbox", "battlenet", "epic", "gog"])(
  "right-click on the %s launcher in the sidebar shows Manage accounts and Import games",
  async (launcher) => {
    await act(() => root.render(<LibraryTestShell />));
    await rightClick(launcher);
    expect(menuItems()).toEqual(["Manage accounts", "Import games"]);
  },
);

it("Manage accounts opens Launcher accounts", async () => {
  await act(() => root.render(<LibraryTestShell />));
  await rightClick("epic");
  await act(() => menuItem("Manage accounts").click());
  expect(useAppStore.getState().activeView).toBe("accounts");
  expect(menu()).toBeNull();
});

it("Import games opens the import page of the launcher that was right-clicked", async () => {
  await act(() => root.render(<LibraryTestShell />));
  await rightClick("xbox");
  await act(() => menuItem("Import games").click());
  expect(useAppStore.getState().activeView).toBe("import");
  expect(useAppStore.getState().libraryImportProvider).toBe("xbox");
  expect(menu()).toBeNull();
});

it("leaves Import games out where the launcher has no import, like Import more in My Games", async () => {
  mocks.platform = "macos";
  await act(() => root.render(<LibraryTestShell />));
  await act(() =>
    container.querySelector<HTMLButtonElement>("#library-tab-steam")!.click(),
  );
  expect(buttonLabels()).not.toContain("Import more from Steam");
  await rightClick("steam");
  expect(menuItems()).toEqual(["Manage accounts"]);
});

it("right-click on PlayCounter in the sidebar shows Manage accounts", async () => {
  await act(() => root.render(<LibraryTestShell />));
  await rightClick("unimported");
  expect(menuItems()).toEqual(["Manage accounts"]);
  await act(() => menuItem("Manage accounts").click());
  expect(useAppStore.getState().activeView).toBe("accounts");
  expect(menu()).toBeNull();
});

it("the All games row opens no menu", async () => {
  await act(() => root.render(<LibraryTestShell />));
  await rightClick("all");
  expect(menu()).toBeNull();
});

it("My Games on a launcher tab keeps Import more and no longer shows Manage accounts", async () => {
  await act(() => root.render(<LibraryTestShell />));
  await act(() =>
    container.querySelector<HTMLButtonElement>("#library-tab-steam")!.click(),
  );
  expect(buttonLabels()).toContain("Import more from Steam");
  expect(buttonLabels()).not.toContain("Manage accounts");
});
