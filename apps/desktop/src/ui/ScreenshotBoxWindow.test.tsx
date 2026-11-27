// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ScreenshotBoxPayload,
  ScreenshotBoxPicture,
  ScreenshotBoxState,
} from "../screenshotBox";
import { marksPng } from "../screenshotMarks";
import { ScreenshotBoxWindow } from "./ScreenshotBoxWindow";

/* docs/session-screenshots-plan.md: the box over the game. It opens at the
   newest picture, pages to older ones, and marks up, captions and recycles
   through the main window. Its texts come along in the main window's
   language. */

vi.mock("../screenshotMarks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../screenshotMarks")>()),
  marksPng: vi.fn(),
}));
const marksPngMock = vi.mocked(marksPng);

function picture(
  name: string,
  group: ScreenshotBoxPicture["group"],
  extra: Partial<ScreenshotBoxPicture> = {},
): ScreenshotBoxPicture {
  return {
    path: `C:\\Pictures\\PlayCounter\\Elden Ring\\${name}.jpg`,
    url: `asset://${name}.jpg`,
    thumbUrl: `asset://previews/${name}.jpg`,
    takenAt: `${name} time`,
    group,
    caption: null,
    markable: true,
    ...extra,
  };
}
const thursday = {
  key: "day:2026-11-21",
  label: "Do., 21. Nov.",
  current: false,
};
const saturday = { key: "session:1", label: "Sa., 23. Nov.", current: false };
const tonight = { key: "session:2", label: "Diese Session", current: true };
const pictures = [
  picture("thursday", thursday),
  picture("fork", saturday, { caption: "Gabelung hinter der Brücke" }),
  picture("boss-door", saturday),
  picture("cliff", tonight),
  picture("sunrise", tonight),
];

const labels: Record<string, string> = {
  "Mark up": "Markieren",
  "Move to the Recycle Bin": "In den Papierkorb",
  Close: "Schließen",
  "This session": "Diese Session",
  "{{takenAt}} · {{index}} of {{total}}":
    "{{takenAt}} · {{index}} von {{total}}",
  "Add a caption": "Bildunterschrift hinzufügen",
  Caption: "Bildunterschrift",
  "Moved to the Recycle Bin": "In den Papierkorb verschoben",
  "Saved into the picture": "Ins Bild gespeichert",
  "The marks couldn't be saved.":
    "Die Markierungen konnten nicht gespeichert werden.",
  Pen: "Stift",
  Number: "Nummer",
  "Save into picture": "Ins Bild speichern",
  "Esc takes you back to the game.": "Esc bringt dich zurück ins Spiel.",
};

const payload: ScreenshotBoxPayload = {
  gameName: "Elden Ring",
  coverUrl: null,
  screenshots: { pictures, index: 4 },
  labels: labels as ScreenshotBoxPayload["labels"],
  theme: "dark",
  accentColor: null,
  reducedMotion: true,
};

let root: Root;
let container: HTMLDivElement;
const onAction = vi.fn();
const onClose = vi.fn();
let send: (update: ScreenshotBoxState) => void;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onAction.mockReset();
  onClose.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() =>
    root.render(
      <ScreenshotBoxWindow
        payload={payload}
        onAction={onAction}
        onClose={onClose}
        subscribe={(listener) => {
          send = listener;
          return () => {};
        }}
      />,
    ),
  );
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const shown = () =>
  container.querySelector<HTMLImageElement>("img[data-shown]");
const button = (text: string) =>
  [...container.querySelectorAll("button")].find(
    (entry) =>
      entry.textContent?.includes(text) ||
      entry.getAttribute("aria-label") === text,
  );
