// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getGameJournal, useAppStore, type ActiveSession } from "../store";
import { gameStatusLabel, type GameStatus } from "../personalLibrary";
import { GameJournalHost, SessionPlaythroughPicker } from "./GameJournalDialog";
import { GameJournalBadges, GameJournalMenu } from "./GameJournalActions";
import { ContextMenu } from "./ContextMenu";
import { GAME_STATUS_LIST, STATUS_TONES } from "./journalStyles";
import { ActiveGameHero } from "./views/ActiveGameHero";

const game = { gameId: -1, source: "custom" as const, gameName: "Campaign" };
/** The icon each status shows: on the cover, in every status menu, and on
 *  the filter pills. */
const STATUS_ICONS: Record<GameStatus, string> = {
  playing: "lucide-play",
  "on-hold": "lucide-pause",
  finished: "lucide-check",
  "want-to-play": "lucide-bookmark",
  "want-to-replay": "lucide-rotate-ccw",
  "not-planned": "lucide-ban",
};
let root: Root;
let container: HTMLDivElement;
let first: string;
let second: string;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.getState().updateGameJournal(game, { note: "General reminder" });
  first = useAppStore.getState().createPlaythrough(game, "First run")!;
  useAppStore
    .getState()
    .updatePlaythrough(game, first, { note: "First run reminder" });
  second = useAppStore.getState().createPlaythrough(game, "Replay")!;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  expect(button, `no button labelled ${text}`).toBeDefined();
  await act(() => button!.click());
}

async function clickLabel(label: string) {
  const button = document.querySelector<HTMLButtonElement>(
    `[aria-label="${label}"]`,
  );
  expect(button, `no control labelled ${label}`).not.toBeNull();
  await act(() => button!.click());
}

function ledgerRows() {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}

function selectedRow() {
  return ledgerRows().find(
    (row) => row.getAttribute("aria-selected") === "true",
  );
}

async function selectPlaythrough(name: string) {
  const row = ledgerRows().find((item) =>
    item.textContent?.trim().startsWith(name),
  );
  expect(row, `no playthrough row for ${name}`).toBeDefined();
  await act(() => row!.click());
}

