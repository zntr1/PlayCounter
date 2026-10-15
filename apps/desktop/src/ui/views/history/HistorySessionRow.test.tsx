// @vitest-environment happy-dom
import type { Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { HistorySessionRow } from "./HistorySessionRow";

let root: Root;
let container: HTMLDivElement;

const session: Session = {
  id: 5,
  gameId: -1,
  source: "custom",
  gameName: "Hollow Knight",
  exeName: "hollow_knight.exe",
  startedAt: "2026-10-14T18:00:00Z",
  endedAt: "2026-10-14T20:00:00Z",
  durationSeconds: 7200,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderRow() {
  useAppStore.setState({ recentSessions: [session] });
  const Row = () => (
    <HistorySessionRow
      session={useAppStore((s) => s.recentSessions[0])}
      resolveIgdbId={() => undefined}
      selectedGameKey={null}
      onFilterGame={() => {}}
      onClearGameFilter={() => {}}
      onRequestDelete={() => {}}
    />
  );
  await act(() => root.render(<Row />));
}

const editor = () =>
  container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Session note"]',
  );

async function write(value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(editor(), value);
    editor()!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() =>
    editor()!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}

it("adds a note to one session and shows it under the session", async () => {
  await renderRow();
  expect(editor()).toBeNull();
  await act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Add session note"]')!
      .click(),
  );
  await write("Beat Hornet on the third try");
  expect(useAppStore.getState().recentSessions[0].note).toBe(
    "Beat Hornet on the third try",
  );
  expect(container.textContent).toContain("Beat Hornet on the third try");
  expect(
    container.querySelector('[aria-label="Edit session note"]'),
  ).not.toBeNull();

  // Clicking the note opens it again.
  await act(() =>
    container
      .querySelector<HTMLButtonElement>('[title="Edit session note"]')!
      .click(),
  );
  expect(editor()!.value).toBe("Beat Hornet on the third try");
});

it("offers the session note and the game note separately in the menu", async () => {
  await renderRow();
  await act(() =>
    container
      .querySelector("[data-history-session-row]")!
      .dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 5,
          clientY: 5,
        }),
      ),
  );
  const items = [...document.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent,
  );
  expect(items).toEqual(
    expect.arrayContaining(["Add session note", "Edit game note"]),
  );
  expect(items).not.toContain("Update note");
});
