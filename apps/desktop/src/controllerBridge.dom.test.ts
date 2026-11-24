// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import {
  armControllerBridge,
  CONTROLLER_DETAILS_EVENT,
  disposeControllerBridge,
  initializeControllerBridge,
  selectControllerItem,
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
    <button id="select" data-controller-item="library-option">Select games</button>
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

it("keeps arrow keys working after Space opens another view from the sidebar", () => {
  showLibrary();
  const [nowNav, gamesNav] = ["#nav-now", "#nav-games"].map(
    (id) => document.querySelector<HTMLElement>(id)!,
  );
  nowNav.getBoundingClientRect = () =>
    ({ top: 0, left: 0, width: 160, height: 40 }) as DOMRect;
  gamesNav.getBoundingClientRect = () =>
    ({ top: 50, left: 0, width: 160, height: 40 }) as DOMRect;
  gamesNav.setAttribute("data-controller-active-view", "true");
  nowNav.addEventListener("click", () => {
    useAppStore.getState().setActiveView("now");
    gamesNav.removeAttribute("data-controller-active-view");
    nowNav.setAttribute("data-controller-active-view", "true");
    content.innerHTML = "<p>Now playing</p>";
  });

  press("ArrowRight");
  press("ArrowLeft");
  expect(document.activeElement).toBe(gamesNav);
  press("ArrowUp");
  expect(document.activeElement).toBe(nowNav);
  press(" ");
  frame();
  expect(useAppStore.getState().activeView).toBe("now");
  expect(document.activeElement).toBe(content);
  expect(
    document.querySelector('[data-controller-selected="true"]'),
  ).toBeNull();

  // Up and Down scroll the view natively; Left goes back to the sidebar.
  expect(press("ArrowDown").defaultPrevented).toBe(false);
  press("ArrowLeft");
  expect(document.activeElement).toBe(nowNav);
  expect(nowNav.getAttribute("data-controller-selected")).toBe("true");
  press("ArrowDown");
  expect(document.activeElement).toBe(gamesNav);
});

