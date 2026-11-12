// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../../store";
import { AchievementsView } from "../../views/AchievementsView";
import { DiscoveredView } from "../../views/DiscoveredView";
import { SoftwareView } from "../../views/SoftwareView";
import { LibraryTestShell } from "../../views/libraryTestShell";
import { findTour } from "../tourDefinitions";
import { TourOverlay } from "../TourUI";
import { boldNames as bold, expectStepRules } from "./guideRules.test.kit";

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("../../../gameDetails", () => ({
  useGameDetails: () => ({ status: "empty" }),
}));

/* The Quick tour (docs/tours-plan.md, WP7): about a minute, no exercises, the
   sidebar's order, a ring on the page for every step. */

const guide = () => findTour("core")!;
const step = (id: string) => guide().steps.find((entry) => entry.id === id)!;
const index = (id: string) =>
  guide().steps.findIndex((entry) => entry.id === id);
const a = (name: string) => `[data-tour="${name}"]`;
/** Everything a step rings: its anchor, its other targets and extra rings. */
const rings = (id: string) => [
  step(id).anchor,
  ...(step(id).anchorTargets ?? []),
  ...(step(id).additionalAnchors ?? []),
];

describe("the guide's steps", () => {
  it("are eight at most, in the order of the sidebar", () => {
    expect(guide().steps.map((entry) => entry.id)).toEqual([
      "intro",
      "now",
      "games",
      "progress",
      "discovered",
      "accounts",
      "software",
      "help",
    ]);
    expect(guide().steps.map((entry) => entry.view)).toEqual([
      "keep",
      "now",
      "games",
      "achievements",
      "discovered",
      "accounts",
      "software",
      "return",
    ]);
    expect(guide().version).toBe(3);
    expect(guide().release).toBeUndefined();
    expect(guide().kind).toBe("core");
    expect(guide().nextTourId).toBe("settings");
  });

  it("follow the rules of every guide and have no exercise", () => {
    expectStepRules(guide());
    for (const entry of guide().steps) {
      expect(entry.task, entry.id).toBeUndefined();
      expect(entry.interactive, entry.id).toBeFalsy();
    }
  });

  it("keep the ids other code depends on", () => {
    // TourUI shows the sample cards on "games"; Now Playing the sample
    // session on "now".
    expect(step("games").view).toBe("games");
    expect(step("now").anchor).toBe(a("now-playing-demo"));
    expect(step("games").anchor).toBeTruthy();
  });

  it("say that closing the window keeps PlayCounter tracking in the tray", () => {
    expect(step("intro").body).toMatch(/Closing the window/);
    expect(step("intro").body).toMatch(/tracking in the tray/);
  });

  it("ring something on the page, not only the sidebar entry", () => {
    for (const id of ["now", "games", "progress", "discovered", "accounts"])
      expect(step(id).anchor, id).not.toMatch(/data-tour="nav-/);
    // The sidebar entry rings along where the page has its own target.
    expect(step("progress").additionalAnchors).toContain(a("nav-history"));
    expect(step("discovered").additionalAnchors).toContain(a("nav-discovered"));
    expect(step("accounts").additionalAnchors).toContain(a("nav-accounts"));
  });

  it("show a card's hover buttons and the title-bar search on the sample cards", () => {
    const targets = rings("games");
    for (const name of [
      "demo-card-details",
      "demo-card-journal",
      "demo-card-log-session",
      "demo-card-more",
      "title-search",
    ])
      expect(targets, name).toContain(a(name));
    expect(bold(step("games").body)).toEqual([
      "Open details",
      "Journal",
      "Log missed session",
      "More",
    ]);
    expect(step("games").body).toMatch(/search/i);
  });

  it("put Achievements before My History in one step", () => {
    const body = step("progress").body;
    expect(bold(body)).toEqual(["Achievements", "My History"]);
    expect(body.indexOf("Achievements")).toBeLessThan(
      body.indexOf("My History"),
    );
  });

  it("name the four choices Discovered offers", () => {
    const body = step("discovered").body;
    expect(body).toMatch(/match it to a game/);
    expect(body).toMatch(/add it yourself/);
    expect(body).toMatch(/count it as software/);
    expect(body).toMatch(/ignore it/);
  });

  it("send imports to Launcher accounts, and Software only while it is on", () => {
    expect(bold(step("accounts").body)).toEqual(["Launcher accounts"]);
    expect(step("accounts").body).toMatch(/import/i);
    expect(step("software").optional).toBe(true);
    expect(rings("software")).toContain(a("nav-software"));
    expect(bold(step("software").body)).toEqual(["Software"]);
  });

  it("end on the Help button and say where the guides are", () => {
    const last = step("help");
    expect(last.anchor).toBe(a("help"));
    expect(bold(last.body)).toEqual(["Help and tutorials"]);
    expect(last.body).toMatch(/guide/);
    expect(last.body).toMatch(/Settings/);
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

describe("a fresh profile", () => {
  it("shows the sample cards' hover buttons on the games step", async () => {
    useAppStore.setState({ activeView: "games" });
    await act(async () => {
      useAppStore.getState().startTour("core");
      useAppStore.getState().goToTourStep(index("games"));
      root.render(
        <>
          <LibraryTestShell />
          <TourOverlay />
        </>,
      );
    });
    await wait();
    for (const name of [
      "demo-card-details",
      "demo-card-journal",
      "demo-card-log-session",
      "demo-card-more",
    ])
      expect(find(a(name)), name).not.toBeNull();
    expect(find(a("title-search"))).not.toBeNull();
  });

  it("has the page targets of the steps that ring a page", async () => {
    for (const [View, name] of [
      [AchievementsView, "achievements-hero"],
      [DiscoveredView, "discovered-wizard"],
    ] as const) {
      await act(async () => {
        root.render(<View />);
      });
      await wait(50);
      expect(find(a(name)), name).not.toBeNull();
    }
    useAppStore.getState().setTrackTools?.(true);
    await act(async () => {
      root.render(<SoftwareView />);
    });
    await wait(50);
    expect(find(a("software-intro"))).not.toBeNull();
  });
});
