// @vitest-environment happy-dom
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gameArt from "../../../gameArt";
import { useAppStore } from "../../../store";
import * as tracker from "../../../tracker";
import { LibraryTestShell } from "../../views/libraryTestShell";
import { findTour } from "../tourDefinitions";
import { TourOverlay } from "../TourUI";
import { boldNames as bold, expectStepRules } from "./guideRules.test.kit";
import { NEXT_RELEASE } from "./shared";

vi.mock("../../../tracker");
vi.mock("../../../gameArt");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

/* "Covers and banners" (docs/tours-plan.md, WP6): the Appearance menu with
   choose, upload, paste and restore, banners, and Pin to banner. The picker
   shows bundled pictures: no search, nothing saved. */

const guide = () => findTour("covers-banners")!;
const step = (id: string) => guide().steps.find((entry) => entry.id === id)!;
const index = (id: string) =>
  guide().steps.findIndex((entry) => entry.id === id);
const a = (name: string) => `[data-tour="${name}"]`;

describe("the guide's steps", () => {
  it("go from the Appearance menu to the banner", () => {
    expect(guide().steps.map((entry) => entry.id)).toEqual([
      "intro",
      "appearance",
      "choose-cover",
      "other-ways",
      "restore",
      "banner",
      "pin",
      "finish",
    ]);
    expect(guide().version).toBe(2);
    expect(guide().release).toBe(NEXT_RELEASE);
    expect(guide().demoGame).toBe(true);
  });

  it("follow the rules of every guide", () => {
    expectStepRules(guide());
  });

  it("name the menu entries as the real card does", () => {
    expect(bold(step("appearance").task!)).toEqual(["Appearance"]);
    expect(bold(step("choose-cover").task!)).toEqual(["Choose cover…"]);
    expect(bold(step("other-ways").body)).toEqual([
      "Upload cover",
      "Paste Cover",
    ]);
    expect(bold(step("restore").task!)).toEqual(["Restore Cover"]);
    expect(bold(step("banner").task!)).toEqual(["Choose banner…"]);
    expect(bold(step("pin").task!)).toEqual(["Pin to banner"]);
  });

  it("say the picker shows sample pictures instead of searching", () => {
    expect(step("choose-cover").body).toMatch(/SteamGridDB/);
    expect(step("choose-cover").body).toMatch(/sample pictures/);
  });

  it("ring the entry once its flyout is open, the trigger before it is", () => {
    for (const [id, entry] of [
      ["choose-cover", "demo-menu-choose-cover"],
      ["restore", "demo-menu-restore-cover"],
      ["banner", "demo-menu-choose-banner"],
    ] as const) {
      const targets = step(id).anchorTargets!;
      expect(targets.indexOf(a(entry)), id).toBeGreaterThanOrEqual(0);
      expect(targets.indexOf(a(entry)), id).toBeLessThan(
        targets.indexOf(a("demo-menu-appearance")),
      );
      expect(targets.indexOf(a(entry)), id).toBeLessThan(
        targets.indexOf(a("demo-appearance-menu")),
      );
    }
  });

  it("finish each exercise by itself", () => {
    for (const id of ["choose-cover", "restore", "banner", "pin"])
      expect(step(id).advanceOn, id).toEqual({
        type: "event",
        name: "demo.step-completed",
      });
    expect(step("appearance").advanceOn).toEqual({
      type: "anchor-present",
      selector: a("demo-appearance-menu"),
    });
  });

  it("have bundled pictures to show", () => {
    for (const file of [
      "sample-cover-1.svg",
      "sample-cover-2.svg",
      "sample-cover-3.svg",
      "sample-banner-1.svg",
      "sample-banner-2.svg",
    ])
      expect(
        existsSync(resolve(__dirname, "../../../../public/tour", file)),
        file,
      ).toBe(true);
  });
});

