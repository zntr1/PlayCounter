// @vitest-environment happy-dom
/* "Find replies to your feedback": a sample reply opens under the bell from
   the second step on, each step rings the one thing its text names, and the
   sample reply sends the player to a menu item that exists. */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../tracker");
vi.mock("../../../platform", () => ({
  currentPlatform: () => "windows",
  detectPlatformFrom: () => "windows",
}));

import { applyLanguage } from "../../../i18n";
import dialogsEnglish from "../../../locales/en/dialogs.json";
import { useAppStore } from "../../../store";
import { NotificationBell } from "../../NotificationBell";
import { findTour } from "../tourDefinitions";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  applyLanguage("en");
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

const guide = () => findTour("feedback-replies")!;
const stepIndex = (id: string) =>
  guide().steps.findIndex((step) => step.id === id);
const panel = () =>
  container.querySelector('[data-tour="demo-feedback-panel"]');
const bold = (text: string) =>
  [...text.matchAll(/<b>([\s\S]*?)<\/b>/g)].map((match) => match[1]);

async function start() {
  await act(async () => {
    root.render(<NotificationBell />);
    useAppStore.getState().startTour("feedback-replies");
  });
}
const goTo = (id: string) =>
  act(async () => useAppStore.getState().goToTourStep(stepIndex(id), true));

describe("the sample reply", () => {
  it("stays closed on the first step, which is for reading", async () => {
    await start();
    expect(guide().steps[0].anchor).toBeUndefined();
    expect(panel()).toBeNull();
  });

  it("is open on every later step, also when the player jumps there", async () => {
    await start();
    for (const { id } of guide().steps.slice(1).reverse()) {
      await goTo(id);
      expect(panel(), id).not.toBeNull();
    }
    await goTo("send");
    expect(panel()).toBeNull();
  });

  it("closes with the guide", async () => {
    await start();
    await goTo("bell");
    await act(async () => useAppStore.getState().endTour("completed"));
    expect(panel()).toBeNull();
  });

  it("sends the player to Journal, the item the card menu has", async () => {
    await start();
    await goTo("bell");
    const reply = container.querySelector(
      '[data-tour="demo-feedback-reply"]',
    )!.textContent!;
    expect(reply).toContain("choose Journal");
    expect(reply).not.toMatch(/choose Playthroughs/);
    // The card menu's item and the Journal's button, in the app's words.
    expect(reply).toContain(dialogsEnglish["Journal"]);
    expect(reply).toContain(`click ${dialogsEnglish["Add playthrough"]}`);
  });

  it("names the menu item in the app's language, whatever a translation says", async () => {
    applyLanguage("de");
    await start();
    await goTo("bell");
    const reply = container.querySelector(
      '[data-tour="demo-feedback-reply"]',
    )!.textContent!;
    const { default: dialogsGerman } =
      await import("../../../locales/de/dialogs.json");
    expect(reply).toContain(dialogsGerman["Journal"]);
    expect(reply).toContain(dialogsGerman["Add playthrough"]);
  });

  it("leaves the player's own notifications and unread count alone", async () => {
    const markAllNotificationsRead = vi.fn();
    const notifications = [
      {
        id: "real",
        kind: "feedback-reply" as const,
        title: "Real reply",
        body: "Keep this",
        createdAt: new Date().toISOString(),
      },
    ];
    useAppStore.setState({ notifications, markAllNotificationsRead });
    await start();
    await goTo("context");
    expect(container.textContent).not.toContain("Keep this");
    expect(markAllNotificationsRead).not.toHaveBeenCalled();
    expect(useAppStore.getState().notifications).toEqual(notifications);
  });
});

describe("the rings", () => {
  it("sit on the bell, then on the quoted message, then on the answer", async () => {
    await start();
    const rings: Element[] = [];
    for (const [id, name] of [
      ["bell", "notifications-bell"],
      ["context", "demo-feedback-original"],
      ["reply", "demo-feedback-reply"],
    ]) {
      await goTo(id);
      const step = guide().steps[stepIndex(id)];
      expect(step.anchor, id).toBe(`[data-tour="${name}"]`);
      const ring = container.querySelector(step.anchor!);
      expect(ring, id).not.toBeNull();
      rings.push(ring!);
      // The card stays clear of the open panel.
      expect(step.positionAnchor, id).toBe('[data-tour="demo-feedback-panel"]');
    }
    // The quote and the answer are two blocks: neither ring holds the other.
    expect(rings[1].contains(rings[2])).toBe(false);
    expect(rings[2].contains(rings[1])).toBe(false);
  });

  it("point at something the text names", async () => {
    await start();
    for (const { id, body } of guide().steps.slice(1)) {
      await goTo(id);
      for (const label of bold(body))
        expect(container.textContent, `${id}: ${label}`).toContain(label);
    }
  });
});
