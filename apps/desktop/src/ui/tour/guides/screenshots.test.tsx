// @vitest-environment happy-dom
/* "Screenshots": the sample history shows two pictures on one session, a
   click opens the viewer, a caption finishes the step, and nothing reaches
   the player's real pictures or Rust. */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => []),
  convertFileSrc: (value: string) => `asset://${value}`,
}));

import { invoke } from "@tauri-apps/api/core";
import { useScreenshots } from "../../../screenshots";
import { useAppStore } from "../../../store";
import { HISTORY_SAMPLE } from "../tourHistorySample";
import { screenshotsGuide } from "./screenshots";
import { boldNames, expectStepRules, stepOf } from "./guideRules.test.kit";
import {
  all,
  click,
  control,
  goTo,
  mountHistory,
  ownSession,
  frame,
  press,
  q,
  row,
  startGuide,
  stepId,
  target,
  type,
  unmountHistory,
} from "./historyPractice.test.util";
import { NEXT_RELEASE } from "./shared";

beforeEach(mountHistory);
afterEach(unmountHistory);

const guide = screenshotsGuide();
const picture = (n: number) =>
  q(`${'[data-tour="demo-history-screenshots"]'} li:nth-child(${n}) button`);

describe("Screenshots: the guide", () => {
  it("keeps the rules every step follows", () => {
    expectStepRules(guide);
  });

  it("is new, has no simulation, and never suggests a key", () => {
    expect(guide.release).toBe(NEXT_RELEASE);
    expect(guide.simulation).toBeUndefined();
    const text = guide.steps.map((s) => `${s.body} ${s.task ?? ""}`).join(" ");
    expect(text).not.toMatch(/<kbd>(?!Enter)/);
    expect(text).toMatch(/No key is set until you pick one/);
    expect(boldNames(stepOf(guide, "keys").body)).toEqual([
      "Take a screenshot",
      "Screenshot with caption",
    ]);
  });
});

describe("Screenshots: the sample history", () => {
  it("shows two pictures on the sample session, the second with a caption", async () => {
    await startGuide("screenshots");
    // The first step rings nothing, but the sample history is behind it.
    expect(row(HISTORY_SAMPLE.withPictures)).not.toBeNull();
    await goTo("pictures");
    expect(all('[data-tour="demo-history-screenshots"] li')).toHaveLength(2);
    expect(picture(2).querySelector("[data-caption-mark]")).not.toBeNull();
    expect(picture(1).querySelector("[data-caption-mark]")).toBeNull();
    expect(target().getAttribute("data-tour")).toBe("demo-history-screenshots");
  });

  it("a click on a picture opens the viewer and finishes the step", async () => {
    await startGuide("screenshots", "pictures");
    await click(picture(1));
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(stepId()).toBe("viewer");
    expect(target().textContent).toContain("Add a caption");
  });

  it("keeps the picture the player opened, also the one with a caption", async () => {
    await startGuide("screenshots", "pictures");
    await click(picture(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(stepId()).toBe("viewer");
    // Not swapped for the first picture: its caption is still in view.
    expect(target().textContent).toContain("Finally down on the third try");
    expect(target().textContent).not.toContain("Add a caption");
  });

  it("finishes when the opened picture's caption is changed", async () => {
    await startGuide("screenshots", "pictures");
    await click(picture(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)));
    await click(target());
    await type(q<HTMLInputElement>('input[aria-label="Caption"]'), "Third try");
    await press(q('input[aria-label="Caption"]'), "Enter");
    expect(stepId()).toBe("folder");
  });

  it("the viewer step opens the viewer itself, from anywhere", async () => {
    await startGuide("screenshots", "viewer");
    expect(target().textContent).toContain("Add a caption");
    await goTo("intro", true);
    expect(
      document.querySelector('[aria-labelledby="screenshot-viewer-title"]'),
    ).toBeNull();
    await goTo("viewer", true);
    expect(target().textContent).toContain("Add a caption");
  });

  it("a caption finishes the step, and stays on the sample", async () => {
    useAppStore.setState({ recentSessions: [ownSession] });
    const own = useAppStore.getState().recentSessions;
    await startGuide("screenshots", "viewer");
    await click(control("Add a caption"));
    await type(q<HTMLInputElement>('input[aria-label="Caption"]'), "Sunset");
    await press(q('input[aria-label="Caption"]'), "Enter");
    expect(stepId()).toBe("folder");
    await goTo("pictures", true);
    expect(useScreenshots.getState().files).toEqual([]);
    expect(useAppStore.getState().recentSessions).toBe(own);
    expect(vi.mocked(invoke).mock.calls.map((call) => call[0])).not.toContain(
      "screenshot_caption",
    );
  });

  it("deleting in the viewer touches no file", async () => {
    await startGuide("screenshots", "viewer");
    await act(() =>
      (
        document.querySelector(
          'button[aria-label="Move to the Recycle Bin"]',
        ) as HTMLElement
      ).click(),
    );
    expect(vi.mocked(invoke).mock.calls.map((call) => call[0])).not.toContain(
      "screenshot_delete",
    );
  });
});