let root: Root;
let container: HTMLDivElement;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fetchSpy = vi.fn(() => Promise.reject(new Error("no network in a guide")));
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState({ activeView: "games" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const wait = (ms = 250) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const find = (selector: string) =>
  document.querySelector<HTMLElement>(selector);
const stepNow = () =>
  guide().steps[useAppStore.getState().activeTour!.stepIndex].id;
const cardCover = () =>
  find(`${a("demo-game-card")} img.game-card-cover-image`)?.getAttribute("src");

async function click(selector: string) {
  const element = find(selector);
  expect(element, `missing ${selector}`).not.toBeNull();
  await act(async () => element!.click());
}

async function start(at: string) {
  await act(async () => {
    useAppStore.getState().startTour("covers-banners");
    useAppStore.getState().goToTourStep(index(at));
    root.render(
      <>
        <LibraryTestShell />
        <TourOverlay />
      </>,
    );
  });
  await wait();
}

/** Nothing was looked up, uploaded or saved. */
function expectNothingSaved() {
  expect(gameArt.searchArt).not.toHaveBeenCalled();
  expect(gameArt.artForGame).not.toHaveBeenCalled();
  expect(gameArt.downloadArtImage).not.toHaveBeenCalled();
  expect(tracker.setCustomGameCover).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(useAppStore.getState().customCoverArt).toEqual({});
  expect(useAppStore.getState().customHeroArt).toEqual({});
}

const pickers = () => [
  ...document.querySelectorAll<HTMLButtonElement>(
    `${a("demo-art-picker")} button[aria-label^="Use this"]`,
  ),
];

describe("the walk through the guide", () => {
  it("opens the Appearance flyout on a click and moves on", async () => {
    await start("appearance");
    // The step opened the card's menu itself, but not the flyout: that is
    // the player's task, so the step waits for it.
    expect(find(a("demo-menu-appearance"))).not.toBeNull();
    expect(find(a("demo-appearance-menu"))).toBeNull();
    expect(stepNow()).toBe("appearance");
    await click(a("demo-menu-appearance"));
    await wait(200);
    expect(stepNow()).toBe("choose-cover");
  });

  it("shows bundled sample covers in the picker and puts the pick on the sample card only", async () => {
    await start("choose-cover");
    const before = cardCover();
    await click(a("demo-menu-choose-cover"));
    await wait(200);
    expect(find(a("demo-art-picker"))).not.toBeNull();
    const covers = pickers();
    expect(covers.length).toBeGreaterThanOrEqual(3);
    for (const cover of covers)
      expect(cover.querySelector("img")!.getAttribute("src")).toMatch(
        /^\/tour\/sample-cover-\d\.svg$/,
      );
    await act(async () => covers[1].click());
    await wait(200);
    expect(find(a("demo-art-picker"))).toBeNull();
    expect(cardCover()).toBe("/tour/sample-cover-2.svg");
    expect(cardCover()).not.toBe(before);
    expect(stepNow()).toBe("other-ways");
    expectNothingSaved();
  });

  it("shows Restore Cover when the step is entered from anywhere, and restores", async () => {
    await start("restore");
    const before = cardCover();
    expect(find(a("demo-menu-restore-cover"))).not.toBeNull();
    await click(a("demo-menu-restore-cover"));
    await wait(200);
    expect(cardCover()).not.toBe(before);
    expect(cardCover()).toContain("world-of-warcraft-cover");
    expect(stepNow()).toBe("banner");
    expectNothingSaved();
  });

  it("opens the picker on the banner tab with sample banners", async () => {
    await start("banner");
    await click(a("demo-menu-choose-banner"));
    await wait(200);
    const banners = pickers();
    expect(banners.length).toBeGreaterThanOrEqual(2);
    for (const banner of banners)
      expect(banner.querySelector("img")!.getAttribute("src")).toMatch(
        /^\/tour\/sample-banner-\d\.svg$/,
      );
    await act(async () => banners[0].click());
    await wait(200);
    expect(stepNow()).toBe("pin");
    expectNothingSaved();
  });

  it("closes a picker left open when the player skips the step", async () => {
    await start("choose-cover");
    await click(a("demo-menu-choose-cover"));
    await wait(200);
    expect(find(a("demo-art-picker"))).not.toBeNull();
    await act(async () =>
      useAppStore.getState().goToTourStep(index("other-ways")),
    );
    await wait(200);
    expect(find(a("demo-art-picker"))).toBeNull();
  });

  it("finishes Pin to banner with the sample's answer", async () => {
    await start("pin");
    await click(a("demo-menu-pin-banner"));
    await wait(200);
    expect(stepNow()).toBe("finish");
    expectNothingSaved();
  });
});
