// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReportWrongMatchDialog } from "./ReportWrongMatchDialog";

let container: HTMLDivElement;
let root: Root;
const handlers = {
  onCancel: vi.fn(),
  onDifferentGame: vi.fn(),
  onNotAGame: vi.fn(),
  onNotPlaying: vi.fn(),
  onSoftware: vi.fn(),
  onIgnoreApp: vi.fn(),
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.values(handlers).forEach((handler) => handler.mockReset());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(withNotPlaying: boolean) {
  await act(() =>
    root.render(
      createElement(ReportWrongMatchDialog, {
        exeName: "eldenring.exe",
        gameName: "Elden Ring",
        ...handlers,
        onNotPlaying: withNotPlaying ? handlers.onNotPlaying : undefined,
      }),
    ),
  );
}

function button(text: string) {
  return [...document.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(text),
  );
}

async function click(text: string) {
  const found = button(text);
  expect(found, text).toBeDefined();
  await act(() => found!.click());
}

it("offers 'not sure' only when the caller handles it", async () => {
  await render(false);
  expect(button("Not sure, just ignore it")).toBeUndefined();
  await render(true);
  expect(button("Not sure, just ignore it")).toBeDefined();
});

it("picks a different game in one click", async () => {
  await render(true);
  await click("different game");
  expect(handlers.onDifferentGame).toHaveBeenCalledOnce();
});

it.each([
  ["part of a game, not the game", "Ignore and report", "onNotAGame"],
  ["Not sure, just ignore it", "Ignore on this PC", "onNotPlaying"],
  ["an app, ignore it", "Ignore app", "onIgnoreApp"],
] as const)(
  "asks before ignoring: %s",
  async (choice, confirmLabel, handler) => {
    await render(true);
    await click(choice);
    // Choosing only opens the confirm step; nothing runs yet.
    expect(handlers.onNotAGame).not.toHaveBeenCalled();
    expect(handlers.onNotPlaying).not.toHaveBeenCalled();
    expect(handlers.onIgnoreApp).not.toHaveBeenCalled();

    await click("Back");
    expect(button(choice)).toBeDefined();

    await click(choice);
    await click(confirmLabel);
    expect(handlers[handler]).toHaveBeenCalledOnce();
  },
);

it.each(["part of a game, not the game", "Not sure, just ignore it"])(
  "promises only a folder ignore for Game.exe: %s",
  async (choice) => {
    await act(() =>
      root.render(
        createElement(ReportWrongMatchDialog, {
          exeName: "Game.exe",
          gameName: "Dead Plate",
          ...handlers,
        }),
      ),
    );
    await click(choice);
    expect(document.body.textContent).toContain("Nothing is reported.");
    expect(document.body.textContent).not.toContain("community review");
    expect(button("Ignore this folder")).toBeDefined();
  },
);

it("reports nothing when the user is only unsure", async () => {
  await render(true);
  await click("Not sure, just ignore it");
  expect(document.body.textContent).toContain("Nothing is reported.");
  await click("Ignore on this PC");
  expect(handlers.onNotAGame).not.toHaveBeenCalled();
});
