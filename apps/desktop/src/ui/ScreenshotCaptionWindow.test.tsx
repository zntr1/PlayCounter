// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CaptionPayload } from "../quickNote";
import { ScreenshotCaptionWindow } from "./ScreenshotCaptionWindow";

let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();

const payload: CaptionPayload = {
  sessionId: 7,
  gameName: "Elden Ring",
  coverUrl: null,
  note: "",
  startedAt: null,
  duration: null,
  labels: {
    Save: "Speichern",
    "Picture saved · {{time}}": "Bild gespeichert · {{time}}",
  },
  theme: "dark",
  accentColor: null,
  reducedMotion: true,
  caption: {
    path: "C:\\Pictures\\PlayCounter\\Elden Ring\\Elden Ring 2026-11-08 21-44-07.jpg",
    pictureUrl: "asset://elden-ring.jpg",
    takenAt: "21:44",
  },
};

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onClose.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root.render(
      <ScreenshotCaptionWindow payload={payload} onClose={onClose} />,
    ),
  );
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const input = () => container.querySelector("input")!;
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
const button = (text: string) =>
  [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent === text,
  )!;

it("shows the picture just taken, with an empty caption that has focus", () => {
  expect(container.querySelector("img")?.getAttribute("src")).toBe(
    "asset://elden-ring.jpg",
  );
  expect(container.textContent).toContain("Elden Ring");
  expect(container.textContent).toContain("Bild gespeichert · 21:44");
  expect(input().value).toBe("");
  expect(document.activeElement).toBe(input());
  // Texts the main window did not send fall back to English.
  expect(container.textContent).toContain("Skip");
  expect(container.textContent).toContain("Speichern");
});

it("keeps captions to one line of at most 150 characters", () => {
  expect(input().tagName).toBe("INPUT");
  expect(input().maxLength).toBe(150);
});

it("saves the trimmed caption on Enter and hands focus back to the game", async () => {
  await type("  Finally beat Malenia  ");
  await press("Enter");
  expect(onClose).toHaveBeenCalledExactlyOnceWith("Finally beat Malenia", true);
  // A blur while the window closes must not save a second time.
  await act(() => window.dispatchEvent(new Event("blur")));
  expect(onClose).toHaveBeenCalledOnce();
});

it("keeps the picture without a caption on Esc", async () => {
  await type("Finally beat Malenia");
  await press("Escape");
  expect(onClose).toHaveBeenCalledExactlyOnceWith(null, true);
});

it("keeps the picture without a caption on Skip", async () => {
  await type("Finally beat Malenia");
  await act(() => button("Skip").click());
  expect(onClose).toHaveBeenCalledExactlyOnceWith(null, true);
});

it("has nothing to save when Enter comes with an empty caption", async () => {
  await type("   ");
  await press("Enter");
  expect(onClose).toHaveBeenCalledExactlyOnceWith(null, true);
});

it("keeps what was typed when the player clicks somewhere else", async () => {
  await type("That view from the tower");
  await act(() => window.dispatchEvent(new Event("blur")));
  expect(onClose).toHaveBeenCalledExactlyOnceWith(
    "That view from the tower",
    false,
  );
});
