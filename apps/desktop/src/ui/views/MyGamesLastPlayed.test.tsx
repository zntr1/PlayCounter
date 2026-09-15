// @vitest-environment happy-dom
import type { LibraryProviderId } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commitLibraryImports } from "../../library/commit";
import { buildLibraryImportCommit } from "../../library/importPlan";
import { STORAGE_KEY } from "../../persistence";
import { useAppStore } from "../../store";
import { MyGamesView } from "./MyGamesView";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const daysAgo = (days: number) =>
  new Date(NOW - days * 86_400_000).toISOString();
const NAME = "Imported game";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: false,
      libraryShowShelves: false,
    },
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

function importGame({
  provider = "steam",
  lastPlayedAt = daysAgo(2),
  seconds = 7_200,
  linked = false,
}: {
  provider?: LibraryProviderId;
  lastPlayedAt?: string | null;
  seconds?: number | null;
  linked?: boolean;
} = {}) {
  const commit = buildLibraryImportCommit({
    provider,
    now: daysAgo(0),
    scanned: {
      externalId: "100",
      playtimeSeconds: seconds,
      lastPlayedUnix: lastPlayedAt
        ? Date.parse(lastPlayedAt) / 1_000
        : undefined,
      installed: false,
      executables: [],
    },
    resolved: {
      key: `${provider}:100`,
      status: "resolved",
      game: {
        id: 1,
        igdbId: 100,
        name: NAME,
        coverUrl: "",
        source: "igdb",
      },
      executables: linked
        ? [
            {
              platform: "windows",
              kind: "exe",
              value: "imported.exe",
              provenance: "igdb",
              verified: true,
            },
          ]
        : [],
    },
  });
  expect(commit).not.toBeNull();
  commitLibraryImports([commit!]);
}

async function openDetails() {
  await act(() =>
    container
      .querySelector<HTMLButtonElement>(
        `[aria-label="Open details for ${NAME}"]`,
      )!
      .click(),
  );
}

function lastPlayedFigure() {
  const label = [...document.querySelectorAll('[role="dialog"] div')].find(
    (element) => element.textContent === "Last played",
  );
  expect(label).toBeDefined();
  return label!.nextElementSibling!.textContent;
}

it.each([
  { provider: "steam" as const, linked: false, seconds: 7_200 },
  { provider: "steam" as const, linked: true, seconds: 7_200 },
  { provider: "xbox" as const, linked: false, seconds: null },
])(
  "shows the imported $provider date with zero local sessions (linked: $linked)",
  async (options) => {
    importGame(options);
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(persisted.libraryImports[0].providerLastPlayedAt).toBe(daysAgo(2));
    expect(persisted.sessions).toEqual([]);
    expect(useAppStore.getState().recentSessions).toEqual([]);

    await act(() => root.render(<MyGamesView />));
    await openDetails();
    expect(lastPlayedFigure()).toBe(new Date(daysAgo(2)).toLocaleDateString());

    await act(() => {
      [
        ...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
      ]
        .find((button) => button.textContent === "Close")!
        .click();
      useAppStore.getState().setMyGamesCardSize("list");
    });
    const card = container.querySelector(".game-library-card")!;
    expect(card.textContent).toContain(
      `Last played ${new Date(daysAgo(2)).toLocaleDateString()}`,
    );
    expect(card.textContent).not.toContain("Added ");
  },
);

it.each([
  { localDaysAgo: 4, providerDaysAgo: 1 },
  { localDaysAgo: 1, providerDaysAgo: 4 },
])(
  "shows the newer date across local and imported history ($localDaysAgo / $providerDaysAgo days)",
  async ({ localDaysAgo, providerDaysAgo }) => {
    useAppStore.setState({
      recentSessions: [
        {
          id: 1,
          gameId: 1,
          igdbId: 100,
          source: "igdb",
          gameName: NAME,
          exeName: "imported.exe",
          startedAt: new Date(
            Date.parse(daysAgo(localDaysAgo)) - 3_600_000,
          ).toISOString(),
          endedAt: daysAgo(localDaysAgo),
          durationSeconds: 3_600,
        },
      ],
    });
    importGame({ lastPlayedAt: daysAgo(providerDaysAgo) });
    await act(() => root.render(<MyGamesView />));
    await openDetails();
    expect(lastPlayedFigure()).toBe(new Date(daysAgo(1)).toLocaleDateString());
  },
);

it.each([
  { provider: "steam" as const, seconds: 7_200, expected: "Unknown" },
  { provider: "xbox" as const, seconds: null, expected: "Unknown" },
  { provider: "steam" as const, seconds: 0, expected: "Never" },
])(
  "shows $expected when $provider has $seconds seconds and no play date",
  async ({ provider, seconds, expected }) => {
    importGame({ provider, seconds, lastPlayedAt: null });
    await act(() => root.render(<MyGamesView />));
    await openDetails();
    expect(lastPlayedFigure()).toBe(expected);
  },
);

it("refreshes the displayed date on reimport without creating sessions or duplicates", async () => {
  importGame({ lastPlayedAt: daysAgo(20) });
  await act(() => root.render(<MyGamesView />));
  await openDetails();
  expect(lastPlayedFigure()).toBe(new Date(daysAgo(20)).toLocaleDateString());

  await act(() => importGame({ lastPlayedAt: daysAgo(1) }));
  expect(lastPlayedFigure()).toBe(new Date(daysAgo(1)).toLocaleDateString());
  expect(useAppStore.getState().libraryImports.size).toBe(1);
  expect(useAppStore.getState().recentSessions).toEqual([]);
});
