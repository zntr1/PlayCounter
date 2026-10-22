// @vitest-environment happy-dom
import type { Session } from "@playcounter/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { HistorySessionRow } from "./HistorySessionRow";

type RowProps = Partial<Parameters<typeof HistorySessionRow>[0]>;

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

async function renderRow(props: RowProps = {}, shown: Session = session) {
  useAppStore.setState({ recentSessions: [shown] });
  const Row = () => (
    <HistorySessionRow
      session={useAppStore((s) => s.recentSessions[0])}
      resolveIgdbId={() => undefined}
      selectedGameKey={null}
      onFilterGame={() => {}}
      onClearGameFilter={() => {}}
      onRequestDelete={() => {}}
      {...props}
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
    container.querySelector("[data-history-session-row]")!.dispatchEvent(
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

async function openMenu() {
  await act(() =>
    container.querySelector("[data-history-session-row]")!.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 5,
        clientY: 5,
      }),
    ),
  );
  return menuItems();
}

const menuItems = () =>
  [...document.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent,
  );

async function openPlaytime() {
  await openMenu();
  const trigger = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === "Playtime");
  await act(() => trigger!.click());
  return menuItems();
}

const changeProps = (canCombine: boolean): RowProps => ({
  onRequestEdit: () => {},
  onRequestSplit: () => {},
  onRequestCombine: () => {},
  canCombine,
});

it("groups Edit, Split and Combine under Playtime", async () => {
  await renderRow(changeProps(true));
  const items = await openMenu();
  expect(items.slice(items.indexOf("Filter for this game"))).toEqual([
    "Filter for this game",
    "Playtime",
    "Delete Session",
  ]);
  expect(await openPlaytime()).toEqual(
    expect.arrayContaining(["Edit session", "Split session", "Combine with…"]),
  );
});

it("hides Combine when the game has no session right before or after", async () => {
  await renderRow(changeProps(false));
  const items = await openPlaytime();
  expect(items).toContain("Split session");
  expect(items).not.toContain("Combine with…");
});

it("hides Split for a session under two minutes", async () => {
  await renderRow(changeProps(true), {
    ...session,
    endedAt: "2026-10-14T18:01:59Z",
    durationSeconds: 119,
  });
  const items = await openPlaytime();
  expect(items).toContain("Edit session");
  expect(items).not.toContain("Split session");
});

it("opens Edit session from the pencil next to the note", async () => {
  const onRequestEdit = vi.fn();
  await renderRow({ ...changeProps(true), onRequestEdit });
  await act(() =>
    container
      .querySelector<HTMLButtonElement>('[aria-label="Edit session"]')!
      .click(),
  );
  expect(onRequestEdit).toHaveBeenCalledWith(session);
});
