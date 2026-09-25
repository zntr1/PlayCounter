// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../../store";
import { NotificationBell } from "../NotificationBell";
import { LibraryTourPractice } from "./LibraryTourPractice";
import { HelpButton, TourOverlay } from "./TourUI";
import { TourPracticeSurface } from "./TourPracticeSurface";
import { removeHistorySession, selectAmbiguousMatch } from "../../tracker";
import { TOURS, findTour } from "./tourDefinitions";
import { findTourElement, findTourTarget } from "./tourTargetRect";
import { readFileSync } from "node:fs";

vi.mock("../../tracker");
vi.mock("../../platform", () => ({ currentPlatform: () => "windows" }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
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

function Harness({ overlay = false }: { overlay?: boolean }) {
  const active = useAppStore((s) => s.activeTour);
  const tour = active ? findTour(active.tourId) : undefined;
  return (
    <>
      {active && tour?.simulation ? (
        <TourPracticeSurface
          key={tour.id}
          tour={tour}
          stepId={tour.steps[active.stepIndex].id}
        />
      ) : null}
      {active && tour?.practice ? (
        <LibraryTourPractice
          key={tour.id}
          tourId={tour.id}
          stepId={tour.steps[active.stepIndex].id}
        />
      ) : null}
      {overlay ? <TourOverlay /> : null}
    </>
  );
}

it.each(TOURS.filter((tour) => tour.practice))(
  "prepares every target in $id when exercises are skipped",
  async (tour) => {
    await act(() => {
      root.render(<Harness />);
      useAppStore.getState().startTour(tour.id);
    });
    for (let index = 0; index < tour.steps.length; index++) {
      await act(() => useAppStore.getState().goToTourStep(index));
      const step = tour.steps[index];
      if (step.anchor) expect(findTourTarget(step), step.id).not.toBeNull();
    }
    // Tracking can continue while a guide is open. Exiting must not restore
    // a snapshot that erases a session completed during the exercise.
    const before = [
      {
        id: 42,
        gameId: 42,
        gameName: "Played during the guide",
        exeName: "real.exe",
        startedAt: "2026-09-15T10:00:00Z",
        endedAt: "2026-09-15T10:01:00Z",
        durationSeconds: 60,
      },
    ];
    useAppStore.setState({ recentSessions: before });
    await act(() => useAppStore.getState().endTour("completed"));
    expect(
      document.querySelector('[data-tour="demo-library-stage"]'),
    ).toBeNull();
    expect(
      document.querySelector('[data-tour="demo-library-modal"]'),
    ).toBeNull();
    expect(useAppStore.getState().recentSessions).toEqual(before);
    expect(useAppStore.getState().gameJournals).toEqual({});
  },
);

function currentStep() {
  const active = useAppStore.getState().activeTour!;
  return findTour(active.tourId)!.steps[active.stepIndex];
}

function target() {
  const element = findTourTarget(currentStep());
  expect(element, `missing target for ${currentStep().id}`).not.toBeNull();
  return element!;
}

async function frame() {
  await act(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

async function goTo(stepId: string) {
  const tour = findTour(useAppStore.getState().activeTour!.tourId)!;
  const index = tour.steps.findIndex((step) => step.id === stepId);
  expect(index).toBeGreaterThanOrEqual(0);
  await act(() => useAppStore.getState().goToTourStep(index));
  await frame();
}

async function start(tourId: string, stepId: string) {
  await act(() => {
    root.render(<Harness overlay />);
    useAppStore.getState().startTour(tourId);
  });
  await goTo(stepId);
}

it.each(["favorite", "fill-shelf"])(
  "does not switch the card highlight to GTA V while dragging WoW in %s",
  async (stepId) => {
    const stylesheet = document.createElement("style");
    const styles = readFileSync("src/styles.css", "utf8");
    stylesheet.textContent = styles.match(
      /\.game-library-card\[data-library-drag-source\]\s*\{[^}]*\}/,
    )![0];
    document.head.append(stylesheet);
    try {
      await start("organize-library", stepId);
      const cardSelector = currentStep().additionalAnchors![0];
      const wow = findTourElement(cardSelector)!;
      expect(wow.textContent).toContain("World of Warcraft");
      const shelf = target();
      const pointer = async (type: string, element: EventTarget = window) => {
        await act(() => {
          element.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              cancelable: true,
              pointerId: 1,
              pointerType: "mouse",
              isPrimary: true,
              button: 0,
              buttons: type === "pointerup" ? 0 : 1,
              clientX: type === "pointerdown" ? 100 : 140,
              clientY: 200,
            }),
          );
        });
      };
      for (const ending of ["pointercancel", "pointerup"]) {
        await pointer("pointerdown", wow);
        await pointer("pointermove");
        expect(wow.hasAttribute("data-library-drag-source")).toBe(true);
        expect(getComputedStyle(wow).visibility).toBe("hidden");
        expect(
          document.querySelector(".library-game-drag-preview"),
        ).not.toBeNull();
        // Only the destination stays highlighted during pickup/return. The
        // hidden source must never be replaced by a different visible game.
        expect(findTourElement(cardSelector)).toBeNull();
        expect(target()).toBe(shelf);
        vi.spyOn(document, "elementFromPoint").mockReturnValue(shelf);
        await pointer(ending);
        await frame();
        expect(findTourElement(cardSelector)).toBe(wow);
        expect(document.querySelector(".library-game-drag-preview")).toBeNull();
      }
      expect(
        document.querySelector('[data-tour="demo-library-result"]')
          ?.textContent,
      ).toContain("Added to");
      expect(useAppStore.getState().gameJournals).toEqual({});
    } finally {
      stylesheet.remove();
    }
  },
);

