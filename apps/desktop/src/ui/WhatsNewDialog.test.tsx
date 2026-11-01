// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeReleaseNotes } from "../releaseNotes";
import { tours } from "./tour/tourDefinitions";
import { WhatsNewDialog } from "./WhatsNewDialog";

// Shaped like 1.5.0: two pages with pictures, then points without.
const [current] = sanitizeReleaseNotes([
  {
    version: "1.5.0",
    headline: "See your achievements",
    highlights: [
      {
        title: "Your achievements, game by game",
        text: "See what you unlocked on Steam, Xbox and Epic Games.",
        hint: "Right-click a game in My Games → Achievements",
        image: "achievements",
      },
      { title: "Sign in once", text: "Kept sign-ins.", image: "accounts" },
      { title: "Less CPU", text: "About a sixth of the CPU." },
      "A line written the old way",
    ],
  },
]);
// Written before pictures existed: headline and plain lines.
const [older] = sanitizeReleaseNotes([
  {
    version: "1.4.3",
    headline: "Rate your games and fine-tune your history.",
    highlights: ["Feature: tier ratings from S to F.", "Feature: a timer."],
  },
]);
const images = {
  "1.5.0/achievements": "/assets/achievements.webp",
  "1.5.0/accounts": "/assets/accounts.webp",
};

let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();
const onStartTour = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  onClose.mockReset();
  onStartTour.mockReset();
  vi.unstubAllGlobals();
});

async function open(releases = [current]) {
  await act(async () =>
    root.render(
      <WhatsNewDialog
        releases={releases}
        images={images}
        onClose={onClose}
        onStartTour={onStartTour}
      />,
    ),
  );
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const text = () => dialog().textContent ?? "";
const button = (label: string) =>
  [...dialog().querySelectorAll("button")].find(
    (item) =>
      item.textContent?.trim() === label ||
      item.getAttribute("aria-label") === label,
  );
async function click(label: string) {
  const target = button(label);
  expect(target, label).toBeDefined();
  await act(async () => target!.click());
}
async function press(key: string) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("one feature per page", () => {
  it("shows each point with a picture on its own page, then Also new", async () => {
    await open();
    expect(dialog().querySelector("h2")?.textContent).toBe(
      "What's new in 1.5.0",
    );
    expect(text()).toContain("Your achievements, game by game");
    expect(text()).toContain("Right-click a game in My Games → Achievements");
    expect(dialog().querySelector("img")?.getAttribute("src")).toBe(
      "/assets/achievements.webp",
    );
    expect(text()).toContain("1 of 3");
    expect(text()).not.toContain("Sign in once");
    expect(button("Back")).toBeUndefined();

    await click("Next");
    expect(text()).toContain("Sign in once");
    expect(dialog().querySelector("img")?.getAttribute("src")).toBe(
      "/assets/accounts.webp",
    );
    await click("Back");
    expect(text()).toContain("Your achievements, game by game");

    await click("3 of 3");
    expect(text()).toContain("Also new in 1.5.0");
    expect(text()).toContain("Less CPU");
    expect(text()).toContain("About a sixth of the CPU.");
    expect(text()).toContain("A line written the old way");
    expect(button("Next")).toBeUndefined();
    expect(button("Got it")).toBeDefined();
  });

  it("turns the pages with the arrow keys", async () => {
    await open();
    await press("ArrowLeft");
    expect(text()).toContain("1 of 3");
    await press("ArrowRight");
    expect(text()).toContain("Sign in once");
    await press("ArrowRight");
    expect(text()).toContain("Also new in 1.5.0");
    await press("ArrowRight");
    expect(text()).toContain("3 of 3");
    await press("ArrowLeft");
    expect(text()).toContain("Sign in once");
  });

  it("closes with Got it on the last page", async () => {
    await open();
    await click("3 of 3");
    expect(onClose).not.toHaveBeenCalled();
    await click("Got it");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a version without pictures as its headline and list on one page", async () => {
    await open([older]);
    expect(dialog().querySelector("h2")?.textContent).toBe(
      "What's new in 1.4.3",
    );
    expect(text()).toContain("Rate your games and fine-tune your history.");
    expect(text()).toContain("Feature: tier ratings from S to F.");
    expect(text()).toContain("Feature: a timer.");
    expect(text()).not.toContain("1 of 1");
    expect(button("Next")).toBeUndefined();
    expect(button("Got it")).toBeDefined();
  });
});

describe("updates you skipped", () => {
  const guide = () => tours().find((tour) => tour.release === "1.4.3")!;
  // The button shows the guide's title (and maybe its length).
  async function startGuide() {
    const target = [...dialog().querySelectorAll("button")].find((item) =>
      item.textContent?.includes(guide().title),
    );
    expect(target, guide().title).toBeDefined();
    await act(async () => target!.click());
  }

  it("come last, folded, with the guide of their version", async () => {
    await open([current, older]);
    expect(dialog().querySelector("h2")?.textContent).toBe(
      "What's new since your last update",
    );
    expect(text()).toContain("1 of 4");
    await click("4 of 4");
    expect(text()).toContain("Also since your last update");
    expect(text()).toContain("1.4.3");
    expect(text()).toContain("Rate your games and fine-tune your history.");
    expect(text()).not.toContain("Feature: tier ratings from S to F.");

    await click("Show changes");
    expect(text()).toContain("Feature: tier ratings from S to F.");
    await click("Hide changes");
    expect(text()).not.toContain("Feature: tier ratings from S to F.");

    await startGuide();
    expect(onStartTour).toHaveBeenCalledWith(guide().id);
  });

  it("offer the newest version's own guides on its last page", async () => {
    const [withGuide] = sanitizeReleaseNotes([
      { ...current, version: "1.4.3" },
    ]);
    await open([withGuide]);
    expect(text()).not.toContain("Try the new features");
    await click("3 of 3");
    expect(text()).toContain("Try the new features");
    await startGuide();
    expect(onStartTour).toHaveBeenCalledWith(guide().id);
  });
});
