// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import {
  armControllerBridge,
  disposeControllerBridge,
  initializeControllerBridge,
} from "./controllerBridge";
import { useAppStore } from "./store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./platform", () => ({ currentPlatform: () => "windows" }));

let controllerHandler: (event: {
  payload: { action: string; at: number };
}) => void;
let frames: FrameRequestCallback[];
let content: HTMLElement;

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    frames.push(callback),
  );
  vi.stubGlobal("getComputedStyle", () => ({
    display: "block",
    visibility: "visible",
    opacity: "1",
  }));
  vi.mocked(listen).mockImplementation(async (_event, handler) => {
    controllerHandler = handler as typeof controllerHandler;
    return () => {};
  });
  document.body.innerHTML = `
    <aside>
      <button id="nav-now" data-controller-item="navigation">Now Playing</button>
      <button id="nav-games" data-controller-item="navigation">My Games</button>
    </aside>
    <main data-tour="content" data-controller-content="true" aria-busy="true" tabindex="-1"></main>
  `;
  content = document.querySelector("main")!;
  for (const element of document.querySelectorAll<HTMLElement>("button, main"))
    element.scrollIntoView = vi.fn();
  document
    .querySelector("#nav-games")!
    .addEventListener("click", () =>
      useAppStore.getState().setActiveView("games"),
    );
  useAppStore.setState(useAppStore.getInitialState(), true);
  useAppStore.setState((state) => ({
    activeView: "now",
    settings: {
      ...state.settings,
      gameLaunchingEnabled: true,
      controllerNavigationEnabled: true,
    },
  }));
  initializeControllerBridge();
  armControllerBridge();
});

afterEach(() => {
  disposeControllerBridge();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function frame() {
  for (const callback of frames.splice(0)) callback(performance.now());
}

function input(action: string) {
  controllerHandler({ payload: { action, at: Date.now() } });
}

function finishLoading() {
  content.innerHTML =
    '<article data-controller-item="game-card" tabindex="-1">A game</article>';
  (content.firstElementChild as HTMLElement).scrollIntoView = vi.fn();
  content.setAttribute("aria-busy", "false");
  frame();
  return content.firstElementChild;
}

it.each(["reveal", "navigation"])(
  "waits for deferred library content before focusing it via %s",
  (entry) => {
    if (entry === "reveal") input("reveal");
    else {
      document.querySelector<HTMLElement>("#nav-games")!.focus();
      input("confirm");
    }
    expect(useAppStore.getState().activeView).toBe("games");
    const focused = document.activeElement;
    // The view can take more than the old four-frame retry limit to mount.
    for (let index = 0; index < 8; index++) frame();
    expect(document.activeElement).toBe(focused);
    expect(
      content.querySelector('[data-controller-selected="true"]'),
    ).toBeNull();
    const card = finishLoading();
    expect(document.activeElement).toBe(card);
    expect(card?.getAttribute("data-controller-selected")).toBe("true");
  },
);

it("does not move focus back after the user leaves a loading library", () => {
  input("reveal");
  frame();
  useAppStore.getState().setActiveView("now");
  const navigation = document.querySelector<HTMLElement>("#nav-now")!;
  navigation.focus();
  finishLoading();
  expect(document.activeElement).toBe(navigation);
  expect(frames).toHaveLength(0);
});