async function enter(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.each(["submit", "button"])(
  "advances from New shelf to filling the shelf after %s",
  async (method) => {
    await start("organize-library", "create-shelf");
    expect(target().tagName).toBe("BUTTON");
    expect(target().textContent).toBe("New shelf");
    expect(document.activeElement).toBe(target());
    await act(() => target().click());
    await frame();
    const name = target() as HTMLInputElement;
    expect(name.getAttribute("aria-label")).toBe("Shelf name");
    expect(document.activeElement).toBe(name);
    await act(() => name.form!.requestSubmit());
    expect(currentStep().id).toBe("create-shelf");
    await enter(name, "Weekend test");
    await act(() => {
      if (method === "submit") name.form!.requestSubmit();
      else
        document
          .querySelector<HTMLButtonElement>('[data-tour="demo-shelf-save"]')!
          .click();
    });
    expect(
      document.querySelector('[data-tour="demo-shelf-editor"]'),
    ).toBeNull();
    expect(currentStep().id).toBe("fill-shelf");
    await frame();
    expect(target().tagName).toBe("BUTTON");
    expect(target().textContent).toContain("Weekend test");
    expect(useAppStore.getState().personalShelves).toEqual([]);
    // Going back must wait for another creation, not auto-advance because a
    // shelf already exists. Cancelling its editor must not complete the step.
    await goTo("create-shelf");
    await act(() => target().click());
    await act(() => {
      target().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(
      document.querySelector('[data-tour="demo-shelf-editor"]'),
    ).toBeNull();
    await act(
      () => new Promise<void>((resolve) => window.setTimeout(resolve, 120)),
    );
    expect(currentStep().id).toBe("create-shelf");
  },
);

it("guides Select, each sample card, Set status, the menu choice, and the result", async () => {
  await start("library-progress", "select");
  expect(target().textContent).toBe("Select");
  expect(document.activeElement).toBe(target());
  await act(() => target().click());
  await act(
    () => new Promise<void>((resolve) => window.setTimeout(resolve, 120)),
  );
  await frame();
  expect(currentStep().id).toBe("select-games");
  const first = target();
  expect(first.getAttribute("role")).toBe("checkbox");
  await act(() => first.click());
  const second = target();
  expect(second).not.toBe(first);
  expect(second.getAttribute("role")).toBe("checkbox");
  await act(() => second.click());
  await goTo("apply");
  expect(target().textContent?.trim()).toBe("Set status");
  expect(document.activeElement).toBe(target());
  await act(() => target().click());
  await frame();
  expect(target().getAttribute("role")).toBe("menuitem");
  expect(target().textContent).toBe("In progress");
  expect(document.activeElement).toBe(target());
  await act(() => target().click());
  expect(target().getAttribute("role")).toBe("status");
  expect(target().textContent).toBe("2 games marked In progress");
  expect(useAppStore.getState().gameJournals).toEqual({});
});

it("closes Help with Escape while focus is still on its trigger", async () => {
  await act(() => root.render(<HelpButton />));
  const trigger = document.querySelector<HTMLButtonElement>(
    '[aria-label="Help and tutorials"]',
  )!;
  await act(() => {
    trigger.focus();
    trigger.click();
  });
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  await act(() =>
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger);
});

it("focuses direct launching without allowing the adjacent path-removal setting", async () => {
  await act(() =>
    root.render(
      <>
        <div data-tour="settings-launcher">
          <input data-decoy type="checkbox" defaultChecked />
          <input data-tour="settings-launch-direct" type="checkbox" />
        </div>
        <TourOverlay />
      </>,
    ),
  );
  await act(() => {
    useAppStore.getState().startTour("launch-games");
    useAppStore.getState().goToTourStep(1);
  });
  await frame();
  expect(document.activeElement?.getAttribute("data-tour")).toBe(
    "settings-launch-direct",
  );
  const decoy = document.querySelector<HTMLInputElement>("[data-decoy]")!;
  await act(() => decoy.click());
  expect(decoy.checked).toBe(true);
});

it("lets a learner cancel and confirm deletion inside the private journal", async () => {
  await start("notes-playthroughs", "finish-run");
  const clickDelete = () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Delete playthrough"]')!
      .click();
  await act(clickDelete);
  const button = (text: string) =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-tour="demo-journal"] button',
      ),
    ].find((b) => b.textContent === text)!;
  await act(() => button("Cancel").click());
  expect(button("Cancel")).toBeUndefined();
  await act(clickDelete);
  await act(() => button("Delete playthrough").click());
  expect(
    document.querySelector('[data-tour="demo-playthrough-list"]')?.textContent,
  ).not.toContain("Speedrun");
  expect(useAppStore.getState().gameJournals).toEqual({});
});

