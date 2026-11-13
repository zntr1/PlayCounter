// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  closeScreenshotViewer,
  openScreenshotViewer,
  setScreenshotCaption,
  useScreenshotViewer,
  type Screenshot,
} from "../screenshots";
import { ScreenshotViewer } from "./ScreenshotViewer";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("../screenshots", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../screenshots")>()),
  setScreenshotCaption: vi.fn(),
}));
const setCaptionMock = vi.mocked(setScreenshotCaption);

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
      shots: state.shots.map((entry) => (entry.path === path ? next : entry)),
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
