// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../tracker", () => ({
  acceptCommunityUpgrade: vi.fn(),
  convertLocalSuggestionToCommunity: vi.fn(),
}));
vi.mock("../library/recheck", () => ({
  checkLibraryImportForMatches: vi.fn(),
}));
vi.mock("../library/commit", () => ({ commitLibraryImports: vi.fn() }));

import { commitLibraryImports } from "../library/commit";
import { checkLibraryImportForMatches } from "../library/recheck";
import type { LibraryImportCommit, LibraryImportEntry } from "../library/types";
import { useAppStore } from "../store";
import {
  acceptCommunityUpgrade,
  convertLocalSuggestionToCommunity,
} from "../tracker";
import { LevelUpAllDialog } from "./LevelUpAllDialog";
import type { LevelUpOffer } from "./levelUpOffers";

const NOW = "2026-09-30T10:00:00Z";
const entry = (externalId: string, name: string): LibraryImportEntry => ({
  provider: "steam",
  externalId,
  igdbId: Number(externalId),
  gameId: Number(externalId),
  source: "igdb",
  name,
  coverUrl: "",
  importedAt: NOW,
  providerSeconds: null,
  lastReadAt: NOW,
  linkedExeNames: [],
  linkedExeSources: [],
});

const OFFERS: LevelUpOffer[] = [
  {
    kind: "approved",
    key: "file:mine.exe",
    gameName: "Mine",
    exeName: "Mine.exe",
  },
  {
    kind: "match",
    key: "file:other.exe",
    gameName: "Other",
    exeName: "Other.exe",
    matchName: "Other Game",
    matchSource: "community",
  },
  {
    kind: "tracking",
    key: "import:steam:1",
    gameName: "Hades",
    entry: entry("1", "Hades"),
    exeNames: ["Hades.exe"],
  },
  {
    kind: "tracking",
    key: "import:steam:2",
    gameName: "Gone",
    entry: entry("2", "Gone"),
    exeNames: ["Gone.exe"],
  },
];

let container: HTMLDivElement;
let root: Root;
const onDone = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  useAppStore.setState({
    backendHealth: { status: "online", checkedAt: null, detail: null },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(() =>
    root.render(
      createElement(LevelUpAllDialog, {
        offers: OFFERS,
        onCancel: vi.fn(),
        onDone,
      }),
    ),
  );
}

function box(gameName: string) {
  return document.querySelector<HTMLInputElement>(
    `input[aria-label="Level up ${gameName}"]`,
  )!;
}

function button(text: string) {
  return [...document.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(text),
  );
}

it("levels up every ticked game and reports what found no match", async () => {
  const commit = { provider: "steam" } as unknown as LibraryImportCommit;
  vi.mocked(checkLibraryImportForMatches).mockImplementation(async (input) =>
    input.entry.externalId === "1"
      ? {
          kind: "found",
          commit,
          executableNames: ["Hades.exe"],
          executableMatches: [],
        }
      : { kind: "not_found" },
  );
  await render();
  expect(button("Level up 4 games")).toBeDefined();

  await act(() => box("Other").click());
  expect(box("Other").checked).toBe(false);
  await act(async () => button("Level up 3 games")!.click());

  expect(convertLocalSuggestionToCommunity).toHaveBeenCalledWith("Mine.exe");
  expect(acceptCommunityUpgrade).not.toHaveBeenCalled();
  // A fresh lookup for each launcher game; only found ones are linked.
  expect(checkLibraryImportForMatches).toHaveBeenCalledTimes(2);
  expect(commitLibraryImports).toHaveBeenCalledWith([commit]);
  expect(onDone).toHaveBeenCalledWith({ applied: 2, missed: ["Gone"] });
});

it("leaves launcher games out while offline", async () => {
  useAppStore.setState({
    backendHealth: { status: "offline", checkedAt: null, detail: null },
  });
  await render();
  expect(box("Hades").disabled).toBe(true);
  expect(box("Hades").checked).toBe(false);

  await act(async () => button("Level up 2 games")!.click());

  expect(acceptCommunityUpgrade).toHaveBeenCalledWith("Other.exe");
  expect(checkLibraryImportForMatches).not.toHaveBeenCalled();
  expect(onDone).toHaveBeenCalledWith({ applied: 2, missed: [] });
});
