// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UpdateNotice } from "./UpdateNotice";

let root: Root;
let container: HTMLDivElement;
const onInstall = vi.fn();
const onOpenNotes = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onInstall.mockReset();
  onOpenNotes.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const show = (props: Partial<ComponentProps<typeof UpdateNotice>> = {}) =>
  act(() =>
    root.render(
      createElement(UpdateNotice, {
        version: "1.6.1",
        installing: false,
        progress: null,
        hasNotes: true,
        onInstall,
        onOpenNotes,
        ...props,
      }),
    ),
  );
const button = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === name || b.textContent === name,
  );

it("offers What's new, Install and Close", async () => {
  await show();
  expect(container.textContent).toContain("Version 1.6.1 is available");
  await act(() => button("What's new")!.click());
  expect(onOpenNotes).toHaveBeenCalledOnce();
  await act(() => button("Install")!.click());
  expect(onInstall).toHaveBeenCalledOnce();
  expect(button("Close")).toBeDefined();
});

it("stays closed until the next start, unless a newer version comes", async () => {
  await show();
  await act(() => button("Close")!.click());
  expect(container.textContent).toBe("");

  // The check every six hours finds the same version again.
  await show({ version: "1.6.1" });
  expect(container.textContent).toBe("");

  await show({ version: "1.6.2" });
  expect(container.textContent).toContain("Version 1.6.2 is available");

  // Next start: the notice is back.
  await act(() => root.unmount());
  root = createRoot(container);
  await show();
  expect(container.textContent).toContain("Version 1.6.1 is available");
});

it("can't be closed while installing and shows the download", async () => {
  await show({
    installing: true,
    progress: { downloadedBytes: 3_355_443, totalBytes: 7_907_112 },
  });
  expect(container.textContent).toContain("Version 1.6.1 is available");
  expect(container.textContent).toContain("downloading 3.2 MB of 7.5 MB");
  expect(button("Close")).toBeUndefined();
  expect(button("Installing…")?.disabled).toBe(true);
  expect(button("What's new")?.disabled).toBe(true);
});

it("leaves out What's new when the update has no notes", async () => {
  await show({ hasNotes: false });
  expect(button("What's new")).toBeUndefined();
});