it("previews the learner's note and opens its private journal from Update note", async () => {
  await start("notes-playthroughs", "note");
  await enter(target() as HTMLTextAreaElement, "Remember the bridge quest");
  await act(() =>
    document
      .querySelector<HTMLButtonElement>('[data-tour="demo-note-save"]')!
      .click(),
  );
  await goTo("popups");
  const preview = () =>
    document.querySelector('[data-tour="demo-popup-preview"]')!;
  const toggle = (name: string) =>
    [...preview().querySelectorAll("label")]
      .find((e) => e.textContent === name)!
      .querySelector<HTMLInputElement>("input")!;
  await act(() => toggle("Notes in game-start popups").click());
  expect(
    preview().querySelector(".desktop-overlay-card")?.textContent,
  ).toContain("Remember the bridge quest");
  await act(() => {
    toggle("Update note in popups").click();
    [...preview().querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Session saved")!
      .click();
  });
  await act(() =>
    [...preview().querySelectorAll<HTMLButtonElement>("button")]
      .find((b) => b.textContent === "Update note")!
      .click(),
  );
  expect(
    (
      document.querySelector(
        '[data-tour="demo-note-input"]',
      ) as HTMLTextAreaElement
    ).value,
  ).toBe("Remember the bridge quest");
  expect(useAppStore.getState().gameJournals).toEqual({});
});

it.each(TOURS.filter((tour) => tour.simulation))(
  "prepares every isolated simulation target in $id",
  async (tour) => {
    await act(() => {
      root.render(<Harness />);
      useAppStore.getState().startTour(tour.id);
    });
    for (let index = 0; index < tour.steps.length; index++) {
      await act(() => useAppStore.getState().goToTourStep(index));
      expect(findTourTarget(tour.steps[index])).not.toBeNull();
    }
  },
);

it("selects an ambiguous sample without saving a real executable choice", async () => {
  await start("fix-detection", "ambiguous");
  await act(() =>
    document
      .querySelector<HTMLButtonElement>(
        '[data-tour="demo-ambiguous"] [aria-label^="Track "]',
      )!
      .click(),
  );
  expect(
    document.querySelector('[data-tour="demo-library-result"]')?.textContent,
  ).toContain("Sample selected");
  expect(selectAmbiguousMatch).not.toHaveBeenCalled();
  expect(useAppStore.getState().exeCache.size).toBe(0);
});

it("deletes sample history through the real dialog without calling the tracker", async () => {
  await start("stats", "sessions");
  const before = useAppStore.getState().recentSessions;
  await act(() =>
    document
      .querySelector<HTMLButtonElement>(
        '[aria-label^="Remove history entry for"]',
      )!
      .click(),
  );
  await act(() =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[data-tour="demo-history-delete"] button',
      ),
    ]
      .find((b) => b.textContent === "Delete session")!
      .click(),
  );
  expect(removeHistorySession).not.toHaveBeenCalled();
  expect(useAppStore.getState().recentSessions).toBe(before);
  expect(document.querySelectorAll("[data-history-session-row]")).toHaveLength(
    5,
  );
});

