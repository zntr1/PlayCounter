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

it("offers 'not playing right now' only when the caller handles it", async () => {
  await render(false);
  expect(button("not playing this right now")).toBeUndefined();
  await render(true);
  expect(button("not playing this right now")).toBeDefined();
});

it("picks a different game in one click", async () => {
  await render(true);
  await click("different game");
  expect(handlers.onDifferentGame).toHaveBeenCalledOnce();
});

it.each([
  ["isn't a game at all", "Ignore and report", "onNotAGame"],
  ["not playing this right now", "Ignore on this PC", "onNotPlaying"],
] as const)(
  "asks before ignoring: %s",
  async (choice, confirmLabel, handler) => {
    await render(true);
    await click(choice);
    // Choosing only opens the confirm step; nothing runs yet.
    expect(handlers.onNotAGame).not.toHaveBeenCalled();
    expect(handlers.onNotPlaying).not.toHaveBeenCalled();

    await click("Back");
    expect(button(choice)).toBeDefined();

    await click(choice);
    await click(confirmLabel);
    expect(handlers[handler]).toHaveBeenCalledOnce();
  },
);

it("reports nothing when the user is only unsure", async () => {
  await render(true);
  await click("not playing this right now");
  expect(document.body.textContent).toContain("Nothing is reported.");
  await click("Ignore on this PC");
  expect(handlers.onNotAGame).not.toHaveBeenCalled();
});