const key = (name: string, init: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: name,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
const update = (state: ScreenshotBoxState) => act(() => send(state));

it("opens at the newest picture, with its time, place and session", () => {
  expect(container.textContent).toContain("Elden Ring");
  expect(shown()!.getAttribute("src")).toBe("asset://sunrise.jpg");
  expect(container.textContent).toContain("sunrise time · 5 von 5");
  expect(container.textContent).toContain("Diese Session");
  expect(container.textContent).toContain("Esc bringt dich zurück ins Spiel.");
});

it("goes to older pictures with ← and back with →", async () => {
  await key("ArrowLeft");
  await key("ArrowLeft");
  expect(shown()!.getAttribute("src")).toBe("asset://boss-door.jpg");
  expect(container.textContent).toContain("boss-door time · 3 von 5");
  // Not this session's: no "This session" next to the time.
  expect(container.querySelector("[data-current-session]")).toBeNull();
  await key("ArrowRight");
  expect(shown()!.getAttribute("src")).toBe("asset://cliff.jpg");
});

it("shows every session's pictures under its date, and a click shows one", async () => {
  const groups = [...container.querySelectorAll("[data-picture-group]")];
  expect(
    groups.map((group) => group.querySelector("span")?.textContent),
  ).toEqual(["Do., 21. Nov.", "Sa., 23. Nov.", "Diese Session"]);
  expect(
    groups.map((group) => group.querySelectorAll("button").length),
  ).toEqual([1, 2, 2]);
  await act(() => groups[1].querySelectorAll("button")[0].click());
  expect(shown()!.getAttribute("src")).toBe("asset://fork.jpg");
  expect(container.textContent).toContain("“Gabelung hinter der Brücke”");
});

it("takes you back to the game on Esc", async () => {
  await key("Escape");
  expect(onClose).toHaveBeenCalledExactlyOnceWith(true);
});

it("takes you back to the game on Close, once", async () => {
  await act(() => button("Schließen")!.click());
  await key("Escape");
  expect(onClose).toHaveBeenCalledExactlyOnceWith(true);
});

it("closes when it loses the focus, but not while marking up", async () => {
  await act(() => button("Markieren")!.click());
  await act(() => window.dispatchEvent(new Event("blur")));
  expect(onClose).not.toHaveBeenCalled();
  await key("Escape");
  await act(() => window.dispatchEvent(new Event("blur")));
  expect(onClose).toHaveBeenCalledExactlyOnceWith(false);
});

it("asks the main window to recycle a picture, then shows the next one", async () => {
  await key("ArrowLeft");
  await act(() => button("In den Papierkorb")!.click());
  expect(onAction).toHaveBeenCalledExactlyOnceWith({
    kind: "recycle",
    path: pictures[3].path,
  });
  await update({
    pictures: pictures.filter((entry) => entry !== pictures[3]),
    index: 3,
    done: { kind: "recycle", path: pictures[3].path, ok: true },
  });
  expect(shown()!.getAttribute("src")).toBe("asset://sunrise.jpg");
  expect(container.textContent).toContain("In den Papierkorb verschoben");
});

it("asks the main window to write a caption", async () => {
  await act(() => button("Bildunterschrift hinzufügen")!.click());
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Bildunterschrift"]',
  )!;
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "  Sunrise over the lake ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  expect(onAction).toHaveBeenCalledExactlyOnceWith({
    kind: "caption",
    path: pictures[4].path,
    caption: "Sunrise over the lake",
  });
});

it("keeps the picture shown when the main window adds a new one", async () => {
  const later = picture("later", tonight);
  await update({ pictures: [...pictures, later], index: 5 });
  expect(shown()!.getAttribute("src")).toBe("asset://sunrise.jpg");
  expect(container.textContent).toContain("sunrise time · 5 von 6");
});

