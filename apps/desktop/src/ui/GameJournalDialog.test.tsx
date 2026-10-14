// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getGameJournal, useAppStore, type ActiveSession } from "../store";
import { GameJournalHost, SessionPlaythroughPicker } from "./GameJournalDialog";
import { GameJournalBadges, GameJournalMenu } from "./GameJournalActions";
import { ActiveGameHero } from "./views/ActiveGameHero";

const game = { gameId: -1, source: "custom" as const, gameName: "Campaign" };
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
        <GameJournalMenu game={game} onClose={() => {}} />
        <GameJournalHost />
      </>,
    ),
  );
  expect(container.textContent).not.toContain("Shelves & status");
  await click("Progress status");
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