async function type(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("hides shelf controls while keeping progress, favorites, and shelf memberships", async () => {
  const shelf = useAppStore.getState().savePersonalShelf({ name: "Weekend" })!;
  useAppStore.getState().updateGameJournal(game, { shelfIds: [shelf] });
  useAppStore.getState().setMyGamesShowShelves(false);
  await act(() =>
    root.render(
      <>
        <ContextMenu open position={{ x: 0, y: 0 }} onClose={() => {}}>
          <GameJournalMenu game={game} onClose={() => {}} />
        </ContextMenu>
        <GameJournalHost />
      </>,
    ),
  );
  await click("Journal");
  expect(
    document.querySelector('[aria-label="Remove Campaign from Weekend"]'),
  ).toBeNull();
  expect(document.querySelector('[aria-label="New shelf name"]')).toBeNull();
  expect(
    [...document.querySelectorAll("button")].some(
      (item) => item.textContent?.trim() === "Add to shelf",
    ),
  ).toBe(false);
  await clickLabel("Progress status");
  await click("In progress");
  expect(getGameJournal(useAppStore.getState(), game).status).toBe("playing");
  expect(getGameJournal(useAppStore.getState(), game).shelfIds).toEqual([
    shelf,
  ]);

  await act(() => useAppStore.getState().setMyGamesShowShelves(true));
  expect(
    document.querySelector('[aria-label="Remove Campaign from Weekend"]'),
  ).not.toBeNull();
  await click("Add to shelf");
  expect(
    document.querySelector('[aria-label="New shelf name"]'),
  ).not.toBeNull();
  expect(getGameJournal(useAppStore.getState(), game).note).toBe(
    "General reminder",
  );
});

it("offers a default playthrough for an existing game and keeps its history when starting another", async () => {
  const oldSession = {
    ...game,
    id: 1,
    exeName: "game.exe",
    startedAt: "2026-09-13T10:00:00Z",
    endedAt: "2026-09-13T11:00:00Z",
    durationSeconds: 3600,
  };
  useAppStore.setState({
    gameJournals: {},
    recentSessions: [oldSession, { ...oldSession, id: 2, gameId: -2 }],
    archivedGameSeconds: { "custom:-1": 900, "custom:-2": 9000 },
  });
  useAppStore.getState().openGameJournal({ game, tab: "playthroughs" });
  await act(() => root.render(<GameJournalHost />));
  expect(selectedRow()?.textContent).toContain("Default playthrough");
  expect(selectedRow()?.textContent).toContain("Active");
  expect(document.body.textContent).toContain("1h 15m");
  expect(document.body.textContent).toContain("Recorded sessions · 1");
  expect(document.body.textContent).not.toContain("Unassigned");

  await click("Add playthrough");
  await type(
    document.querySelector<HTMLInputElement>(
      '[aria-label="New playthrough name"]',
    )!,
    "Replay",
  );
  await clickLabel("Create playthrough");
  expect(selectedRow()?.textContent).toContain("Replay");
  expect(selectedRow()?.textContent).toContain("Active");
  expect(document.body.textContent).toContain("Recorded sessions · 0");
  expect(useAppStore.getState().recentSessions[0]).toEqual(oldSession);

  await selectPlaythrough("Default playthrough");
  await click("Make active");
  expect(selectedRow()?.textContent).toContain("Default playthrough");
  expect(document.body.textContent).toContain("1h 15m");
  expect(
    getGameJournal(useAppStore.getState(), game).activePlaythroughId,
  ).toBeNull();
  expect(useAppStore.getState().recentSessions[0]).toEqual(oldSession);
});

it("edits the session's note and switches scopes without copying text into another note", async () => {
  useAppStore
    .getState()
    .openGameJournal({ game, tab: "note", playthroughId: first });
  await act(() => root.render(<GameJournalHost />));
  const textarea = document.querySelector("textarea")!;
  expect(textarea.value).toBe("First run reminder");
  await type(textarea, "Updated first run");
  await click("Save note");
  await selectPlaythrough("Default playthrough");
  expect(document.querySelector("textarea")!.value).toBe("General reminder");
  await click("Done");
  const journal = getGameJournal(useAppStore.getState(), game);
  expect(journal.note).toBe("General reminder");
  expect(journal.playthroughs.find((p) => p.id === first)?.note).toBe(
    "Updated first run",
  );
  expect(journal.playthroughs.find((p) => p.id === second)?.note).toBe("");
});

it.each([true, false])(
  "opens the default note from the cover when the active playthrough has no note (another named note: %s)",
  async (hasOtherNote) => {
    if (!hasOtherNote)
      useAppStore.getState().updatePlaythrough(game, first, { note: "" });
    await act(() =>
      root.render(
        <>
          <GameJournalBadges game={game} />
          <GameJournalHost />
        </>,
      ),
    );
    await clickLabel("Read note for Campaign");
    expect(document.querySelector("textarea")?.value).toBe("General reminder");
    expect(useAppStore.getState().journalTarget?.playthroughId).toBeNull();
  },
);

it("rates a game from the card menu, shows the tier on the cover, and hides it by setting", async () => {
  await act(() =>
    root.render(
      <>
        <ContextMenu open position={{ x: 0, y: 0 }} onClose={() => {}}>
          <GameJournalMenu game={game} onClose={() => {}} />
        </ContextMenu>
        <GameJournalBadges game={game} />
      </>,
    ),
  );
  expect(document.querySelector('[aria-label^="Tier:"]')).toBeNull();
  await click("Tier");
  await click("A");
  expect(getGameJournal(useAppStore.getState(), game).tier).toBe("A");
  expect(document.querySelector('[aria-label="Tier: A"]')).not.toBeNull();

  await act(() => useAppStore.getState().setMyGamesShowTierBadges(false));
  expect(document.querySelector('[aria-label="Tier: A"]')).toBeNull();

  await click("Tier");
  await click("Clear tier");
  expect(getGameJournal(useAppStore.getState(), game).tier).toBeUndefined();
});

it("sets the status from the card menu in one click, ticks the current one, and clears it", async () => {
  const onClose = vi.fn();
  await act(() =>
    root.render(
      <>
        <ContextMenu open position={{ x: 0, y: 0 }} onClose={() => {}}>
          <GameJournalMenu game={game} onClose={onClose} />
        </ContextMenu>
        <GameJournalBadges game={game} />
      </>,
    ),
  );
  const menuLabels = [
    ...document.querySelectorAll("[data-context-menu-item]"),
  ].map((item) => item.textContent?.trim());
  expect(menuLabels.indexOf("Status")).toBe(menuLabels.indexOf("Tier") - 1);
  expect(document.querySelector('[aria-label^="Status:"]')).toBeNull();
  const statusItems = () => {
    const trigger = [
      ...document.querySelectorAll("[data-context-menu-item]"),
    ].find((item) => item.textContent?.trim() === "Status")!;
    return [
      ...document
        .getElementById(trigger.getAttribute("aria-controls")!)!
        .querySelectorAll("[data-context-menu-item]"),
    ];
  };

  await click("Status");
  expect(statusItems().map((item) => item.textContent?.trim())).toEqual([
    "In progress",
    "On hold",
    "Finished",
    "Want to play",
    "Want to replay",
    "Not planned",
  ]);
  // Each status shows the icon it has on covers and filter pills.
  GAME_STATUS_LIST.forEach((status, index) =>
    expect(
      statusItems()[index].querySelector(`svg.${STATUS_ICONS[status]}`),
      status,
    ).not.toBeNull(),
  );
  expect(
    statusItems().every(
      (item) => item.getAttribute("aria-checked") === "false",
    ),
  ).toBe(true);

  await click("Finished");
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(getGameJournal(useAppStore.getState(), game).status).toBe("finished");
  expect(
    document.querySelector('[aria-label="Status: Finished"]'),
  ).not.toBeNull();

  await click("Status");
  expect(
    statusItems()
      .filter((item) => item.getAttribute("aria-checked") === "true")
      .map((item) => item.textContent?.trim()),
  ).toEqual(["Finished"]);
  expect(statusItems().at(-1)?.textContent?.trim()).toBe("Clear status");

  await click("Clear status");
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(getGameJournal(useAppStore.getState(), game).status).toBeNull();
  expect(document.querySelector('[aria-label^="Status:"]')).toBeNull();
});

function menuLabels() {
  return [...document.querySelectorAll("[data-context-menu-item]")].map(
    (item) => item.textContent?.trim(),
  );
}

/** The items of an open submenu, found from its trigger. */
function submenuItems(label: string) {
  const trigger = [
    ...document.querySelectorAll("[data-context-menu-item]"),
  ].find((item) => item.textContent?.trim() === label)!;
  return [
    ...document
      .getElementById(trigger.getAttribute("aria-controls")!)!
      .querySelectorAll("[data-context-menu-item]"),
  ];
}

it("puts a game on another shelf from the card menu, keeps it on its shelves, and takes it off a ticked one", async () => {
  const state = () => useAppStore.getState();
  const rpgs = state().savePersonalShelf({ name: "RPGs" })!;
  const backlog = state().savePersonalShelf({ name: "Backlog" })!;
  // Filters fill this shelf; a pick by hand can't put a game on it.
  state().savePersonalShelf({
    name: "Unplayed",
    filters: { played: "unplayed" },
  });
  state().updateGameJournal(game, { shelfIds: [rpgs] });
  const onClose = vi.fn();
  await act(() =>
    root.render(
      <ContextMenu open position={{ x: 0, y: 0 }} onClose={() => {}}>
        <GameJournalMenu game={game} onClose={onClose} />
      </ContextMenu>,
    ),
  );
  // Right under Tier, the way Status sits right above it.
  expect(menuLabels().indexOf("Shelves")).toBe(
    menuLabels().indexOf("Tier") + 1,
  );
  const ticked = () =>
    submenuItems("Shelves")
      .filter((item) => item.getAttribute("aria-checked") === "true")
      .map((item) => item.textContent?.trim());

  await click("Shelves");
  // Favorites keeps its own item in the menu.
  expect(
    submenuItems("Shelves").map((item) => item.textContent?.trim()),
  ).toEqual(["RPGs", "Backlog"]);
  expect(ticked()).toEqual(["RPGs"]);

  await click("Backlog");
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(getGameJournal(state(), game).shelfIds).toEqual([rpgs, backlog]);

  await click("Shelves");
  expect(ticked()).toEqual(["RPGs", "Backlog"]);
  await click("RPGs");
  expect(onClose).toHaveBeenCalledTimes(2);
  expect(getGameJournal(state(), game).shelfIds).toEqual([backlog]);
});

it("leaves Shelves out of the card menu until a shelf takes games by hand, and while shelves are switched off", async () => {
  const state = () => useAppStore.getState();
  await act(() =>
    root.render(
      <ContextMenu open position={{ x: 0, y: 0 }} onClose={() => {}}>
        <GameJournalMenu game={game} onClose={() => {}} />
      </ContextMenu>,
    ),
  );
  expect(menuLabels()).toContain("Tier");
  expect(menuLabels()).not.toContain("Shelves");

  await act(() => {
    state().savePersonalShelf({
      name: "Unplayed",
      filters: { played: "unplayed" },
    });
  });
  expect(menuLabels()).not.toContain("Shelves");

  await act(() => {
    state().savePersonalShelf({ name: "Backlog" });
  });
  expect(menuLabels()).toContain("Shelves");

  // Appearance → Shelves off hides the shelf row and the Journal's shelf
  // buttons; the card menu follows.
  await act(() => state().setMyGamesShowShelves(false));
  expect(menuLabels()).not.toContain("Shelves");
  await act(() => state().setMyGamesShowShelves(true));
  expect(menuLabels()).toContain("Shelves");
});

it.each(GAME_STATUS_LIST)(
  "shows %s on the cover as its icon, with the name only in the tooltip",
  async (status) => {
    useAppStore.getState().updateGameJournal(game, { status });
    await act(() => root.render(<GameJournalBadges game={game} />));
    const label = `Status: ${gameStatusLabel(status)}`;
    const badge = document.querySelector(`[aria-label="${label}"]`);
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute("title")).toBe(label);
    expect(badge!.querySelector(`svg.${STATUS_ICONS[status]}`)).not.toBeNull();
    // The name never sits on the cover, so long names ("Will ich nochmal
    // spielen") can't push the other badges off it.
    expect(container.textContent).not.toContain(gameStatusLabel(status));
  },
);

