// @vitest-environment happy-dom
import type { Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getSessionGameKey } from "../../historyStats";
import type { LibraryImportEntry } from "../../library/types";
import type { AwardedMilestone } from "../../milestones";
import type { ShelfHidePlace } from "../../personalLibrary";
import { useAppStore, type ActiveSession } from "../../store";
import { AchievementsView } from "./AchievementsView";
import { HistoryView } from "./HistoryView";
import { NowEmulatingView } from "./NowEmulatingView";
import { NowPlayingView } from "./NowPlayingView";

/* docs/hidden-shelves-plan.md, "History, Achievements, Now Playing" and
   decisions 3 and 4. */

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

const H = 3600;
const lethal = {
  gameId: -1,
  source: "custom" as const,
  gameName: "Lethal Company",
};
const elden = { gameId: -2, source: "custom" as const, gameName: "Elden Ring" };
const hades = {
  gameId: 1,
  source: "igdb" as const,
  igdbId: 100,
  gameName: "Hades",
};
const dave = {
  gameId: 2,
  source: "igdb" as const,
  igdbId: 200,
  gameName: "Dave the Diver",
};

function played(
  id: number,
  game: {
    gameId: number;
    source: "custom" | "igdb";
    igdbId?: number;
    gameName: string;
  },
  hours: number,
  daysAgo = 2,
): Session {
  const startedAt = new Date(
    Date.now() - daysAgo * 24 * H * 1000,
  ).toISOString();
  return {
    id,
    ...game,
    coverUrl: "",
    exeName: `${game.gameName.replace(/\W+/g, "")}.exe`,
    startedAt,
    endedAt: new Date(Date.parse(startedAt) + hours * H * 1000).toISOString(),
    durationSeconds: hours * H,
  };
}

// A Steam import with launcher hours and no session: its time comes only
// from the launcher.
const daveImport: LibraryImportEntry = {
  provider: "steam",
  externalId: "200",
  gameId: dave.gameId,
  igdbId: dave.igdbId,
  source: "igdb",
  name: dave.gameName,
  coverUrl: "",
  importedAt: "2026-10-01T12:00:00.000Z",
  lastReadAt: "2026-10-01T12:00:00.000Z",
  providerSeconds: 40 * H,
  linkedExeNames: [],
  linkedExeSources: [],
};

