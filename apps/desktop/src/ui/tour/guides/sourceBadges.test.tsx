// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { LibraryTestShell } from "../../views/libraryTestShell";
import { findTour } from "../tourDefinitions";
import { TourOverlay } from "../TourUI";
import { boldNames as bold, expectStepRules } from "./guideRules.test.kit";

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));

/* "Understand game badges" (docs/tours-plan.md, WP4): the three match badges
   first, the launcher and emulator badges after, PlayStation included, and
   every ring on something that is in view. */

const guide = () => findTour("source-badges")!;
const step = (id: string) => guide().steps.find((entry) => entry.id === id)!;
const index = (id: string) =>
  guide().steps.findIndex((entry) => entry.id === id);
const a = (name: string) => `[data-tour="${name}"]`;

describe("the guide's steps", () => {
  it("show the match badges first and the launcher and emulator badges after", () => {
    expect(guide().steps.map((entry) => entry.id)).toEqual([
      "intro",
      "community",
      "igdb",
      "custom",
      "where",
      "origins",
    ]);
    expect(guide().version).toBe(3);
    expect(guide().release).toBeUndefined();
    expect(guide().demoGame).toBe(true);
  });

  it("follow the rules of every guide", () => {
    expectStepRules(guide());
  });

  it("promise nothing the next steps do not show", () => {
    expect(step("intro").body).not.toMatch(/three ways/i);
    expect(step("intro").body).toMatch(/Community, IGDB and Custom/);
  });

  it("explain the clock and the check on a custom match sent to the community", () => {
    const body = step("custom").body;
    expect(body).toMatch(/clock/);
    expect(body).toMatch(/waiting to be reviewed/);
    expect(body).toMatch(/check/);
    expect(body).toMatch(/approved/);
  });

  it("say where badges sit, that hovering explains them and that Customize hides them", () => {
    const where = step("where");
    expect(where.body).toMatch(/top left/);
    expect(where.body).toMatch(/pointer|hover/i);
    expect(bold(where.body)).toEqual([
      "Customize",
      "Card details",
      "File match info",
      "Source badges",
    ]);
    expect(where.anchor).toBe(a("library-customize"));
  });

  it("name PlayStation among the launchers, in the real app", () => {
    expect(step("origins").body).toMatch(/PlayStation/);
    expect(step("origins").anchor).toBe(a("demo-launcher-examples"));
  });

  it("ring only panel badges that are always in view, never the card's 29 px seal", () => {
    for (const id of ["community", "igdb", "custom"])
      expect(step(id).anchor, id).toMatch(/demo-legend-/);
  });
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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
});

const wait = (ms = 250) =>
  act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const find = (selector: string) =>
  document.querySelector<HTMLElement>(selector);

async function start(at: string) {
  await act(async () => {
    useAppStore.getState().startTour("source-badges");
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

describe("the sample panel", () => {
  it("has every badge a step rings", async () => {
    await start("intro");
    for (const entry of guide().steps)
      expect(
        find(entry.anchor!),
        `${entry.id}: ${entry.anchor}`,
      ).not.toBeNull();
  });

  it("lists the match badges before the launcher badges", async () => {
    await start("intro");
    const match = find(a("demo-match-examples"))!;
    const launchers = find(a("demo-launcher-examples"))!;
    expect(
      match.compareDocumentPosition(launchers) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const name of ["Community", "IGDB", "Custom"])
      expect(match.textContent, name).toContain(name);
  });

  it("shows the PlayStation badge next to the other launchers, and an emulator", async () => {
    await start("origins");
    const text = find(a("demo-launcher-examples"))!.textContent!;
    for (const name of [
      "Steam",
      "Xbox",
      "Battle.net",
      "Epic Games",
      "GOG",
      "PlayStation",
      "Dolphin",
    ])
      expect(text, name).toContain(name);
  });

  it("shows a custom match as it is sent (clock) and approved (check)", async () => {
    await start("custom");
    const custom = find(a("demo-legend-custom"))!;
    const labels = [...custom.querySelectorAll("[title]")].map((element) =>
      element.getAttribute("title"),
    );
    expect(labels.some((title) => /waiting to be reviewed/.test(title!))).toBe(
      true,
    );
    expect(
      labels.some((title) => /community approved this match/.test(title!)),
    ).toBe(true);
  });
});
