// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeScreenshotViewer,
  markUpScreenshot,
  openScreenshotViewer,
  setScreenshotCaption,
  useScreenshotViewer,
  type Screenshot,
} from "../screenshots";
import { marksPng } from "../screenshotMarks";
import { ScreenshotViewer } from "./ScreenshotViewer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("../screenshots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../screenshots")>()),
  setScreenshotCaption: vi.fn(),
  markUpScreenshot: vi.fn(),
}));
// happy-dom can't load asset:// files: every picture would fail.
vi.mock("./ArtImage", () => ({
  ArtImage: ({ onError: _failed, ...props }: ComponentProps<"img">) => (
    <img {...props} />
  ),
}));
vi.mock("../screenshotMarks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../screenshotMarks")>()),
  marksPng: vi.fn(),
}));
const setCaptionMock = vi.mocked(setScreenshotCaption);
const markUpMock = vi.mocked(markUpScreenshot);
const marksPngMock = vi.mocked(marksPng);

function shot(name: string, caption: string | null): Screenshot {
  return {
    path: `C:\\Pictures\\PlayCounter\\Elden Ring\\${name}`,
    folder: "Elden Ring",
    name,
    bytes: 1000,
    modifiedMs: 0,
    previewPath: null,
    caption,
    takenAtMs: Date.parse("2026-11-08T20:44:07Z"),
  };
}
const withCaption = shot("Elden Ring 2026-11-08 21-44-07.jpg", "Boss arena");
const without = shot("Elden Ring 2026-11-08 21-50-00.jpg", null);

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setCaptionMock.mockReset().mockImplementation(async (path, caption) => {
    const next = { ...withCaption, path, caption };
    useScreenshotViewer.setState((state) => ({
      shots: state.shots.map((entry) =>
        "path" in entry && entry.path === path ? next : entry,
      ),
    }));
    return next;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(<ScreenshotViewer />));
  await act(() =>
    openScreenshotViewer([withCaption, without], 0, "Elden Ring"),
  );
});
afterEach(async () => {
  await act(() => closeScreenshotViewer());
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const button = (text: string) =>
  [...document.body.querySelectorAll("button")].find((entry) =>
    entry.textContent?.includes(text),
  );
const input = () =>
  document.body.querySelector<HTMLInputElement>('input[aria-label="Caption"]');
async function type(value: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input()!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const press = (key: string) =>
  act(() =>
    input()!.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    ),
  );

it("shows the caption under the picture", () => {
  expect(button("“Boss arena”")).toBeDefined();
});

it("changes the caption when it is clicked", async () => {
  await act(() => button("“Boss arena”")!.click());
  expect(input()!.value).toBe("Boss arena");
  expect(document.activeElement).toBe(input());
  await type("Boss arena, before the fight");
  await press("Enter");
  expect(setCaptionMock).toHaveBeenCalledExactlyOnceWith(
    withCaption.path,
    "Boss arena, before the fight",
  );
  expect(input()).toBeNull();
});

it("offers to add a caption to a picture without one", async () => {
  await act(() => useScreenshotViewer.setState({ index: 1 }));
  await act(() => button("Add a caption")!.click());
  await type("  That view from the tower ");
  await press("Enter");
  expect(setCaptionMock).toHaveBeenCalledExactlyOnceWith(
    without.path,
    "That view from the tower",
  );
});

it("removes the caption when the text is cleared", async () => {
  await act(() => button("“Boss arena”")!.click());
  await type("   ");
  await press("Enter");
  expect(setCaptionMock).toHaveBeenCalledExactlyOnceWith(
    withCaption.path,
    null,
  );
});

it("cancels the change on Esc and keeps the viewer open", async () => {
  await act(() => button("“Boss arena”")!.click());
  await type("Something else");
  await press("Escape");
  expect(setCaptionMock).not.toHaveBeenCalled();
  expect(input()).toBeNull();
  expect(useScreenshotViewer.getState().shots).toHaveLength(2);
  expect(button("“Boss arena”")).toBeDefined();
});

it("moves the text cursor with the arrow keys, not to another picture", async () => {
  await act(() => button("“Boss arena”")!.click());
  await press("ArrowRight");
  await press("ArrowLeft");
  expect(useScreenshotViewer.getState().index).toBe(0);
});

describe("mark up", () => {
  const markUp = () =>
    document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Mark up"]',
    );
  const byLabel = (label: string) =>
    document.body.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    );
  const canvas = () =>
    document.body.querySelector<HTMLCanvasElement>(
      'canvas[aria-label="Picture to draw on"]',
    );
  const picture = () =>
    document.body.querySelector<HTMLImageElement>('img[alt^="Screenshot"]');
  const marking = () => button("Pen") !== undefined;

  function pointer(type: string, x: number, y: number) {
    const Event = window.PointerEvent ?? MouseEvent;
    return new Event(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
  }
  /** A click with the picked tool, at (x, y) on a picture shown 880 × 495. */
  async function click(x: number, y: number) {
    await act(() => {
      canvas()!.dispatchEvent(pointer("pointerdown", x, y));
      canvas()!.dispatchEvent(pointer("pointerup", x, y));
    });
  }
  const key = (name: string, init: KeyboardEventInit = {}) =>
    act(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: name,
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    });
  async function startWithNumbers(count: number) {
    await act(() => markUp()!.click());
    await act(() => button("Number")!.click());
    for (let index = 0; index < count; index++)
      await click(100 + index * 50, 100);
  }

  beforeEach(() => {
    markUpMock.mockReset();
    marksPngMock.mockReset();
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 0, width: 880, height: 495 }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("is offered on the player's own JPEG pictures only", async () => {
    expect(markUp()).not.toBeNull();
    await act(() =>
      openScreenshotViewer(
        [
          shot("Map.png", null),
          { url: "https://images.igdb.com/igdb/image/upload/t_original/x.jpg" },
        ],
        0,
        "Elden Ring",
      ),
    );
    expect(markUp()).toBeNull();
    await act(() => useScreenshotViewer.setState({ index: 1 }));
    expect(markUp()).toBeNull();
  });

  it("leaves mark up on Esc and keeps the viewer open", async () => {
    await act(() => markUp()!.click());
    expect(marking()).toBe(true);
    expect(canvas()).not.toBeNull();
    await key("Escape");
    expect(marking()).toBe(false);
    expect(markUp()).not.toBeNull();
    expect(useScreenshotViewer.getState().shots).toHaveLength(2);
  });

  it("asks before throwing marks away, and never saves on Cancel", async () => {
    await startWithNumbers(1);
    await act(() => button("Cancel")!.click());
    expect(document.body.textContent).toContain("Discard your marks?");
    await act(() => button("Keep drawing")!.click());
    expect(marking()).toBe(true);
    await key("Escape");
    expect(document.body.textContent).toContain("Discard your marks?");
    await act(() => button("Discard")!.click());
    expect(marking()).toBe(false);
    expect(markUpMock).not.toHaveBeenCalled();
    expect(marksPngMock).not.toHaveBeenCalled();
  });

  it("takes back the last mark with Undo or Ctrl+Z, and clears them all", async () => {
    const save = () => button("Save into picture")!;
    await startWithNumbers(3);
    expect(save().disabled).toBe(false);
    await act(() => byLabel("Undo")!.click());
    await key("z", { ctrlKey: true });
    expect(save().disabled).toBe(false);
    await key("z", { ctrlKey: true });
    expect(save().disabled).toBe(true);
    await click(300, 200);
    await act(() => byLabel("Clear all")!.click());
    expect(save().disabled).toBe(true);
  });

  it("doesn't page to another picture or close while drawing", async () => {
    await act(() => markUp()!.click());
    await key("ArrowRight");
    expect(useScreenshotViewer.getState().index).toBe(0);
    const panel = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(() => {
      panel.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(useScreenshotViewer.getState().shots).toHaveLength(2);
    expect(marking()).toBe(true);
  });

  it("saves the marks into this picture at its own size", async () => {
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
      3840,
    );
    vi.spyOn(
      HTMLImageElement.prototype,
      "naturalHeight",
      "get",
    ).mockReturnValue(2160);
    const png = new Uint8Array([137, 80, 78, 71]);
    marksPngMock.mockResolvedValue(png);
    markUpMock.mockImplementation(async (path) => {
      const marked = { ...withCaption, path, modifiedMs: 9000 };
      useScreenshotViewer.setState((state) => ({
        shots: state.shots.map((entry) =>
          "path" in entry && entry.path === path ? marked : entry,
        ),
      }));
      return marked;
    });
    const before = picture()!.getAttribute("src");

    await act(() => markUp()!.click());
    await act(() => button("Number")!.click());
    // The middle of the picture as shown.
    await click(440, 247.5);
    await act(() => button("Save into picture")!.click());

    expect(marksPngMock).toHaveBeenCalledExactlyOnceWith(
      [{ kind: "number", color: "red", value: 1, at: [0.5, 0.5] }],
      3840,
      2160,
      expect.any(Function),
    );
    expect(markUpMock).toHaveBeenCalledExactlyOnceWith(withCaption.path, png);
    expect(marking()).toBe(false);
    // The marked picture loads again instead of the cached one.
    expect(picture()!.getAttribute("src")).not.toBe(before);
  });

  it("says so under the tools when saving fails, and keeps the marks", async () => {
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(
      1920,
    );
    vi.spyOn(
      HTMLImageElement.prototype,
      "naturalHeight",
      "get",
    ).mockReturnValue(1080);
    vi.spyOn(console, "error").mockImplementation(() => {});
    marksPngMock.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    markUpMock.mockRejectedValue(new Error("The Recycle Bin did not take it"));
    await startWithNumbers(1);
    await act(() => button("Save into picture")!.click());
    expect(document.body.textContent).toContain("The marks couldn't be saved.");
    expect(marking()).toBe(true);
    expect(button("Save into picture")!.disabled).toBe(false);
  });
});