describe("mark up", () => {
  const canvas = () =>
    container.querySelector<HTMLCanvasElement>("canvas[aria-label]");

  beforeEach(() => {
    marksPngMock
      .mockReset()
      .mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
      1920,
    );
    vi.spyOn(
      HTMLImageElement.prototype,
      "naturalHeight",
      "get",
    ).mockReturnValue(1080);
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 880, height: 495 }),
    );
  });

  async function drawNumber() {
    await act(() => button("Markieren")!.click());
    await act(() => button("Nummer")!.click());
    const Pointer = window.PointerEvent ?? MouseEvent;
    await act(() => {
      for (const type of ["pointerdown", "pointerup"])
        canvas()!.dispatchEvent(
          new Pointer(type, {
            bubbles: true,
            clientX: 440,
            clientY: 247.5,
            button: 0,
          }),
        );
    });
  }

  it("writes a caption while marking up; Esc in it closes only the field", async () => {
    await drawNumber();
    const field = () =>
      container.querySelector<HTMLInputElement>(
        'input[aria-label="Bildunterschrift"]',
      );
    const typeIn = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(field(), value);
        field()!.dispatchEvent(new Event("input", { bubbles: true }));
      });
    const pressIn = (name: string) =>
      act(() => {
        field()!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: name,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    await act(() => button("Bildunterschrift hinzufügen")!.click());
    await typeIn("Sunrise over the lake");
    await pressIn("Enter");
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      kind: "caption",
      path: pictures[4].path,
      caption: "Sunrise over the lake",
    });
    expect(button("Stift")).toBeDefined();
    await act(() => button("Bildunterschrift hinzufügen")!.click());
    await typeIn("Something else");
    await pressIn("Escape");
    expect(field()).toBeNull();
    expect(button("Stift")).toBeDefined();
    expect(container.textContent).not.toContain("Discard your marks?");
  });

  it("puts the caption under the tools while marking up", async () => {
    await act(() => button("Markieren")!.click());
    const tools = container.querySelector('[role="toolbar"]')!;
    const caption = button("Bildunterschrift hinzufügen")!;
    expect(
      tools.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is only offered on pictures that can take marks", async () => {
    expect(button("Markieren")).toBeDefined();
    await update({
      pictures: pictures.map((entry, index) =>
        index === 4 ? { ...entry, markable: false } : entry,
      ),
      index: 4,
    });
    expect(button("Markieren")).toBeUndefined();
  });

  it("sends the marks to the main window and says when they're saved", async () => {
    await drawNumber();
    expect(button("Stift")).toBeDefined();
    await act(() => button("Ins Bild speichern")!.click());
    expect(marksPngMock).toHaveBeenCalledExactlyOnceWith(
      [{ kind: "number", color: "red", value: 1, at: [0.5, 0.5] }],
      1920,
      1080,
      expect.any(Function),
    );
    expect(onAction).toHaveBeenCalledExactlyOnceWith({
      kind: "markUp",
      path: pictures[4].path,
      png: btoa(String.fromCharCode(137, 80, 78, 71)),
    });
    await update({
      pictures: pictures.map((entry, index) =>
        index === 4 ? { ...entry, url: "asset://sunrise.jpg?v=2" } : entry,
      ),
      index: 4,
      done: { kind: "markUp", path: pictures[4].path, ok: true },
    });
    expect(button("Stift")).toBeUndefined();
    expect(shown()!.getAttribute("src")).toBe("asset://sunrise.jpg?v=2");
    expect(container.textContent).toContain("Ins Bild gespeichert");
  });

  it("keeps the marks and says so when saving failed", async () => {
    await drawNumber();
    await act(() => button("Ins Bild speichern")!.click());
    await update({
      pictures,
      index: 4,
      done: { kind: "markUp", path: pictures[4].path, ok: false },
    });
    expect(button("Stift")).toBeDefined();
    expect(container.textContent).toContain(
      "Die Markierungen konnten nicht gespeichert werden.",
    );
  });

  it("doesn't page or close on the arrows and Esc while drawing", async () => {
    await drawNumber();
    await key("ArrowLeft");
    expect(shown()!.getAttribute("src")).toBe("asset://sunrise.jpg");
    await key("Escape");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("opened to mark up the picture just taken", () => {
  beforeEach(async () => {
    marksPngMock
      .mockReset()
      .mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
      1920,
    );
    vi.spyOn(
      HTMLImageElement.prototype,
      "naturalHeight",
      "get",
    ).mockReturnValue(1080);
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 880, height: 495 }),
    );
    await act(() =>
      root.render(
        <ScreenshotBoxWindow
          key="mark-up-first"
          payload={{
            ...payload,
            screenshots: { pictures, index: 3, markUpFirst: true },
          }}
          onAction={onAction}
          onClose={onClose}
          subscribe={(listener) => {
            send = listener;
            return () => {};
          }}
        />,
      ),
    );
  });

  it("starts with the tools, and Cancel takes you back to the game", async () => {
    expect(button("Stift")).toBeDefined();
    expect(shown()!.getAttribute("src")).toBe("asset://cliff.jpg");
    await act(() => button("Cancel")!.click());
    expect(onClose).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("takes you back to the game once the marks are saved", async () => {
    await act(() => button("Nummer")!.click());
    const Pointer = window.PointerEvent ?? MouseEvent;
    const canvas =
      container.querySelector<HTMLCanvasElement>("canvas[aria-label]")!;
    await act(() => {
      for (const type of ["pointerdown", "pointerup"])
        canvas.dispatchEvent(
          new Pointer(type, {
            bubbles: true,
            clientX: 100,
            clientY: 100,
            button: 0,
          }),
        );
    });
    await act(() => button("Ins Bild speichern")!.click());
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "markUp", path: pictures[3].path }),
    );
    expect(onClose).not.toHaveBeenCalled();
    await update({
      pictures,
      index: 4,
      done: { kind: "markUp", path: pictures[3].path, ok: true },
    });
    expect(onClose).toHaveBeenCalledExactlyOnceWith(true);
  });
});
