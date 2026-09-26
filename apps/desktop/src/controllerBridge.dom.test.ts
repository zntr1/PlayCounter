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

function showLibrary() {
  useAppStore.setState((state) => ({
    activeView: "games",
    settings: { ...state.settings, controllerNavigationEnabled: false },
  }));
  content.innerHTML = `
    <input id="search" type="search" data-controller-item="library-option" />
    <article id="card-a" data-controller-item="game-card" tabindex="-1">
      <button data-controller-launch="game" hidden></button>A
    </article>
    <article id="card-b" data-controller-item="game-card" tabindex="-1">
      <button data-controller-launch="game" hidden></button>B
    </article>
  `;
  content.setAttribute("aria-busy", "false");
  for (const element of content.querySelectorAll<HTMLElement>("*"))
    element.scrollIntoView = vi.fn();
  // Two cards side by side in one row.
  for (const [id, left] of [
    ["card-a", 0],
    ["card-b", 200],
  ] as const)
    content.querySelector<HTMLElement>(`#${id}`)!.getBoundingClientRect = () =>
      ({ top: 100, left, width: 180, height: 240 }) as DOMRect;
  const launch = (card: string) =>
    content.querySelector<HTMLButtonElement>(
      `#${card} [data-controller-launch]`,
    )!;
  const launches = { a: vi.fn(), b: vi.fn() };
  launch("card-a").addEventListener("click", launches.a);
  launch("card-b").addEventListener("click", launches.b);
  return launches;
}

function press(key: string) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

it("moves between library cards with the arrow keys and launches with Enter or Space", () => {
  const launches = showLibrary();
  press("ArrowRight");
  expect(document.activeElement?.id).toBe("card-a");
  expect(document.activeElement?.getAttribute("data-controller-selected")).toBe(
    "true",
  );
  expect(press("ArrowRight").defaultPrevented).toBe(true);
  expect(document.activeElement?.id).toBe("card-b");
  press("Enter");
  expect(launches.b).toHaveBeenCalledTimes(1);
  press("ArrowLeft");
  press(" ");
  expect(launches.a).toHaveBeenCalledTimes(1);
});

it("leaves arrow keys alone while typing in a text field", () => {
  showLibrary();
  const search = document.querySelector<HTMLElement>("#search")!;
  search.focus();
  expect(press("ArrowRight").defaultPrevented).toBe(false);
  expect(press("Enter").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(search);
});

it("ignores library keys outside the library and when launching is off", () => {
  const launches = showLibrary();
  useAppStore.getState().setActiveView("now");
  expect(press("ArrowRight").defaultPrevented).toBe(false);
  useAppStore.getState().setActiveView("games");
  useAppStore.setState((state) => ({
    settings: { ...state.settings, gameLaunchingEnabled: false },
  }));
  expect(press("ArrowRight").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(document.body);
  expect(launches.a).not.toHaveBeenCalled();
});

it("does not launch with Enter when no card is selected", () => {
  const launches = showLibrary();
  expect(press("Enter").defaultPrevented).toBe(false);
  expect(launches.a).not.toHaveBeenCalled();
});
