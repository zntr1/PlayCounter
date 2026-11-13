// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findTourTarget,
  mergeTouchingRects,
  tourRingBox,
  tourTargetRect,
  type TourTargetRect,
} from "./tourTargetRect";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("follows menu and dialog controls in priority order, ignoring hidden copies", () => {
  const hiddenLibrary = document.createElement("div");
  hiddenLibrary.style.display = "none";
  hiddenLibrary.innerHTML =
    '<button data-tour="new">Hidden library action</button>';
  const library = document.createElement("div");
  library.innerHTML = '<button data-tour="new">New shelf</button>';
  document.body.append(hiddenLibrary, library);
  const step = {
    anchor: '[data-tour="new"]',
    anchorTargets: ['[data-tour="name"]'],
  };
  expect(findTourTarget(step)?.textContent).toBe("New shelf");
  const dialog = document.createElement("div");
  dialog.innerHTML = '<input data-tour="name" aria-label="Shelf name">';
  document.body.append(dialog);
  expect(findTourTarget(step)).toBe(dialog.firstElementChild);
  dialog.hidden = true;
  expect(findTourTarget(step)?.textContent).toBe("New shelf");
  dialog.hidden = false;
  expect(findTourTarget(step)).toBe(dialog.firstElementChild);
  dialog.remove();
  expect(findTourTarget(step)?.textContent).toBe("New shelf");
});

it("follows a secondary practice dialog while preserving its fields and newer menus", () => {
  document.body.innerHTML =
    '<button data-tour="shelf">Shelf</button><div data-tour="demo-library-modal"><section role="dialog"><input data-tour="name"></section></div>';
  const dialog = document.querySelector('[role="dialog"]');
  const step = { interactive: true, anchor: '[data-tour="shelf"]' };
  expect(findTourTarget(step)).toBe(dialog);
  expect(
    findTourTarget({ ...step, anchorTargets: ['[data-tour="name"]'] }),
  ).toBe(dialog?.firstElementChild);
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.innerHTML = '<button data-tour="move">Move session</button>';
  document.body.append(menu);
  expect(
    findTourTarget({ ...step, anchorTargets: ['[data-tour="move"]'] }),
  ).toBe(menu.firstElementChild);
  expect(findTourTarget({ ...step, interactive: false })?.textContent).toBe(
    "Shelf",
  );
});

it("clips a highlight to the visible area of a scrolling journal", () => {
  const panel = document.createElement("div");
  panel.style.overflowY = "auto";
  const field = document.createElement("textarea");
  panel.append(field);
  document.body.append(panel);
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 100, 400, 200),
  );
  vi.spyOn(field, "getBoundingClientRect").mockReturnValue(
    new DOMRect(40, 250, 300, 180),
  );
  expect(tourTargetRect(field)).toEqual({
    left: 40,
    top: 250,
    width: 300,
    height: 50,
  });
});

it("does not draw a ring around a control scrolled out of view", () => {
  const panel = document.createElement("div");
  panel.style.overflowY = "hidden";
  const field = document.createElement("div");
  panel.append(field);
  document.body.append(panel);
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(
    new DOMRect(20, 100, 400, 200),
  );
  vi.spyOn(field, "getBoundingClientRect").mockReturnValue(
    new DOMRect(40, 400, 300, 180),
  );
  expect(tourTargetRect(field)).toBeNull();
});

/* Rings are drawn 6 px outside their target. Two named controls that sit
   right next to each other (two settings rows, two menu items) would get
   rings that touch or overlap; they share one ring instead. */
describe("rings on neighbours", () => {
  const row = (top: number, height = 56): TourTargetRect => ({
    left: 300,
    top,
    width: 800,
    height,
  });

  it("draws one ring around two settings rows that sit under each other", () => {
    expect(mergeTouchingRects([row(200), row(256)])).toEqual([
      { left: 300, top: 200, width: 800, height: 112 },
    ]);
  });

  it("chains three neighbours into one ring", () => {
    expect(mergeTouchingRects([row(200), row(312), row(256)])).toEqual([
      { left: 300, top: 200, width: 800, height: 168 },
    ]);
  });

  it("keeps two rings when another row lies between the named ones", () => {
    const rows = [row(200), row(312)];
    expect(mergeTouchingRects(rows)).toEqual(rows);
  });

  it("merges menu items with a hairline between them, and not a far control", () => {
    const first = { left: 420, top: 500, width: 220, height: 32 };
    const second = { left: 420, top: 534, width: 220, height: 32 };
    const sidebar = { left: 12, top: 180, width: 223, height: 44 };
    expect(mergeTouchingRects([first, second, sidebar])).toEqual([
      { left: 420, top: 500, width: 220, height: 66 },
      sidebar,
    ]);
  });

  it("leaves a 13 px gap alone: those rings no longer touch", () => {
    const rows = [row(200), row(269)];
    expect(mergeTouchingRects(rows)).toEqual(rows);
    expect(mergeTouchingRects([row(200), row(268)])).toHaveLength(1);
  });

  it("does not join controls that are level but far apart sideways", () => {
    const left = { left: 100, top: 300, width: 120, height: 36 };
    const right = { left: 900, top: 300, width: 120, height: 36 };
    expect(mergeTouchingRects([left, right])).toEqual([left, right]);
  });
});

describe("the ring around a target", () => {
  it("sits 6px outside a target in the middle of the window", () => {
    expect(tourRingBox({ left: 100, top: 200, width: 50, height: 40 })).toEqual(
      { left: 94, top: 194, width: 62, height: 52 },
    );
  });

  it("stays inside the window around a target at its edge, glow included", () => {
    // The title bar: the window's full width, from its very top.
    const ring = tourRingBox({
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: 72,
    });
    expect(ring.left).toBeGreaterThanOrEqual(4);
    expect(ring.top).toBeGreaterThanOrEqual(4);
    expect(ring.left + ring.width).toBeLessThanOrEqual(window.innerWidth - 4);
    expect(ring.top + ring.height).toBe(78);
  });
});
