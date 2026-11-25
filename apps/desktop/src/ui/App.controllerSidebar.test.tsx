// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppStore } from "../store";
import { App } from "./App";
import { useLibrarySources } from "./librarySources";

vi.mock("../tracker");
vi.mock("../platform", () => ({ currentPlatform: () => "windows" }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.1.18" }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: async () => true,
  enable: async () => {},
  disable: async () => {},
}));
vi.mock("./tour/TourUI", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tour/TourUI")>()),
  WelcomePrompt: () => null,
  TourOverlay: () => null,
}));

/* The controller walks the sidebar's views, but not the ones a pad can't
   work: Discovered (its review takes a mouse) and Launcher accounts (its
   sign-ins open launcher windows). */

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
  localStorage.clear();
  useAppStore.setState(useAppStore.getInitialState(), true);
  useLibrarySources.setState(useLibrarySources.getInitialState(), true);
  useAppStore.setState({
    activeView: "games",
    lastSeenReleaseNotesVersion: "1.1.18",
  });
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

const navRow = (view: string) =>
  container.querySelector<HTMLButtonElement>(`[data-tour="nav-${view}"]`);

it("walks the sidebar with the controller, past Discovered and Launcher accounts", async () => {
  await act(() => root.render(<App />));

  for (const view of ["now", "games", "achievements", "history", "settings"])
    expect(navRow(view)?.getAttribute("data-controller-item"), view).toBe(
      "navigation",
    );
  for (const view of ["discovered", "accounts"]) {
    expect(navRow(view), view).not.toBeNull();
    expect(navRow(view)!.hasAttribute("data-controller-item"), view).toBe(
      false,
    );
  }
});