it("puts the status first on the cover, before the note, favorite and tier badges", async () => {
  useAppStore.getState().updateGameJournal(game, {
    status: "on-hold",
    note: "Boss at the bridge",
    favorite: true,
  });
  useAppStore.getState().setGameTier(game, "S");
  await act(() => root.render(<GameJournalBadges game={game} />));
  // The status always sits in the same spot, whatever other badges a card has.
  const row = document.querySelector(
    '[aria-label="Status: On hold"]',
  )!.parentElement!;
  expect([...row.children].map((badge) => badge.getAttribute("title"))).toEqual(
    ["Status: On hold", "Read note", "Favorite", "Tier: S"],
  );
});

it("shows the status icon on the journal's progress button and in its menu", async () => {
  useAppStore.getState().updateGameJournal(game, { status: "on-hold" });
  useAppStore.getState().openGameJournal({ game, tab: "note" });
  await act(() => root.render(<GameJournalHost />));
  const progress = document.querySelector('[aria-label="Progress status"]')!;
  expect(progress.textContent).toContain("On hold");
  expect(progress.querySelector("svg.lucide-pause")).not.toBeNull();

  await clickLabel("Progress status");
  const items = [...document.querySelectorAll("[data-context-menu-item]")];
  for (const status of GAME_STATUS_LIST) {
    const item = items.find(
      (element) => element.textContent?.trim() === gameStatusLabel(status),
    );
    expect(item, `no menu item for ${status}`).toBeDefined();
    expect(
      item!.querySelector(`svg.${STATUS_ICONS[status]}`),
      status,
    ).not.toBeNull();
  }
});

