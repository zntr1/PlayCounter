// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { ToastViewport } from "./App";

/* docs/hidden-shelves-plan.md, "Putting a game on a hiding shelf": a toast
   can carry one button, Undo. */

vi.mock("../tracker");
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.1.18" }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
  disable: async () => {},
}));

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useAppStore.setState(useAppStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows a toast's Undo button, runs it once and closes the toast", async () => {
  vi.useFakeTimers();
  const run = vi.fn();
  useAppStore.getState().addToast({
    tone: "success",
    title: "Added to Private. It's hidden from All games now.", // i18n-exempt: test fixture
    action: { label: "Undo", run }, // i18n-exempt: test fixture
  });
  await act(() => root.render(<ToastViewport />));
  const undo = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === "Undo",
  );
  expect(undo).toBeDefined();

  await act(() => undo!.click());
  expect(run).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTime(300));
  expect(useAppStore.getState().toasts).toEqual([]);
});

it("shows no extra button on a toast without one", async () => {
  useAppStore.getState().addToast({ tone: "info", title: "Saved" }); // i18n-exempt: test fixture
  await act(() => root.render(<ToastViewport />));
  expect(
    [...document.body.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label"),
    ),
  ).toEqual(["Dismiss notification"]);
});

/* A toast that shows while a dialog or the screenshot viewer is open must be
   seen ("Moved to the Recycle Bin" from the viewer). Dialogs are portalled
   to the page body, so the toasts go there too, above every layer that
   covers the whole window. */

function viewport() {
  return document.body.querySelector<HTMLElement>(
    '[aria-label="Notifications"]',
  );
}

function zIndexOf(classes: string) {
  const match = /(?:^|\s)z-(?:\[(\d+)\]|(\d+))(?=\s|$)/.exec(classes);
  return match ? Number(match[1] ?? match[2]) : null;
}

it("renders the toasts on the page body, outside the app shell", async () => {
  await act(() => root.render(<ToastViewport />));
  expect(viewport()?.parentElement).toBe(document.body);
});

it("keeps the toasts above every layer that covers the whole window", async () => {
  await act(() => root.render(<ToastViewport />));
  const toastZ = zIndexOf(viewport()!.className);
  expect(toastZ).not.toBeNull();

  const uiDir = dirname(fileURLToPath(import.meta.url));
  // The floating heart in Discovered is a short, see-through animation.
  const aboveOnPurpose = ["animate-heart-float"];
  const layers: { file: string; classes: string; z: number }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
        const source = readFileSync(path, "utf8");
        // Class strings sit on one line; pairing quotes per line keeps an
        // apostrophe elsewhere in the file from shifting the pairs.
        const lines = source.split("\n");
        lines.forEach((line, index) => {
          for (const [, , classes] of line.matchAll(/(["'`])(.*?)\1/g)) {
            const tokens = classes.split(/\s+/);
            if (!tokens.includes("fixed") || !tokens.includes("inset-0"))
              continue;
            const z = zIndexOf(classes);
            if (z === null) continue;
            const markup = lines.slice(index, index + 6).join("\n");
            if (aboveOnPurpose.some((name) => markup.includes(name))) continue;
            layers.push({ file: relative(uiDir, path), classes, z });
          }
        });
      }
    }
  };
  walk(uiDir);

  expect(layers.length).toBeGreaterThanOrEqual(4);
  expect(layers.filter((layer) => layer.z >= toastZ!)).toEqual([]);
});