it("targets the status filter and Save filters, then the saved shelf", async () => {
  await start("organize-library", "filters");
  expect(target().textContent).toBe("In progress");
  expect(document.activeElement).toBe(target());
  await act(() => target().click());
  await goTo("save-filters");
  expect(target().textContent).toBe("Save filters");
  await act(() => target().click());
  expect(target().getAttribute("data-tour")).toBe("demo-filtered-shelf");
  expect(target().textContent).toContain("Online Games");
});

it("targets journal fields, session assignment, and Mark finished precisely", async () => {
  await start("notes-playthroughs", "note");
  expect(target().tagName).toBe("TEXTAREA");
  expect(document.activeElement).toBe(target());
  await goTo("create-run");
  expect(target().textContent).toBe("Add playthrough");
  expect(document.activeElement).toBe(target());
  await act(() => target().click());
  expect(target().getAttribute("aria-label")).toBe("New playthrough name");
  expect(document.activeElement).toBe(target());
  await enter(target() as HTMLInputElement, "Co-op test");
  await act(() => (target() as HTMLInputElement).form!.requestSubmit());
  await goTo("move-session");
  expect(target().getAttribute("aria-label")).toMatch(
    /^Playthrough for session/,
  );
  // Moving both sessions must leave a useful target after their rows disappear.
  for (let index = 0; index < 2; index++) {
    await act(() => target().click());
    expect(target().textContent).toBe("Co-op test");
    await act(() => target().click());
  }
  expect(target().getAttribute("role")).toBe("option");
  expect(target().textContent).toContain("Co-op test");
  await goTo("finish-run");
  expect(target().textContent).toBe("Mark finished");
  expect(document.activeElement).toBe(target());
  await act(() => target().click());
  expect(target().textContent).toBe("Finished");
});