it("gives every status its own colour, never the accent colour, and keeps green away from In progress", () => {
  const colours = GAME_STATUS_LIST.map((status) => STATUS_TONES[status].text);
  expect(new Set(colours).size).toBe(GAME_STATUS_LIST.length);
  for (const colour of colours) expect(colour).not.toMatch(/accent/);
  // A running game's card turns green ("Running"), so a green In progress
  // badge would read as running. The dark theme block comes first.
  const styles = readFileSync("src/styles.css", "utf8");
  const value = (name: string) =>
    styles.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1];
  expect(value("--color-status-playing")).toBeDefined();
  expect(value("--color-status-playing")).not.toBe(value("--color-success"));
});

it("shows only the running session's playthrough note when switching assignments in Now Playing", async () => {
  const session: ActiveSession = {
    ...game,
    id: 7,
    playthroughId: first,
    exeName: "game.exe",
    coverUrl: "",
    startedAt: "2026-09-14T10:00:00Z",
    checkpointedAt: "2026-09-14T10:01:00Z",
  };
  useAppStore.setState({ activeSessions: [session] });
  function NowPlaying() {
    const running = useAppStore((state) => state.activeSessions[0]);
    return (
      <>
        <ActiveGameHero
          session={running}
          elapsedSeconds={60}
          recentSessions={[]}
          showDurationDays={false}
          exeCache={new Map()}
          resolveIgdbId={() => undefined}
          archivedGameSeconds={{}}
          playtimeAdjustments={{}}
          statusLabel="Now playing"
        />
        <GameJournalHost />
      </>
    );
  }
  await act(() => root.render(<NowPlaying />));
  expect(container.textContent).toContain("First run reminder");
  expect(container.textContent).not.toContain("General reminder");

  await clickLabel("Playthrough for session 7");
  await click("Replay");
  expect(useAppStore.getState().activeSessions[0].playthroughId).toBe(second);
  expect(container.textContent).not.toContain("First run reminder");
  expect(container.textContent).not.toContain("General reminder");
  expect(container.querySelector('[title="Open this note"]')).toBeNull();
  await click("Journal");
  expect(document.querySelector("textarea")?.value).toBe("");
  expect(useAppStore.getState().journalTarget?.playthroughId).toBe(second);
  await click("Done");

  await clickLabel("Playthrough for session 7");
  await click("Default playthrough");
  expect(container.textContent).toContain("General reminder");
  await click("General reminder");
  expect(document.querySelector("textarea")?.value).toBe("General reminder");
  expect(useAppStore.getState().journalTarget?.playthroughId).toBeNull();
  expect(getGameJournal(useAppStore.getState(), game).activePlaythroughId).toBe(
    second,
  );
});

