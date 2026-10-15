// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { QuickNotePayload } from "../quickNote";
import { QuickNoteWindow } from "./QuickNoteWindow";

let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();

const payload: QuickNotePayload = {
  sessionId: 7,
  gameName: "Elden Ring",
  coverUrl: null,
  note: "Old note",
  startedAt: new Date().toISOString(),
  duration: null,
  labels: { Save: "Speichern" },
  theme: "dark",
  accentColor: null,
  reducedMotion: true,
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onClose.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root.render(<QuickNoteWindow payload={payload} onClose={onClose} />),
  );
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const input = () => container.querySelector("textarea")!;
async function type(value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (key: string, shiftKey = false) =>
  act(() =>
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true }),
    ),
  );

it("opens on the session's note, focused, in the main window's language", () => {
  expect(input().value).toBe("Old note");
  expect(document.activeElement).toBe(input());
  expect(container.textContent).toContain("Elden Ring");
  expect(container.textContent).toContain("Speichern");
  // Texts the main window did not send fall back to English.
  expect(container.textContent).toContain("Cancel");
});

it("saves the trimmed text on Enter and hands focus back to the game", async () => {
  await press("Enter", true);
  expect(onClose).not.toHaveBeenCalled();
  await type("  Old note\nBoss at the bridge  ");
  await press("Enter");
  expect(onClose).toHaveBeenCalledExactlyOnceWith(
    "Old note\nBoss at the bridge",
    true,
  );
  // A blur while the window closes must not save a second time.
  await act(() => window.dispatchEvent(new Event("blur")));
  expect(onClose).toHaveBeenCalledOnce();
});

it("saves nothing when the note is unchanged or cancelled", async () => {
  await press("Enter");
  expect(onClose).toHaveBeenCalledExactlyOnceWith(null, true);
});

it("throws the text away on Escape", async () => {
  await type("Changed");
  await press("Escape");
  expect(onClose).toHaveBeenCalledExactlyOnceWith(null, true);
});

it("keeps what was typed when the player clicks elsewhere, without stealing focus back", async () => {
  await type("Changed");
  await act(() => window.dispatchEvent(new Event("blur")));
  expect(onClose).toHaveBeenCalledExactlyOnceWith("Changed", false);
});