it("starts at readable columns and focuses the actual Customize controls", async () => {
  await start("library-progress", "open-customize");
  expect(target().textContent).toBe("Customize");
  const cards = document.querySelector<HTMLElement>(
    '[data-tour="demo-library-cards"]',
  )!;
  expect(cards.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
  await act(() => target().click());
  await act(
    () => new Promise<void>((resolve) => window.setTimeout(resolve, 120)),
  );
  await frame();
  expect(currentStep().id).toBe("customize");
  const slider = target() as HTMLInputElement;
  expect(slider.type).toBe("range");
  expect(slider.value).toBe("3");
  expect(Number(slider.max)).toBeGreaterThanOrEqual(3);
  expect(document.activeElement).toBe(slider);
  await enter(slider, "6");
  expect(cards.style.gridTemplateColumns).toBe("repeat(6, minmax(0, 1fr))");
  await goTo("card-details");
  expect((target() as HTMLInputElement).type).toBe("checkbox");
  expect(target().getAttribute("data-tour")).toBe("demo-show-status");
  const label = document.querySelector<HTMLLabelElement>(
    `label[for="${target().id}"]`,
  )!;
  expect(label.control).toBe(target());
  const before = useAppStore.getState().settings;
  await act(() => label.click());
  expect((target() as HTMLInputElement).checked).toBe(false);
  expect(useAppStore.getState().settings).toBe(before);
});

it("does not navigate the guide with text-editing arrows, and honors an interactive skip destination", async () => {
  await act(() => {
    root.render(<Harness overlay />);
    useAppStore.getState().startTour("notes-playthroughs");
    useAppStore.getState().goToTourStep(1);
  });
  const skip = [
    ...document.querySelectorAll<HTMLButtonElement>("[data-tour-card] button"),
  ].find((button) => button.textContent === "Skip step")!;
  await act(() => skip.click());
  expect(useAppStore.getState().activeTour?.stepIndex).toBe(2);
  const note = document.querySelector<HTMLTextAreaElement>("#journal-note")!;
  expect(note).not.toBeNull();
  await act(() => {
    note.focus();
    note.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    note.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
  });
  expect(useAppStore.getState().activeTour?.stepIndex).toBe(2);
});

it("keeps real feedback and unread state untouched while displaying a sample reply", async () => {
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
  await act(() => {
    root.render(<NotificationBell />);
    useAppStore.getState().startTour("feedback-replies");
    useAppStore.getState().goToTourStep(1);
  });
  expect(
    document.querySelector('[data-tour="demo-feedback-original"]')?.textContent,
  ).toContain("speedrun");
  expect(document.body.textContent).not.toContain("Keep this");
  expect(markAllNotificationsRead).not.toHaveBeenCalled();
  expect(useAppStore.getState().notifications).toEqual(notifications);
  await act(() => useAppStore.getState().endTour("dismissed"));
  expect(
    document.querySelector('[data-tour="demo-feedback-notification"]'),
  ).toBeNull();
  expect(useAppStore.getState().notifications).toEqual(notifications);
});

it("places feedback instructions outside the notification panel beneath the bell", async () => {
  vi.stubGlobal("innerWidth", 1024);
  vi.stubGlobal("innerHeight", 768);
  let frameId = 0;
  const pendingFrames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pendingFrames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    pendingFrames.delete(id),
  );
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const marker = this.getAttribute("data-tour");
      if (marker === "demo-feedback-panel")
        return new DOMRect(610, 90, 390, 440);
      if (marker?.startsWith("demo-feedback-"))
        return new DOMRect(650, 230, 310, 180);
      return new DOMRect(0, 0, 0, 0);
    },
  );
  await act(() => {
    root.render(
      <>
        <NotificationBell />
        <TourOverlay />
      </>,
    );
    useAppStore.getState().startTour("feedback-replies");
  });
  for (const step of ["bell", "context"]) {
    await act(() =>
      useAppStore
        .getState()
        .goToTourStep(
          findTour("feedback-replies")!.steps.findIndex(
            (entry) => entry.id === step,
          ),
        ),
    );
    await act(() => {
      const callbacks = [...pendingFrames.values()];
      pendingFrames.clear();
      for (const callback of callbacks) callback(performance.now());
    });
    const panel = document.querySelector<HTMLElement>(
      '[data-tour="demo-feedback-panel"]',
    )!;
    expect(panel.closest('[data-tour="notifications-bell"]')).not.toBeNull();
    expect(panel.classList.contains("absolute")).toBe(true);
    expect(panel.classList.contains("right-0")).toBe(true);
    const guide = document.querySelector<HTMLElement>("[data-tour-card]")!;
    expect(guide.hasAttribute("data-tour-practice-card")).toBe(false);
    expect(guide.classList.contains("tour-guide-card")).toBe(true);
    expect(document.body.dataset.tourDock).toBe(
      window.innerWidth < 1200 ? "bottom" : "side",
    );
    // The spotlight still targets the reply detail.
    expect(target().getAttribute("data-tour")).toBe(
      step === "bell" ? "demo-feedback-notification" : "demo-feedback-original",
    );
  }
});

