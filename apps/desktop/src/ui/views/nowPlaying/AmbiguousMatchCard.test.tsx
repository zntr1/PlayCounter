// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { dismissAmbiguousMatch, reportNegativeMatch } from "../../../tracker";
import { AmbiguousMatchCard } from "./AmbiguousMatchCard";

vi.mock("../../../tracker");

// The unidentified-process card offers the same "not a game" choices as
// Report wrong match - an app (counted or ignored), part of a game, not
// sure - with the same confirm steps, instead of its own one-click buttons.

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

async function renderCard() {
  await act(() =>
    root.render(
      <AmbiguousMatchCard
        exeName="helper.exe"
        exePath={null}
        candidates={[]}
        elapsedSeconds={60}
        ended={false}
      />,
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
  await act(async () => found!.click());
}

it("opens the report choices instead of reporting in one click", async () => {
  await renderCard();
  expect(button("Ignore on this PC")).toBeUndefined();

  await click("Not a game…");

  const text = document.body.textContent ?? "";
  expect(text).toContain("What is it?");
  expect(button("an app, count its time")).toBeDefined();
  expect(button("an app, ignore it")).toBeDefined();
  expect(button("part of a game, not the game")).toBeDefined();
  expect(button("Not sure, just ignore it")).toBeDefined();
  // No game yet: nothing to call wrong or to take a file away from.
  expect(button("different game")).toBeUndefined();
  expect(button("doesn't belong")).toBeUndefined();
  expect(reportNegativeMatch).not.toHaveBeenCalled();
});

it("reports part of a game only after the confirm step", async () => {
  vi.mocked(reportNegativeMatch).mockResolvedValue({
    localBlockApplied: true,
    ignoreFileUpdated: true,
    report: "recorded",
  });
  await renderCard();
  await click("Not a game…");
  await click("part of a game, not the game");
  expect(reportNegativeMatch).not.toHaveBeenCalled();

  await click("Ignore and report");

  expect(reportNegativeMatch).toHaveBeenCalledWith("helper.exe", [null]);
});

it("ignores without a report when the user is not sure", async () => {
  vi.mocked(dismissAmbiguousMatch).mockResolvedValue({
    localBlockApplied: true,
    ignoreFileUpdated: true,
  });
  await renderCard();
  await click("Not a game…");
  await click("Not sure, just ignore it");
  await click("Ignore on this PC");

  expect(dismissAmbiguousMatch).toHaveBeenCalledWith("helper.exe");
  expect(reportNegativeMatch).not.toHaveBeenCalled();
});
