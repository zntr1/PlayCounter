// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QuickAddGame, QuickAddPayload, QuickAddReply } from "../quickAdd";
import { QuickAddWindow } from "./QuickAddWindow";

let root: Root;
let container: HTMLDivElement;
let listener: ((reply: QuickAddReply) => void) | null;
const onSearch = vi.fn();
const onPick = vi.fn();
const onFit = vi.fn();
const onClose = vi.fn();

const payload: QuickAddPayload = {
  quickAdd: true,
  labels: { "Add game": "Spiel hinzufügen" },
  theme: "dark",
  accentColor: null,
  reducedMotion: true,
};

const HADES: QuickAddGame = {
  igdbId: 100,
  name: "Hades",
  coverUrl: null,
  releaseYear: 2020,
  inLibrary: false,
};
const HADES_II: QuickAddGame = {
  igdbId: 200,
  name: "Hades II",
  coverUrl: null,
  releaseYear: 2025,
  inLibrary: false,
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mock of [onSearch, onPick, onFit, onClose]) mock.mockReset();
  listener = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root.render(
      <QuickAddWindow
        payload={payload}
        onSearch={onSearch}
        onPick={onPick}
        onFit={onFit}
        onClose={onClose}
        subscribe={(next) => {
          listener = next;
          return () => {
            listener = null;
          };
        }}
      />,
    ),
  );
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const input = () => container.querySelector("input")!;
const rows = () => [...container.querySelectorAll('[role="option"]')];
const marked = () =>
  rows()
    .filter((row) => row.getAttribute("aria-selected") === "true")
    .map((row) => row.textContent);
async function type(value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (key: string) =>
  act(() =>
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
  );
const reply = (next: QuickAddReply) => act(() => listener?.(next));
async function searchHades(games: QuickAddGame[] = [HADES, HADES_II]) {
  await type("hades");
  await press("Enter");
  await reply({ kind: "results", query: "hades", games });
}
const button = (text: string) =>
  [...container.querySelectorAll("button")].find(
    (item) => item.textContent === text,
  )!;
const click = (element: Element) =>
  act(() => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

it("opens focused, in the main window's language", () => {
  expect(document.activeElement).toBe(input());
  expect(container.textContent).toContain("Spiel hinzufügen");
  // Texts the main window did not send fall back to English.
  expect(container.textContent).toContain("Quick add game");
});

it("searches on Enter, then adds the marked game on Enter again", async () => {
  await type("hades");
  await press("Enter");
  expect(onSearch).toHaveBeenCalledExactlyOnceWith("hades");
  expect(onPick).not.toHaveBeenCalled();

  await reply({ kind: "results", query: "hades", games: [HADES, HADES_II] });
  expect(rows()).toHaveLength(2);
  expect(marked()).toEqual([expect.stringContaining("Hades")]);
  await press("Enter");
  expect(onPick).toHaveBeenCalledExactlyOnceWith(100);
  expect(onSearch).toHaveBeenCalledOnce();
});

it("searches again on Enter once the text changed after a search", async () => {
  await searchHades();
  await type("hades 2");
  await press("Enter");
  expect(onSearch).toHaveBeenLastCalledWith("hades 2");
  expect(onPick).not.toHaveBeenCalled();
});

it("moves the mark with the arrow keys", async () => {
  await searchHades();
  await press("ArrowDown");
  expect(marked()).toEqual([expect.stringContaining("Hades II")]);
  await press("Enter");
  expect(onPick).toHaveBeenCalledExactlyOnceWith(200);
});

it("only marks a game on click; Add game adds it", async () => {
  await searchHades();
  await click(rows()[1]);
  expect(marked()).toEqual([expect.stringContaining("Hades II")]);
  expect(onPick).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  await click(button("Spiel hinzufügen"));
  expect(onPick).toHaveBeenCalledExactlyOnceWith(200);
});

it("closes on Esc without adding and gives the focus back", async () => {
  await searchHades();
  await press("Escape");
  expect(onClose).toHaveBeenCalledExactlyOnceWith(true);
  expect(onPick).not.toHaveBeenCalled();
});

it("closes on a click elsewhere without adding", async () => {
  await searchHades();
  await act(() => window.dispatchEvent(new Event("blur")));
  expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
  expect(onPick).not.toHaveBeenCalled();
});

it("says a game is already in the library, adds nothing and stays open", async () => {
  await searchHades([{ ...HADES, inLibrary: true }, HADES_II]);
  expect(rows()[0].textContent).toContain("In your library");
  await press("Enter");
  expect(container.textContent).toContain("Hades is already in your library.");
  expect(onPick).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

it("shows the added game for a second, then closes and gives the focus back", async () => {
  vi.useFakeTimers();
  await searchHades();
  await press("Enter");
  await reply({ kind: "added", igdbId: 100 });
  expect(container.textContent).toContain("Hades added");
  expect(container.textContent).toContain("It's in My Games now.");
  await act(() => vi.advanceTimersByTime(999));
  expect(onClose).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTime(1));
  expect(onClose).toHaveBeenCalledExactlyOnceWith(true);
});

it("says so when the main window finds the game already added", async () => {
  await searchHades();
  await press("Enter");
  await reply({ kind: "already", igdbId: 100 });
  expect(container.textContent).toContain("Hades is already in your library.");
  expect(container.textContent).not.toContain("Hades added");
  expect(onClose).not.toHaveBeenCalled();
});

it("shows Add game's texts for no matches and for a failed search", async () => {
  await type("zzzz");
  await press("Enter");
  await reply({ kind: "results", query: "zzzz", games: [] });
  expect(container.textContent).toContain(
    "No matching games found. Try the English title or another spelling.",
  );
  await press("Enter");
  await reply({
    kind: "error",
    query: "zzzz",
    message: "Game search failed (503).",
  });
  expect(container.textContent).toContain("Game search failed (503).");
  expect(onClose).not.toHaveBeenCalled();
});

it("ignores the answer to an older search", async () => {
  await type("hades");
  await press("Enter");
  await type("celeste");
  await press("Enter");
  await reply({ kind: "results", query: "hades", games: [HADES] });
  expect(rows()).toHaveLength(0);
  await press("Enter");
  expect(onPick).not.toHaveBeenCalled();
  // The answer for what's in the field still counts.
  await reply({
    kind: "results",
    query: "celeste",
    games: [{ ...HADES, igdbId: 300, name: "Celeste" }],
  });
  expect(rows()).toHaveLength(1);
  await press("Enter");
  expect(onPick).toHaveBeenCalledExactlyOnceWith(300);
});
