// @vitest-environment happy-dom
import type { Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EARLIER_IMPORT } from "../../library/accountReadings";
import { commitLibraryImports } from "../../library/commit";
import { providerFloors } from "../../library/playtimeFloor";
import type { LibraryAccount } from "../../library/types";
import { milestoneMetrics } from "../../milestones";
import {
  createGameIdentityResolver,
  useAppStore,
  type ActiveSession,
} from "../../store";
import { removeLauncherAccount } from "../../tracker";
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

function importSteam(hours: number, account?: LibraryAccount) {
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
        ...(account
          ? {
              accounts: [
                { ...account, seconds: hours * H, readAt: IMPORTED_AT },
              ],
            }
          : {}),
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

// docs/import-accounts-plan.md, "What the player sees".
it("Details names each account with its hours under the launcher's total, and Earlier import for hours from before", async () => {
  importSteam(120);
  importSteam(100, { key: "b".repeat(32), name: "Kid" });
  await act(() => root.render(<MyGamesView />));
  expect(cardTime()).toBe("220h 0m");

  await act(() =>
    container
      .querySelector<HTMLButtonElement>(
        `[aria-label="Open details for ${NAME}"]`,
      )!
      .click(),
  );
  await act(() =>
    document
      .querySelector<HTMLButtonElement>("#game-details-tab-files")!
      .click(),
  );
  const details = () => document.querySelector('[role="dialog"]')!.textContent;
  expect(details()).toMatch(
    /Steam playtime220h 0mEarlier import120h 0mRemoveKid100h 0mRemove/,
  );

  // Phil's account has the 120h from before: it takes them over.
  await act(() => importSteam(120, { key: "a".repeat(32), name: "zesarex" }));
  expect(details()).toMatch(
    /Steam playtime220h 0mzesarex120h 0mRemoveKid100h 0mRemove/,
  );
  expect(details()).not.toContain("Earlier import");
});

it("Details shows a game from before accounts as it always did", async () => {
  importSteam(40);
  await act(() => root.render(<MyGamesView />));
  await act(() =>
    container
      .querySelector<HTMLButtonElement>(
        `[aria-label="Open details for ${NAME}"]`,
      )!
      .click(),
  );
  await act(() =>
    document
      .querySelector<HTMLButtonElement>("#game-details-tab-files")!
      .click(),
  );
  expect(document.querySelector('[role="dialog"]')!.textContent).toMatch(
    /Steam playtime40h 0mRemoveImported/,
  );
});

// docs/remove-account-hours-plan.md: Remove on each account line with hours,
// a confirm dialog that says what goes (Q1 A), and nothing else asked.
describe("removing a launcher account in Details", () => {
  const PHIL = { key: "a".repeat(32), name: "zesarex" };
  const KID = { key: "b".repeat(32), name: "Kid" };

  async function openFiles() {
    await act(() => root.render(<MyGamesView />));
    await act(() =>
      container
        .querySelector<HTMLButtonElement>(
          `[aria-label="Open details for ${NAME}"]`,
        )!
        .click(),
    );
    await act(() =>
      document
        .querySelector<HTMLButtonElement>("#game-details-tab-files")!
        .click(),
    );
  }
  const dialogs = () => [...document.querySelectorAll('[role="dialog"]')];
  const removeButtons = () =>
    [
      ...dialogs()[0].querySelectorAll<HTMLButtonElement>(
        'button[title^="Remove "]',
      ),
    ].map((button) => button.title);
  async function clickRemove(title: string) {
    const button = dialogs()[0].querySelector<HTMLButtonElement>(
      `button[title="${title}"]`,
    );
    expect(button, title).not.toBeNull();
    expect(button!.textContent).toBe("Remove");
    await act(() => button!.click());
  }
  async function answer(label: "Remove" | "Cancel") {
    const confirm = dialogs().at(-1)!;
    const button = [...confirm.querySelectorAll("button")].find(
      (item) => item.textContent === label,
    );
    expect(button, label).toBeDefined();
    await act(() => button!.click());
  }

  beforeEach(() => {
    // No PlayCounter time unless a test plays.
    useAppStore.setState({ archivedSeconds: 0, archivedGameSeconds: {} });
    vi.mocked(removeLauncherAccount).mockReset();
  });

  it("offers Remove on each account line with hours and asks before one account's hours go", async () => {
    importSteam(120, PHIL);
    importSteam(100, KID);
    await openFiles();
    expect(removeButtons()).toEqual([
      "Remove zesarex from Hitman 2",
      "Remove Kid from Hitman 2",
    ]);

    await clickRemove("Remove Kid from Hitman 2");
    expect(dialogs().at(-1)!.textContent).toContain(
      "Remove Kid from Hitman 2?",
    );
    expect(dialogs().at(-1)!.textContent).toContain(
      "The 100h 0m from this account stop counting for Hitman 2. Import the account again to bring them back.",
    );
    await answer("Cancel");
    expect(removeLauncherAccount).not.toHaveBeenCalled();
    expect(dialogs()).toHaveLength(1);

    await clickRemove("Remove Kid from Hitman 2");
    await answer("Remove");
    expect(removeLauncherAccount).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: 1, source: "igdb" }),
      { provider: "steam", externalId: "863550", accountKey: KID.key },
    );
  });

  it("puts Remove on the playtime line of a game from before accounts, and says the launcher leaves the game", async () => {
    importSteam(40);
    useAppStore.setState({ recentSessions: [played(2)] });
    await openFiles();
    expect(removeButtons()).toEqual(["Remove Steam from Hitman 2"]);

    await clickRemove("Remove Steam from Hitman 2");
    expect(dialogs().at(-1)!.textContent).toContain(
      "Remove Steam from Hitman 2?",
    );
    expect(dialogs().at(-1)!.textContent).toContain(
      "Steam's playtime, achievements and launching leave Hitman 2. Import the account again to bring them back.",
    );
    await answer("Remove");
    expect(removeLauncherAccount).toHaveBeenCalledWith(
      expect.objectContaining({ gameId: 1 }),
      {
        provider: "steam",
        externalId: "863550",
        accountKey: EARLIER_IMPORT,
      },
    );
  });

  it("says when the game leaves My Games, and closes Details after it", async () => {
    importSteam(80, PHIL);
    vi.mocked(removeLauncherAccount).mockReturnValue("game");
    await openFiles();

    await clickRemove("Remove zesarex from Hitman 2");
    expect(dialogs().at(-1)!.textContent).toContain(
      "Remove Hitman 2 from My Games?",
    );
    expect(dialogs().at(-1)!.textContent).toContain(
      "Hitman 2 came only from this Steam account, and PlayCounter counted no time for it. Import the account again to bring it back.",
    );
    await answer("Remove");
    expect(removeLauncherAccount).toHaveBeenCalledTimes(1);
    expect(dialogs()).toHaveLength(0);
  });

  it("offers no Remove where the launcher reports no playtime", async () => {
    importSteam(40, PHIL);
    useAppStore.setState((state) => ({
      libraryImports: new Map(
        [...state.libraryImports].map(([key, entry]) => [
          key,
          {
            ...entry,
            providerSeconds: null,
            accounts: [{ ...PHIL, seconds: null, readAt: IMPORTED_AT }],
          },
        ]),
      ),
      recentSessions: [played(2)],
    }));
    await openFiles();
    expect(dialogs()[0].textContent).toContain("Not reported");
    expect(removeButtons()).toEqual([]);
  });
});
