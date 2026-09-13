// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getGameJournal, useAppStore } from "../store";
import { GameJournalHost, SessionPlaythroughSelect } from "./GameJournalDialog";
import { GameNoteBadge } from "./GameJournalActions";

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
  expect(button).toBeDefined();
  await act(() => button!.click());
}

it("edits the session's note and switches scopes without copying text into another note", async () => {
  useAppStore
    .getState()
    .openGameJournal({ game, tab: "note", playthroughId: first });
  await act(() => root.render(<GameJournalHost />));
  const textarea = document.querySelector("textarea")!;
  expect(textarea.value).toBe("First run reminder");
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, "Updated first run");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Save note");
  const select = document.querySelector<HTMLSelectElement>(
    '[aria-label="Journal playthrough"]',
  )!;
  await act(() => {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(textarea.value).toBe("General reminder");
  await click("Done");
  const journal = getGameJournal(useAppStore.getState(), game);
  expect(journal.note).toBe("General reminder");
  expect(journal.playthroughs.find((p) => p.id === first)?.note).toBe(
    "Updated first run",
  );
  expect(journal.playthroughs.find((p) => p.id === second)?.note).toBe("");
});

it("opens the general note from the cover when the active playthrough has no note", async () => {
  await act(() =>
    root.render(
      <>
        <GameNoteBadge game={game} />
        <GameJournalHost />
      </>,
    ),
  );
  const button = document.querySelector<HTMLButtonElement>(
    '[aria-label="Read note for Campaign"]',
  )!;
  await act(() => button.click());
  expect(document.querySelector("textarea")?.value).toBe("General reminder");
  expect(useAppStore.getState().journalTarget?.playthroughId).toBeNull();
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
  await act(() => root.render(<SessionPlaythroughSelect session={session} />));
  const select = document.querySelector("select")!;
  await act(() => {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(
    useAppStore.getState().recentSessions[0].playthroughId,
  ).toBeUndefined();
  expect(useAppStore.getState().recentSessions[0].durationSeconds).toBe(3600);
  expect(getGameJournal(useAppStore.getState(), game).activePlaythroughId).toBe(
    second,
  );
});