it("leaves other views' arrow keys alone when nothing is selected", () => {
  useAppStore.getState().setActiveView("now");
  expect(press("ArrowDown").defaultPrevented).toBe(false);
  expect(press("ArrowLeft").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(document.body);
});

it("drops the ring when focus moves away or the mouse is pressed", () => {
  showLibrary();
  press("ArrowRight");
  const card = document.querySelector<HTMLElement>("#card-a")!;
  expect(card.getAttribute("data-controller-selected")).toBe("true");
  document.querySelector<HTMLElement>("#search")!.focus();
  expect(card.hasAttribute("data-controller-selected")).toBe(false);

  card.focus();
  press("ArrowRight");
  const next = document.querySelector<HTMLElement>("#card-b")!;
  expect(next.getAttribute("data-controller-selected")).toBe("true");
  document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(next.hasAttribute("data-controller-selected")).toBe(false);
});

it("keeps the arrow keys and the controller off the controls above the cards", () => {
  showLibrary();
  press("ArrowRight");
  const card = document.querySelector<HTMLElement>("#card-a")!;
  expect(press("ArrowUp").defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(card);

  const select = document.querySelector<HTMLElement>("#select")!;
  select.focus();
  expect(press("ArrowDown").defaultPrevented).toBe(false);
  expect(press("Enter").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(select);

  // The controller stays on the cards too.
  useAppStore.setState((state) => ({
    settings: { ...state.settings, controllerNavigationEnabled: true },
  }));
  card.focus();
  input("up");
  expect(document.activeElement).toBe(card);
  input("right");
  input("left");
  expect(document.activeElement?.id).toBe("card-a");
});

it("keeps the controller on the sidebar when A opens a view without cards, and Right enters it to scroll", () => {
  const nowNav = document.querySelector<HTMLElement>("#nav-now")!;
  nowNav.addEventListener("click", () => {
    useAppStore.getState().setActiveView("now");
    nowNav.setAttribute("data-controller-active-view", "true");
    content.innerHTML =
      '<button id="now-action" data-controller-item="library-option">Stop tracking</button>';
    content.setAttribute("aria-busy", "false");
  });
  useAppStore.getState().setActiveView("games");
  nowNav.focus();

  input("confirm");
  frame();
  expect(useAppStore.getState().activeView).toBe("now");
  expect(document.activeElement).toBe(nowNav);
  expect(nowNav.getAttribute("data-controller-selected")).toBe("true");

  // Right enters the view itself, so the right stick scrolls it.
  const scrollBy = vi.fn();
  content.scrollBy = scrollBy;
  input("right");
  expect(document.activeElement).toBe(content);
  expect(
    document.querySelector('[data-controller-selected="true"]'),
  ).toBeNull();
  input("scrollDown");
  expect(scrollBy).toHaveBeenCalledWith({ top: 34, behavior: "auto" });

  input("left");
  expect(document.activeElement).toBe(nowNav);
});

it.each(["controller", "keyboard"])(
  "walks from My Games into its source tabs and opens one with the %s",
  (mode) => {
    const launches = showLibrary();
    const aside = document.querySelector("aside")!;
    aside.insertAdjacentHTML(
      "beforeend",
      `<div role="tablist">
        <button id="tab-all" data-controller-item="library-tab" aria-selected="true">All</button>
        <button id="tab-steam" data-controller-item="library-tab">Steam</button>
      </div>`,
    );
    const sidebar = ["#nav-now", "#nav-games", "#tab-all", "#tab-steam"].map(
      (id) => document.querySelector<HTMLElement>(id)!,
    );
    sidebar.forEach((item, index) => {
      item.scrollIntoView = vi.fn();
      item.getBoundingClientRect = () =>
        ({ top: index * 50, left: 0, width: 160, height: 40 }) as DOMRect;
    });
    const [, gamesNav, allTab, steamTab] = sidebar;
    const steamOpened = vi.fn();
    steamTab.addEventListener("click", steamOpened);
    const move = (action: "up" | "down" | "confirm") => {
      if (mode === "controller") input(action);
      else
        press({ up: "ArrowUp", down: "ArrowDown", confirm: "Enter" }[action]);
    };
    if (mode === "controller")
      useAppStore.setState((state) => ({
        settings: { ...state.settings, controllerNavigationEnabled: true },
      }));

    gamesNav.focus();
    move("down");
    expect(document.activeElement).toBe(allTab);
    expect(allTab.getAttribute("data-controller-selected")).toBe("true");
    move("down");
    expect(document.activeElement).toBe(steamTab);
    move("up");
    move("up");
    expect(document.activeElement).toBe(gamesNav);

    move("down");
    move("down");
    move("confirm");
    frame();
    expect(steamOpened).toHaveBeenCalledTimes(1);
    expect(launches.a).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe("card-a");
  },
);

it("reaches every control inside an open dialog", () => {
  showLibrary();
  useAppStore.setState((state) => ({
    settings: { ...state.settings, controllerNavigationEnabled: true },
  }));
  document.body.insertAdjacentHTML(
    "beforeend",
    `<div role="dialog" aria-modal="true">
      <button id="dialog-cancel" data-controller-item="library-option">Cancel</button>
      <button id="dialog-ok" data-controller-item="library-option">OK</button>
    </div>`,
  );
  const ok = document.querySelector<HTMLElement>("#dialog-ok")!;
  ok.scrollIntoView = vi.fn();
  const clicked = vi.fn();
  ok.addEventListener("click", clicked);
  document.querySelector<HTMLElement>("#dialog-cancel")!.scrollIntoView =
    vi.fn();
  document.querySelector<HTMLElement>("#dialog-cancel")!.focus();

  input("right");
  expect(document.activeElement).toBe(ok);
  input("confirm");
  expect(clicked).toHaveBeenCalledTimes(1);
});

it("lets go of the selected card and its ring on Escape", () => {
  showLibrary();
  press("ArrowRight");
  const card = document.querySelector<HTMLElement>("#card-a")!;
  expect(card.getAttribute("data-controller-selected")).toBe("true");
  expect(press("Escape").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(document.body);
  expect(card.hasAttribute("data-controller-selected")).toBe(false);

  // Escape in a text field stays with the field.
  const search = document.querySelector<HTMLElement>("#search")!;
  search.focus();
  press("Escape");
  expect(document.activeElement).toBe(search);
});

it("closes the game on the selected running card with X / Square, never elsewhere", () => {
  showLibrary();
  useAppStore.setState((state) => ({
    settings: { ...state.settings, controllerNavigationEnabled: true },
  }));
  const stop = document.createElement("button");
  stop.setAttribute("data-controller-stop", "");
  const stopped = vi.fn();
  stop.addEventListener("click", stopped);
  document.querySelector("#card-b")!.append(stop);

  input("right");
  expect(document.activeElement?.id).toBe("card-a");
  input("stopGame");
  expect(stopped).not.toHaveBeenCalled();

  input("right");
  expect(document.activeElement?.id).toBe("card-b");
  input("stopGame");
  expect(stopped).toHaveBeenCalledTimes(1);

  document.body.insertAdjacentHTML(
    "beforeend",
    '<div role="dialog" aria-modal="true"></div>',
  );
  input("stopGame");
  expect(stopped).toHaveBeenCalledTimes(1);
});

it("moves the ring to a dialog's new safe button only while a controller drives the app", () => {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div role="dialog" aria-modal="true"><button id="safe" data-controller-item="dialog-action">Cancel</button></div>',
  );
  const safe = document.querySelector<HTMLElement>("#safe")!;
  safe.scrollIntoView = vi.fn();

  selectControllerItem(safe);
  expect(document.activeElement).toBe(safe);
  expect(safe.hasAttribute("data-controller-selected")).toBe(false);

  safe.blur();
  document.documentElement.setAttribute("data-controller-mode", "true");
  selectControllerItem(safe);
  expect(document.activeElement).toBe(safe);
  expect(safe.getAttribute("data-controller-selected")).toBe("true");
  document.documentElement.removeAttribute("data-controller-mode");
});

function enableController() {
  useAppStore.setState((state) => ({
    settings: { ...state.settings, controllerNavigationEnabled: true },
  }));
}

/** A tab row like Achievements, My History and Details have: a click
 *  selects the tab. */
function tabRow(container: Element, ids: string[], autofocus = false) {
  container.insertAdjacentHTML(
    "beforeend",
    `<div role="tablist">${ids
      .map(
        (id, index) =>
          `<button role="tab" id="${id}" aria-selected="${index === 0}"${
            autofocus && index === 0 ? " data-autofocus" : ""
          }>${id}</button>`,
      )
      .join("")}</div>`,
  );
  const tabs = ids.map((id) => document.getElementById(id)!);
  for (const tab of tabs) {
    tab.scrollIntoView = vi.fn();
    tab.addEventListener("click", () => {
      for (const other of tabs)
        other.setAttribute("aria-selected", String(other === tab));
    });
  }
  return tabs;
}

function openTab(tabs: HTMLElement[]) {
  return tabs.find((tab) => tab.getAttribute("aria-selected") === "true")?.id;
}

function modal() {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);
  return dialog;
}

it("opens the selected card's Details with Y / Triangle, never from the sidebar or a dialog", () => {
  showLibrary();
  enableController();
  const opened = { a: vi.fn(), b: vi.fn() };
  document
    .querySelector("#card-a")!
    .addEventListener(CONTROLLER_DETAILS_EVENT, opened.a);
  const cardB = document.querySelector("#card-b")!;
  cardB.addEventListener(CONTROLLER_DETAILS_EVENT, opened.b);
  // Details opens as a dialog with its tab row on top.
  let detailsTabs: HTMLElement[] = [];
  cardB.addEventListener(CONTROLLER_DETAILS_EVENT, () => {
    detailsTabs = tabRow(modal(), ["details-general", "details-files"], true);
  });

  document.querySelector<HTMLElement>("#nav-games")!.focus();
  input("openDetails");
  expect(opened.a).not.toHaveBeenCalled();
  expect(opened.b).not.toHaveBeenCalled();

  input("right");
  input("right");
  expect(document.activeElement?.id).toBe("card-b");
  input("openDetails");
  expect(opened.b).toHaveBeenCalledTimes(1);
  expect(opened.a).not.toHaveBeenCalled();
  // The ring moves onto Details' open tab.
  frame();
  expect(document.activeElement).toBe(detailsTabs[0]);
  expect(detailsTabs[0].getAttribute("data-controller-selected")).toBe("true");

  input("openDetails");
  expect(opened.b).toHaveBeenCalledTimes(1);
});

it("switches the view's tabs with LB / RB, round like the arrow keys, and leaves the ring where it is", () => {
  enableController();
  useAppStore.getState().setActiveView("history");
  content.setAttribute("aria-busy", "false");
  const tabs = tabRow(content, ["sessions", "insights", "games"]);
  const nav = document.querySelector<HTMLElement>("#nav-now")!;
  nav.focus();

  input("nextTab");
  expect(openTab(tabs)).toBe("insights");
  input("nextTab");
  input("nextTab");
  expect(openTab(tabs)).toBe("sessions");
  input("previousTab");
  expect(openTab(tabs)).toBe("games");
  expect(document.activeElement).toBe(nav);
});

it("switches the open dialog's tabs, not the view's, and the ring follows the tab", () => {
  enableController();
  useAppStore.getState().setActiveView("achievements");
  content.setAttribute("aria-busy", "false");
  const viewTabs = tabRow(content, ["milestones", "ladders"]);
  const dialogTabs = tabRow(modal(), ["general", "files", "notes"]);
  dialogTabs[0].focus();

  input("nextTab");
  expect(openTab(dialogTabs)).toBe("files");
  expect(openTab(viewTabs)).toBe("milestones");
  expect(document.activeElement).toBe(dialogTabs[1]);
  expect(dialogTabs[1].getAttribute("data-controller-selected")).toBe("true");
  input("previousTab");
  input("previousTab");
  expect(openTab(dialogTabs)).toBe("notes");
});

function showSettings() {
  enableController();
  useAppStore.getState().setActiveView("settings");
  const nav = document.querySelector<HTMLElement>("#nav-now")!;
  nav.setAttribute("data-controller-active-view", "true");
  content.innerHTML = `
    <div id="settings" data-controller-controls>
      <nav id="settings-menu" data-controller-menu>
        <input id="settings-search" type="search" />
        <button id="menu-general">General</button>
        <button id="menu-play" aria-current="page">Play</button>
      </nav>
      <div>
        <input id="switch-a" type="checkbox" />
        <button id="seg-off" aria-pressed="true">Off</button>
        <button id="seg-on" aria-pressed="false">On</button>
        <select id="reminder">
          <option value="off">Off</option>
          <option value="30" disabled>30 min</option>
          <option value="60">60 min</option>
        </select>
        <input id="switch-off" type="checkbox" disabled />
        <button id="reset">Reset</button>
      </div>
    </div>
  `;
  content.setAttribute("aria-busy", "false");
  // A wide window: the menu is a column left of the page.
  place({
    settings: [0, -50, 700, 300],
    "settings-menu": [0, -50, 160, 140],
    "settings-search": [0, -50, 160, 38],
    "menu-general": [0, 0, 160, 38],
    "menu-play": [0, 50, 160, 38],
    "switch-a": [600, 0, 40, 24],
    "seg-off": [500, 60, 60, 30],
    "seg-on": [570, 60, 60, 30],
    reminder: [520, 110, 120, 30],
    "switch-off": [600, 160, 40, 24],
    reset: [560, 210, 80, 30],
  });
  const byId = (id: string) => document.getElementById(id)!;
  return { nav, byId };
}

function place(at: Record<string, [number, number, number, number]>) {
  for (const [id, [left, top, width, height]] of Object.entries(at)) {
    const element = document.getElementById(id)!;
    element.scrollIntoView = vi.fn();
    element.getBoundingClientRect = () =>
      ({ left, top, width, height }) as DOMRect;
  }
}

it("goes down from the settings menu into the page when a narrow window puts the menu above it", () => {
  const { byId } = showSettings();
  place({
    settings: [0, 0, 700, 300],
    "settings-menu": [0, 0, 700, 40],
    "settings-search": [0, 0, 700, 38],
    "menu-general": [0, 40, 100, 38],
    "menu-play": [110, 40, 100, 38],
    "switch-a": [600, 100, 40, 24],
    "seg-off": [0, 150, 60, 30],
    "seg-on": [70, 150, 60, 30],
    reminder: [0, 200, 120, 30],
    "switch-off": [600, 250, 40, 24],
    reset: [0, 280, 80, 30],
  });
  byId("menu-play").focus();

  input("down");
  expect(document.activeElement).toBe(byId("seg-on"));
  input("left");
  expect(document.activeElement).toBe(byId("seg-off"));
  // The page's left edge: back up to the open page's menu item.
  input("left");
  expect(document.activeElement).toBe(byId("menu-play"));
});

it("walks the settings menu and page with the controller and works their switches and buttons", () => {
  const { nav, byId } = showSettings();
  const segOn = vi.fn();
  byId("seg-on").addEventListener("click", segOn);
  nav.focus();

  // Right enters at the open page's menu item, then the page beside it.
  input("right");
  expect(document.activeElement).toBe(byId("menu-play"));
  expect(byId("menu-play").getAttribute("data-controller-selected")).toBe(
    "true",
  );
  input("up");
  expect(document.activeElement).toBe(byId("menu-general"));
  input("down");
  input("right");
  expect(document.activeElement).toBe(byId("seg-off"));
  input("right");
  input("confirm");
  expect(segOn).toHaveBeenCalledTimes(1);

  input("up");
  expect(document.activeElement).toBe(byId("switch-a"));
  input("confirm");
  expect((byId("switch-a") as HTMLInputElement).checked).toBe(true);
  // Nothing right of a switch: it stays, it doesn't jump to the next row.
  input("right");
  expect(document.activeElement).toBe(byId("switch-a"));

  // A switch that is off is skipped.
  input("down");
  input("down");
  expect(document.activeElement).toBe(byId("reminder"));
  input("down");
  expect(document.activeElement).toBe(byId("reset"));

  // Left from the page goes to the open page's menu item, then the sidebar.
  input("left");
  expect(document.activeElement).toBe(byId("menu-play"));
  input("left");
  expect(document.activeElement).toBe(nav);
});

it("changes a settings dropdown with Left and Right, skipping choices that are off", () => {
  const { byId } = showSettings();
  const select = byId("reminder") as HTMLSelectElement;
  const changed = vi.fn();
  select.addEventListener("change", () => changed(select.value));
  select.focus();

  input("right");
  expect(select.value).toBe("60");
  expect(changed).toHaveBeenLastCalledWith("60");
  input("left");
  expect(select.value).toBe("off");
  expect(changed).toHaveBeenCalledTimes(2);
  expect(document.activeElement).toBe(select);
});

it("stays on the language dropdown when the new language builds the page anew", () => {
  enableController();
  useAppStore.getState().setActiveView("settings");
  content.setAttribute("aria-busy", "false");
  // Like App: a new language remounts the page, every element is new.
  let build = 0;
  const render = (language: string) => {
    build += 1;
    content.innerHTML = `
      <div data-controller-controls>
        <nav data-controller-menu>
          <button id="menu-general" aria-current="page">General</button>
        </nav>
        <div data-row="theme"><input type="checkbox" /></div>
        <div data-row="language">
          <span>Language</span>
          <select id="language-${build}">
            <option value="system">System</option>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </div>
      </div>
    `;
    for (const element of content.querySelectorAll<HTMLElement>("*"))
      element.scrollIntoView = vi.fn();
    const select = content.querySelector<HTMLSelectElement>("select")!;
    select.value = language;
    select.addEventListener("change", () => render(select.value));
    return select;
  };
  render("system").focus();

  input("right");
  frame();
  const rebuilt = content.querySelector<HTMLSelectElement>("select")!;
  expect(rebuilt.id).toBe("language-2");
  expect(rebuilt.value).toBe("en");
  expect(document.activeElement).toBe(rebuilt);
  expect(rebuilt.getAttribute("data-controller-selected")).toBe("true");

  // Right goes straight on to the next language.
  input("right");
  frame();
  expect(content.querySelector("select")!.value).toBe("de");
  expect(document.activeElement?.id).toBe("language-3");
});

it("leaves the settings controls to the keyboard's own keys", () => {
  const { nav, byId } = showSettings();
  byId("switch-a").focus();
  expect(press("ArrowDown").defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(byId("switch-a"));

  // From the sidebar, Right still enters the view to scroll it.
  nav.focus();
  press("ArrowRight");
  expect(document.activeElement).toBe(content);
});