it("docks the feedback guide directly left of the notification panel on wide windows", async () => {
  vi.stubGlobal("innerWidth", 1400);
  vi.stubGlobal("innerHeight", 850);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const marker = this.getAttribute("data-tour");
      if (marker === "demo-feedback-panel")
        return new DOMRect(994, 90, 390, 440);
      if (marker?.startsWith("demo-feedback-"))
        return new DOMRect(1034, 230, 310, 180);
      return new DOMRect(0, 0, 0, 0);
    },
  );
  await act(() => {
    root.render(
      <>
        <NotificationBell />
        <TourOverlay />
      </>,
    );
    useAppStore.getState().startTour("feedback-replies");
  });
  const guide = () => document.querySelector<HTMLElement>("[data-tour-card]")!;
  // The first step has no popover yet, so the card keeps its usual dock.
  expect(guide().style.right).toBe("");
  for (const step of ["bell", "context"]) {
    await act(() =>
      useAppStore
        .getState()
        .goToTourStep(
          findTour("feedback-replies")!.steps.findIndex(
            (entry) => entry.id === step,
          ),
        ),
    );
    expect(document.body.dataset.tourDock).toBe("side");
    // 1400 - 994 + 16: the card's right edge sits 16px left of the panel.
    expect(guide().style.right).toBe("422px");
  }
});

it("keeps the practice journal mounted while the notes guide moves between steps", async () => {
  const tour = findTour("notes-playthroughs")!;
  const goTo = (id: string) =>
    act(() =>
      useAppStore
        .getState()
        .goToTourStep(tour.steps.findIndex((step) => step.id === id)),
    );
  await act(() => {
    root.render(<Harness />);
    useAppStore.getState().startTour(tour.id);
  });
  await goTo("note");
  const journal = document.querySelector('[data-tour="demo-journal"]');
  expect(journal).not.toBeNull();
  // Rebuilding the dialog on every step flashed the whole modal.
  for (const id of ["create-run", "active-run", "move-session", "finish-run"]) {
    await goTo(id);
    expect(document.querySelector('[data-tour="demo-journal"]'), id).toBe(
      journal,
    );
  }
});

it("pages through a guide with the arrow keys from outside its card", async () => {
  const settings = findTour("settings")!;
  const general = settings.steps.findIndex((step) => step.id === "general");
  await act(() => {
    root.render(<Harness overlay />);
    useAppStore.getState().startTour("settings");
  });
  await act(() => useAppStore.getState().goToTourStep(general));
  const press = (target: EventTarget, key: string) =>
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true }),
      );
    });
  // An interactive step: focus usually sits on the setting just changed.
  await press(document.body, "ArrowRight");
  expect(useAppStore.getState().activeTour?.stepIndex).toBe(general + 1);
  await press(document.body, "ArrowLeft");
  expect(useAppStore.getState().activeTour?.stepIndex).toBe(general);
  // Text fields and other arrow-key controls keep their arrows.
  const field = document.createElement("input");
  document.body.append(field);
  await press(field, "ArrowRight");
  expect(useAppStore.getState().activeTour?.stepIndex).toBe(general);
  field.remove();
});

