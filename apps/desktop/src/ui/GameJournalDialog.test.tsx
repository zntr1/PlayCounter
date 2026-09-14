// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getGameJournal, useAppStore, type ActiveSession } from "../store";
import { GameJournalHost, SessionPlaythroughPicker } from "./GameJournalDialog";
import { GameJournalBadges } from "./GameJournalActions";
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