it("changes a recorded session's assignment without changing the next-session default", async () => {
  const session = {
    ...game,
    id: 7,
    playthroughId: first,
    exeName: "game.exe",
    startedAt: "2026-09-13T10:00:00Z",
    endedAt: "2026-09-13T11:00:00Z",
    durationSeconds: 3600,
  };
  useAppStore.setState({ recentSessions: [session] });
  await act(() => root.render(<SessionPlaythroughPicker session={session} />));
  await clickLabel("Playthrough for session 7");
  await click("Default playthrough");
  expect(
    useAppStore.getState().recentSessions[0].playthroughId,
  ).toBeUndefined();
  expect(useAppStore.getState().recentSessions[0].durationSeconds).toBe(3600);
  expect(getGameJournal(useAppStore.getState(), game).activePlaythroughId).toBe(
    second,
  );
});

it("keeps a log of session notes for running and recorded sessions", async () => {
  const session = {
    ...game,
    id: 9,
    exeName: "game.exe",
    startedAt: "2026-09-13T10:00:00Z",
    endedAt: "2026-09-13T11:00:00Z",
    durationSeconds: 3600,
  };
  const running: ActiveSession = {
    ...game,
    id: 10,
    coverUrl: "",
    exeName: "game.exe",
    startedAt: new Date().toISOString(),
    checkpointedAt: new Date().toISOString(),
  };
  useAppStore.setState({
    recentSessions: [session],
    activeSessions: [running],
  });
  useAppStore
    .getState()
    .openGameJournal({ game, tab: "playthroughs", playthroughId: null });
  await act(() => root.render(<GameJournalHost />));
  const labelled = (label: string) => [
    ...document.querySelectorAll<HTMLButtonElement>(`[aria-label="${label}"]`),
  ];
  const editor = () =>
    document.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Session note"]',
    );
  const press = (key: string) =>
    act(() =>
      editor()!.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      ),
    );
  expect(labelled("Add session note")).toHaveLength(2);

  // The recorded session: Enter saves the trimmed text.
  await act(() => labelled("Add session note")[1].click());
  expect(document.activeElement).toBe(editor());
  await type(editor()!, "  Beat the bridge boss  ");
  await press("Enter");
  expect(editor()).toBeNull();
  expect(useAppStore.getState().recentSessions[0].note).toBe(
    "Beat the bridge boss",
  );
  expect(document.body.textContent).toContain("Beat the bridge boss");

  // Escape throws the change away and keeps the journal open.
  await act(() => labelled("Edit session note")[0].click());
  await type(editor()!, "Something else");
  await press("Escape");
  expect(editor()).toBeNull();
  expect(useAppStore.getState().recentSessions[0].note).toBe(
    "Beat the bridge boss",
  );
  expect(useAppStore.getState().journalTarget).not.toBeNull();

  // The running session keeps its note until it ends.
  await act(() => labelled("Add session note")[0].click());
  await type(editor()!, "Halfway through chapter 3");
  await press("Enter");
  expect(useAppStore.getState().activeSessions[0].note).toBe(
    "Halfway through chapter 3",
  );

  // An empty note removes it.
  await act(() => labelled("Edit session note")[1].click());
  await type(editor()!, "   ");
  await press("Enter");
  expect(useAppStore.getState().recentSessions[0]).toEqual(session);
  expect("note" in useAppStore.getState().recentSessions[0]).toBe(false);
});

