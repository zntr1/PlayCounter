// @vitest-environment happy-dom
import type { Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { commitLibraryImports } from "../../library/commit";
import { providerFloors } from "../../library/playtimeFloor";
import { milestoneMetrics } from "../../milestones";
import {
  createGameIdentityResolver,
  useAppStore,
  type ActiveSession,
} from "../../store";
import { ActiveGameHero } from "./ActiveGameHero";
import { MyGamesView } from "./MyGamesView";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const H = 3600;
const NAME = "Hitman 2";
const IMPORTED_AT = "2026-10-01T12:00:00.000Z";
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    settings: {
      ...useAppStore.getState().settings,
      gameLaunchingEnabled: false,
      libraryShowShelves: false,
    },
    // 3h archived under an older community entry of the same game: a key
    // My Games never lists for the card, but the import snapshot counts.
    gameMetadata: new Map([
      [
        "community:7",
        { id: 7, igdbId: 100, name: NAME, coverUrl: "", source: "community" },
      ],
    ]),
    archivedSeconds: 3 * H,
    archivedGameSeconds: { "community:7": 3 * H },
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

function importSteam(hours: number) {
  commitLibraryImports([
    {
      entry: {
        provider: "steam",
        externalId: "863550",
        gameId: 1,
        igdbId: 100,
        source: "igdb",
        name: NAME,
        coverUrl: "",
        importedAt: IMPORTED_AT,
        lastReadAt: IMPORTED_AT,
        providerSeconds: hours * H,
        linkedExeNames: [],
        linkedExeSources: [],
      },
      metadata: {
        id: 1,
        igdbId: 100,
        name: NAME,
        coverUrl: "",
        source: "igdb",
      },
      exeCacheEntries: [],
      scopedLinks: [],
    },
  ]);
}

function played(hours: number): Session {
  return {
    id: 1,
    gameId: 1,
    igdbId: 100,
    source: "igdb",
    gameName: NAME,
    coverUrl: "",
    exeName: "hitman2.exe",
    startedAt: "2026-10-02T12:00:00.000Z",
    endedAt: "2026-10-02T14:00:00.000Z",
    durationSeconds: hours * H,
  };
}

function achievementsHours() {
  const state = useAppStore.getState();
  return milestoneMetrics({
    sessions: state.recentSessions,
    archivedSeconds: state.archivedSeconds,
    archivedGameSeconds: state.archivedGameSeconds,
    playtimeAdjustments: state.playtimeAdjustments,
    providerFloors: providerFloors(state.libraryImports.values()),
    resolveIgdbId: createGameIdentityResolver(
      state.gameMetadata,
      state.exeCache,
      state.libraryImports,
    ),
    verifiedContributions: 0,
  }).games.get("igdb#100")?.hours;
}

function cardTime() {
  return container.querySelector('[title^="Launchers combined:"]')?.textContent;
}

it("shows the same growing total in My Games, Now Playing and Achievements", async () => {
  importSteam(40);
  useAppStore.setState({ recentSessions: [played(2)] });

  await act(() => root.render(<MyGamesView />));
  expect(cardTime()).toBe("42h 0m");
  expect(achievementsHours()).toBe(42);

  const state = useAppStore.getState();
  const active: ActiveSession = {
    id: 2,
    gameId: 1,
    igdbId: 100,
    source: "igdb",
    gameName: NAME,
    coverUrl: "",
    exeName: "hitman2.exe",
    startedAt: "2026-10-03T12:00:00.000Z",
    checkpointedAt: "2026-10-03T13:00:00.000Z",
  };
  const floor = providerFloors(state.libraryImports.values())[0];
  await act(() =>
    root.render(
      <ActiveGameHero
        session={active}
        elapsedSeconds={H}
        recentSessions={state.recentSessions}
        showDurationDays={false}
        exeCache={state.exeCache}
        resolveIgdbId={createGameIdentityResolver(
          state.gameMetadata,
          state.exeCache,
          state.libraryImports,
        )}
        archivedGameSeconds={state.archivedGameSeconds}
        playtimeAdjustments={state.playtimeAdjustments}
        providerFloor={floor}
        statusLabel="Now playing"
      />,
    ),
  );
  expect(container.textContent).toContain("43h 0m");
});
