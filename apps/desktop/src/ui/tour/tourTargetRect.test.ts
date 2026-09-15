// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { findTourTarget, tourTargetRect } from "./tourTargetRect";

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