it("leaves the title bar and window buttons usable during a guide", async () => {
  await act(() => {
    root.render(<Harness overlay />);
    useAppStore.getState().startTour("settings");
  });
  const titleBar = document.createElement("div");
  titleBar.setAttribute("data-tauri-drag-region", "");
  const controls = document.createElement("div");
  controls.className = "window-controls";
  const minimize = document.createElement("button");
  controls.append(minimize);
  const other = document.createElement("button");
  document.body.append(titleBar, controls, other);
  const reached = vi.fn();
  for (const element of [titleBar, minimize, other])
    element.addEventListener("mousedown", () => reached(element));
  for (const element of [titleBar, minimize, other])
    element.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
  expect(reached.mock.calls.map(([element]) => element)).toEqual([
    titleBar,
    minimize,
  ]);
  titleBar.remove();
  controls.remove();
  other.remove();
});

it("moves on by itself once the sample games have a status, but not when you come back", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const tour = findTour("library-progress")!;
  const apply = tour.steps.findIndex((step) => step.id === "apply");
  await act(() => {
    root.render(<Harness overlay />);
    useAppStore.getState().startTour(tour.id);
  });
  // Entering "apply" after a skipped selection selects both samples.
  await act(() => useAppStore.getState().goToTourStep(apply));
  await act(() =>
    document
      .querySelector<HTMLButtonElement>('[data-tour="demo-bulk-set-status"]')!
      .click(),
  );
  await act(() =>
    document
      .querySelector<HTMLElement>('[data-tour="demo-bulk-status-playing"]')!
      .click(),
  );
  expect(useAppStore.getState().activeTour?.stepIndex).toBe(apply);
  await act(() => vi.advanceTimersByTime(800));
  expect(useAppStore.getState().activeTour?.stepIndex).toBe(apply + 1);
  // Back to the finished exercise: it waits for Next instead of bouncing on.
  await act(() => useAppStore.getState().goToTourStep(apply, true));
  await act(() => vi.advanceTimersByTime(2000));
  expect(useAppStore.getState().activeTour?.stepIndex).toBe(apply);
  vi.useRealTimers();
});

it("records a guide as finished even when an exercise was skipped", async () => {
  const tour = findTour("organize-library")!;
  await act(() => {
    root.render(<Harness overlay />);
    useAppStore.getState().startTour(tour.id);
  });
  await act(() =>
    useAppStore
      .getState()
      .goToTourStep(tour.steps.findIndex((step) => step.id === "create-shelf")),
  );
  const button = (label: string) =>
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        "[data-tour-card] button",
      ),
    ].find((candidate) => candidate.textContent === label)!;
  await act(() => button("Skip step").click());
  await act(() => useAppStore.getState().goToTourStep(tour.steps.length - 1));
  expect(document.body.textContent).toContain("You skipped an exercise");
  await act(() => button("Open My Games").click());
  expect(useAppStore.getState().activeTour).toBeNull();
  expect(useAppStore.getState().tourProgress.completed[tour.id]).toBe(
    tour.version,
  );
});

it("finishes a guide when its last step is closed with Escape or ✕", async () => {
  const tour = findTour("organize-library")!;
  const escape = () =>
    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
  await act(() => {
    root.render(<Harness overlay />);
    useAppStore.getState().startTour(tour.id);
  });
  // Leaving early does not count.
  await escape();
  expect(useAppStore.getState().activeTour).toBeNull();
  expect(
    useAppStore.getState().tourProgress.completed[tour.id],
  ).toBeUndefined();
  await act(() => useAppStore.getState().startTour(tour.id));
  await act(() => useAppStore.getState().goToTourStep(tour.steps.length - 1));
  await escape();
  expect(useAppStore.getState().activeTour).toBeNull();
  expect(useAppStore.getState().tourProgress.completed[tour.id]).toBe(
    tour.version,
  );
  const other = findTour("library-progress")!;
  await act(() => useAppStore.getState().startTour(other.id));
  await act(() => useAppStore.getState().goToTourStep(other.steps.length - 1));
  await act(() =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Exit tutorial"]')!
      .click(),
  );
  expect(useAppStore.getState().tourProgress.completed[other.id]).toBe(
    other.version,
  );
});