let root: Root;
let container: HTMLDivElement;
let privateShelf: string;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Charts measure their width; happy-dom has no ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(
        private readonly callback: (
          entries: Array<{ contentRect: { width: number } }>,
        ) => void,
      ) {}
      observe() {
        this.callback([{ contentRect: { width: 900 } }]);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  const state = useAppStore.getState();
  privateShelf = state.savePersonalShelf({ name: "Private" })!;
  state.updateGameJournal(lethal, { shelfIds: [privateShelf] });
  state.updateGameJournal(dave, { shelfIds: [privateShelf] });
  container = document.createElement("div");
  container.setAttribute("data-controller-content", "true");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const hide = (...places: ShelfHidePlace[]) =>
  act(() => {
    const state = useAppStore.getState();
    state.savePersonalShelf({
      ...state.personalShelves.find((shelf) => shelf.id === privateShelf)!,
      hiddenIn: places,
    });
  });

const plain = (text: string | null | undefined) =>
  (text ?? "").replace(/\s+/g, " ").trim();

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function openTab(id: string) {
  await act(() =>
    container.querySelector<HTMLButtonElement>(`#${id}`)!.click(),
  );
  await settle();
}

// History: sessions, totals, the games list and launcher hours.
it("leaves a hidden game's sessions and launcher hours out of My History", async () => {
  useAppStore.setState({
    recentSessions: [played(1, hades, 2), played(2, lethal, 1, 1)],
    libraryImports: new Map([["steam:200", daveImport]]),
  });
  await act(() => root.render(<HistoryView />));
  await settle();
  // Before: 2h Hades + 1h Lethal Company + 40h from Steam.
  expect(plain(container.querySelector("h1")?.textContent)).toContain("43h");

  await hide("history");
  await settle();
  expect(plain(container.querySelector("h1")?.textContent)).toContain("2h");
  expect(plain(container.querySelector("h1")?.textContent)).not.toContain(
    "43h",
  );
  for (const tab of [
    "history-tab-insights",
    "history-tab-sessions",
    "history-tab-games",
  ]) {
    await openTab(tab);
    expect(container.textContent, tab).toContain("Hades");
    expect(container.textContent, tab).not.toContain("Lethal Company");
    expect(container.textContent, tab).not.toContain("Dave the Diver");
  }
});

// Decision 4.
it("shows a hidden game's sessions when that game itself was picked for My History", async () => {
  const lethalSession = played(2, lethal, 1, 1);
  useAppStore.setState({
    recentSessions: [played(1, hades, 2), lethalSession],
  });
  await hide("history");
  useAppStore
    .getState()
    .setHistoryGameKey(getSessionGameKey(lethalSession), lethal.gameName);
  await act(() => root.render(<HistoryView />));
  await settle();
  const sessions = container.querySelector(
    '[role="tabpanel"][aria-labelledby="history-tab-sessions"]',
  );
  expect(sessions?.textContent).toContain("Lethal Company");
});

// Achievements; decision 3 for milestones over all games.
it("leaves a hidden game's ladder and unlocks off Achievements, out of the +N count, and keeps milestones over all games", async () => {
  const lethalSession = played(1, lethal, 12);
  const eldenSession = played(2, elden, 12);
  // Hours but no trophy yet: Hades may count in "+N more tracked games".
  const hadesSession = played(3, hades, 6);
  const award = (
    id: string,
    kind: AwardedMilestone["kind"],
    gameName?: string,
  ): AwardedMilestone => ({
    id,
    kind,
    title: id, // i18n-exempt: test fixture
    ...(gameName ? { gameName } : {}),
    awardedAt: "2026-10-10T12:00:00.000Z",
  });
  useAppStore.setState({
    recentSessions: [lethalSession, eldenSession, hadesSession],
    awardedMilestones: [
      award("milestone:total:10", "milestone-total"),
      award(
        `milestone:game:${getSessionGameKey(lethalSession)}:10`,
        "milestone-game",
        lethal.gameName,
      ),
      award(
        `milestone:game:${getSessionGameKey(eldenSession)}:10`,
        "milestone-game",
        elden.gameName,
      ),
    ],
  });
  vi.stubGlobal("IntersectionObserver", undefined);
  await act(() => root.render(<AchievementsView />));
  const milestonesTab = () =>
    plain(container.querySelector("#achievements-tab-milestones")?.textContent);
  const before = milestonesTab();
  await openTab("achievements-tab-games");
  expect(container.textContent).toContain("Lethal Company");
  const moreBefore = plain(container.textContent).match(
    /\+(\d+) more tracked games/,
  )?.[1];

  await hide("achievements");
  expect(container.textContent).not.toContain("Lethal Company");
  expect(container.textContent).toContain("Elden Ring");
  expect(
    plain(container.textContent).match(/\+(\d+) more tracked games/)?.[1],
  ).toBe(moreBefore);
  await openTab("achievements-tab-milestones");
  expect(container.textContent).not.toContain("Lethal Company");
  expect(milestonesTab()).toBe(before);
});

function active(
  id: number,
  game: { gameId: number; source: "custom"; gameName: string },
  emulator = false,
): ActiveSession {
  const startedAt = new Date(Date.now() - 600_000).toISOString();
  return {
    id,
    ...game,
    exeName: emulator
      ? "Dolphin.exe"
      : `${game.gameName.replace(/\W+/g, "")}.exe`,
    coverUrl: "",
    startedAt,
    checkpointedAt: startedAt,
    ...(emulator
      ? {
          emulator: {
            emulatorId: "dolphin",
            label: "Dolphin",
            contentKey: "dolphin:title_id:GALE01",
            display: game.gameName,
            trust: "recognized" as const,
          },
        }
      : {}),
  };
}

// Now Playing.
it("shows Now Playing's empty panel while only a hidden game runs", async () => {
  useAppStore.setState({ activeSessions: [active(1, lethal)] });
  await act(() => root.render(<NowPlayingView />));
  expect(container.textContent).toContain("Lethal Company");

  await hide("nowPlaying");
  expect(container.textContent).not.toContain("Lethal Company");
  expect(container.textContent).toContain("No game detected");

  useAppStore.setState({
    activeSessions: [active(1, lethal), active(2, elden)],
  });
  await act(() => root.render(<NowPlayingView />));
  expect(container.textContent).toContain("Elden Ring");
  expect(container.textContent).not.toContain("Lethal Company");
});

// Now Emulating: the emulator itself is still running, as it is when a
// hidden game plays in it.
it("leaves a hidden game off Now Emulating and only says the emulator runs", async () => {
  useAppStore.setState({
    activeSessions: [active(1, lethal, true)],
    processes: [
      { exeName: "Dolphin.exe", exePath: null, emulatorId: "dolphin" },
    ],
  });
  await act(() => root.render(<NowEmulatingView />));
  expect(container.textContent).toContain("Lethal Company");

  await hide("nowPlaying");
  expect(container.textContent).not.toContain("Lethal Company");
  expect(container.textContent).toContain("Emulator running");
});