it("caps session notes and refuses sessions that are gone", () => {
  const session = {
    ...game,
    id: 9,
    exeName: "game.exe",
    startedAt: "2026-09-13T10:00:00Z",
    endedAt: "2026-09-13T11:00:00Z",
    durationSeconds: 3600,
  };
  useAppStore.setState({ recentSessions: [session] });
  expect(useAppStore.getState().setSessionNote(9, "a".repeat(1500))).toBe(true);
  expect(useAppStore.getState().recentSessions[0].note).toHaveLength(1000);
  expect(useAppStore.getState().setSessionNote(99, "Lost")).toBe(false);
});

it("offers the playthrough menu in Now Playing even before a game has playthroughs", async () => {
  const fresh = { gameId: -3, source: "custom" as const, gameName: "Fresh" };
  const running: ActiveSession = {
    ...fresh,
    id: 11,
    coverUrl: "",
    exeName: "fresh.exe",
    startedAt: new Date().toISOString(),
    checkpointedAt: new Date().toISOString(),
  };
  useAppStore.setState({ activeSessions: [running] });
  await act(() =>
    root.render(
      <>
        <SessionPlaythroughPicker session={running} />
        <GameJournalHost />
      </>,
    ),
  );
  await clickLabel("Playthrough for session 11");
  const items = [...document.querySelectorAll('[role^="menuitem"]')].map(
    (item) => item.textContent?.trim(),
  );
  expect(items).toEqual(["Default playthrough", "Add playthrough"]);

  // Add playthrough opens the journal with its form ready.
  await click("Add playthrough");
  expect(useAppStore.getState().journalTarget).toMatchObject({
    game: { gameId: -3 },
    tab: "playthroughs",
    create: true,
  });
  expect(
    document.querySelector('[aria-label="New playthrough name"]'),
  ).not.toBeNull();
});
