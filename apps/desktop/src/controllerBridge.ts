import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toggleFullscreen } from "./fullscreen";
import { currentPlatform } from "./platform";
import { useAppStore } from "./store";
import {
  isLeftmostVisualItem,
  nextControllerIndex,
  type ControllerAction,
  type ControllerItemRect,
} from "./controllerInput";
import { setControllerKind, type ControllerKind } from "./controllerKind";

type ControllerEvent = {
  action: ControllerAction;
  at: number;
  kind?: ControllerKind;
};

export const CONTROLLER_MODE_EVENT = "playcounter:controller-mode";
export const CONTROLLER_LIBRARY_VIEW_EVENT =
  "playcounter:controller-library-view";
/** Sent to the selected game card: Y / Triangle asks for its Details. */
export const CONTROLLER_DETAILS_EVENT = "playcounter:controller-details";

type ControllerBridgeState = {
  armed: boolean;
  disposed: boolean;
  /** What the watcher was started for: "navigation|counting", or false. */
  watching: string | false;
  teardown: Array<() => void>;
};

let bridge: ControllerBridgeState | null = null;

function controllerSupported() {
  try {
    return currentPlatform() === "windows";
  } catch {
    return false;
  }
}

async function setWatcher(
  state: ControllerBridgeState,
  flags: { navigation: boolean; counting: boolean },
  readPads = shouldReadPads(state),
) {
  // Reading pads for auto pause alone sends no actions: the watcher only
  // notes when a pad last moved (play_activity asks for it).
  const enabled = flags.navigation || flags.counting || readPads;
  const watching = enabled ? `${flags.navigation}|${flags.counting}` : false;
  if (state.disposed || bridge !== state || state.watching === watching) return;
  state.watching = watching;
  try {
    // Starting again replaces a watcher started for other settings.
    if (enabled) await invoke("controller_watch_start", flags);
    else await invoke("controller_watch_stop");
  } catch (error) {
    state.watching = false;
    console.warn("controller watcher command failed", error);
  }
}

function shouldWatch(state: ControllerBridgeState) {
  const settings = useAppStore.getState().settings;
  return (
    state.armed &&
    settings.gameLaunchingEnabled === true &&
    settings.controllerNavigationEnabled === true
  );
}

/** Counting with the controller works on its own, also with navigation off
 *  (docs/counters-plan.md). */
function shouldCount(state: ControllerBridgeState) {
  return (
    state.armed &&
    useAppStore.getState().settings.controllerCountingEnabled === true
  );
}

/** Auto pause counts controller input as input while a game runs on this
 *  PC (docs/auto-pause-plan.md). */
function shouldReadPads(state: ControllerBridgeState) {
  const { settings, activeSessions } = useAppStore.getState();
  return (
    state.armed &&
    settings.autoPauseEnabled === true &&
    activeSessions.some((session) => !session.timer && !session.console)
  );
}

function syncWatcher(state: ControllerBridgeState) {
  const navigation = shouldWatch(state);
  if (!navigation) {
    clearControllerSelection();
    emitControllerMode(false);
  }
  void setWatcher(state, { navigation, counting: shouldCount(state) });
}

function emitControllerMode(active: boolean) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CONTROLLER_MODE_EVENT, { detail: { active } }),
  );
}

export function deactivateControllerMode() {
  clearControllerSelection();
  emitControllerMode(false);
}

function track(
  state: ControllerBridgeState,
  registration: Promise<UnlistenFn>,
) {
  let unlisten: UnlistenFn | null = null;
  let cancelled = false;
  void registration.then(
    (handler) => {
      if (cancelled) handler();
      else unlisten = handler;
    },
    (error) => console.warn("controller listener failed", error),
  );
  state.teardown.push(() => {
    cancelled = true;
    unlisten?.();
    unlisten = null;
  });
}

// The keyboard and the controller walk only the cards and the sidebar: its
// views and the library's source tabs under My Games. The controls above the
// cards keep their own keyboard behavior. Inside a dialog every item is
// reachable, since that is the only way to answer it. The controller also
// walks every control of a [data-controller-controls] region (Settings); the
// keyboard leaves those to Tab and their own keys.
const SIDEBAR_ROLES = new Set(["navigation", "library-tab"]);
const NAVIGABLE_ROLES = new Set(["game-card", ...SIDEBAR_ROLES]);
const CONTROL_SELECTOR = [
  "button",
  "select",
  "a[href]",
  'input[type="checkbox"]',
  'input[type="radio"]',
]
  .map((control) => "[data-controller-controls] " + control)
  .join(", ");

function isSidebarItem(item: Element) {
  return SIDEBAR_ROLES.has(item.getAttribute("data-controller-item") ?? "");
}

function isControl(item: Element) {
  return (
    !item.hasAttribute("data-controller-item") &&
    item.closest("[data-controller-controls]") !== null
  );
}

function isNavigableItem(item: Element, keyboard = false) {
  return (
    NAVIGABLE_ROLES.has(item.getAttribute("data-controller-item") ?? "") ||
    (!keyboard && isControl(item))
  );
}

function topDialog() {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    ),
  ].at(-1);
}

function isShown(item: HTMLElement, root: Document | HTMLElement) {
  if (item.offsetParent === null) return false;
  for (
    let current: HTMLElement | null = item;
    current;
    current = current.parentElement
  ) {
    const style = getComputedStyle(current);
    if (
      current.hidden ||
      current.getAttribute("aria-hidden") === "true" ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) < 0.05
    ) {
      return false;
    }
    if (current === root) break;
  }
  return true;
}

function controllerItems(keyboard = false) {
  if (typeof document === "undefined") return [];
  const root: Document | HTMLElement = topDialog() ?? document;
  const selector =
    root === document && !keyboard
      ? "[data-controller-item], " + CONTROL_SELECTOR
      : "[data-controller-item]";
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (item, index, items) => {
      if (items.indexOf(item) !== index || item.offsetParent === null)
        return false;
      if (root === document && !isNavigableItem(item, keyboard)) return false;
      if (
        item.hasAttribute("disabled") ||
        item.getAttribute("aria-disabled") === "true" ||
        item.matches("[data-controller-launch]") ||
        item.closest("[data-controller-ignore]")
      ) {
        return false;
      }
      const card = item.closest<HTMLElement>(
        '[data-controller-item="game-card"]',
      );
      if (card && card !== item) return false;
      return isShown(item, root);
    },
  );
}

function clearControllerSelection() {
  if (typeof document === "undefined") return;
  for (const item of document.querySelectorAll<HTMLElement>(
    '[data-controller-selected="true"]',
  )) {
    item.removeAttribute("data-controller-selected");
  }
}

function focusItem(item: HTMLElement | undefined) {
  if (!item) return;
  clearControllerSelection();
  item.setAttribute("data-controller-selected", "true");
  item.scrollIntoView({
    block:
      item.getAttribute("data-controller-item") === "game-card"
        ? "center"
        : "nearest",
    inline: "nearest",
  });
  item.focus({ preventScroll: true });
}

function focusFirstItemWhenReady(state: ControllerBridgeState, attempt = 0) {
  if (
    bridge !== state ||
    state.disposed ||
    !shouldWatch(state) ||
    useAppStore.getState().activeView !== "games"
  )
    return;
  // The sidebar can paint before the deferred library has mounted. Wait for
  // that commit instead of selecting a navigation button from the loading view.
  if (
    typeof document !== "undefined" &&
    document.querySelector('[data-controller-content][aria-busy="true"]')
  ) {
    globalThis.requestAnimationFrame?.(() => focusFirstItemWhenReady(state));
    return;
  }
  const items = controllerItems();
  const first = preferredControllerItem(items);
  if (first) {
    focusItem(first);
    return;
  }
  if (attempt >= 4 || !globalThis.requestAnimationFrame) return;
  globalThis.requestAnimationFrame(() =>
    focusFirstItemWhenReady(state, attempt + 1),
  );
}

function focusViewContentWhenReady(
  keyboard: boolean,
  view = useAppStore.getState().activeView,
) {
  if (!globalThis.requestAnimationFrame) return;
  globalThis.requestAnimationFrame(() => {
    // Not gated on the controller setting: the keyboard opens views too.
    if (
      useAppStore.getState().activeView !== view ||
      !bridge ||
      bridge.disposed
    )
      return;
    const content = document.querySelector<HTMLElement>(
      '[data-controller-content="true"]',
    );
    if (!content) return;
    if (content.getAttribute("aria-busy") === "true") {
      focusViewContentWhenReady(keyboard, view);
      return;
    }
    const contentItems = controllerItems(keyboard).filter((item) =>
      content.contains(item),
    );
    const preferred = preferredControllerItem(contentItems);
    if (preferred) {
      focusItem(preferred);
      return;
    }
    // With nothing to select, the controller stays where it is. The keyboard
    // moves into the view so the arrow keys scroll it.
    if (!keyboard) return;
    clearControllerSelection();
    content.focus({ preventScroll: true });
  });
}

function preferredControllerItem(items: HTMLElement[]) {
  return (
    items.find(
      (item) => item.getAttribute("data-controller-item") === "game-card",
    ) ??
    // Settings: the menu item of the page that is open.
    items.find(
      (item) => isControl(item) && item.getAttribute("aria-current") === "page",
    ) ??
    items.find((item) => item.closest('[data-tour="content"]')) ??
    items[0]
  );
}

function activeNavigationItem() {
  return document.querySelector<HTMLElement>(
    '[data-controller-active-view="true"]',
  );
}

function focusActiveNavigationItem() {
  const active = activeNavigationItem();
  if (active) focusItem(active);
}

function moveWithinItems(
  items: HTMLElement[],
  selected: HTMLElement,
  action: Extract<ControllerAction, "up" | "down" | "left" | "right">,
  readingOrder = true,
) {
  const current = items.indexOf(selected);
  if (current < 0) return;
  const rects: ControllerItemRect[] = items.map((item) =>
    item.getBoundingClientRect(),
  );
  focusItem(
    items[nextControllerIndex(rects, current, action, { readingOrder })],
  );
}

// Settings: in a wide window the menu is a column beside the open page. Up
// and Down stay in their column, Right goes from the menu into the page. In a
// narrow one the menu is a row above the page and Down goes into it. Left at
// the page's left edge goes to the open page's menu item, from the menu to
// the sidebar. On a dropdown Left and Right change its value: a pad can't
// work its list.
function moveAmongControls(
  items: HTMLElement[],
  selected: HTMLElement,
  action: Extract<ControllerAction, "up" | "down" | "left" | "right">,
) {
  if (
    selected instanceof HTMLSelectElement &&
    (action === "left" || action === "right")
  ) {
    stepSelect(selected, action === "right" ? 1 : -1);
    return;
  }
  const controls = items.filter(isControl);
  const region = selected.closest<HTMLElement>("[data-controller-controls]");
  const menu =
    region?.querySelector<HTMLElement>("[data-controller-menu]") ?? null;
  const inMenu = menu?.contains(selected) ?? false;
  if (action === "right") {
    moveWithinItems(controls, selected, action, false);
    return;
  }
  const menuBeside =
    region !== null &&
    menu !== null &&
    menu.getBoundingClientRect().width <
      region.getBoundingClientRect().width / 2;
  const column = menuBeside
    ? controls.filter((item) => menu.contains(item) === inMenu)
    : controls;
  if (action === "left") {
    const rects: ControllerItemRect[] = column.map((item) =>
      item.getBoundingClientRect(),
    );
    if (isLeftmostVisualItem(rects, column.indexOf(selected))) {
      const openPage = inMenu
        ? undefined
        : controls.find(
            (item) =>
              menu?.contains(item) &&
              item.getAttribute("aria-current") === "page",
          );
      if (openPage) focusItem(openPage);
      else focusActiveNavigationItem();
      return;
    }
  }
  moveWithinItems(column, selected, action, false);
}

function stepSelect(select: HTMLSelectElement, step: 1 | -1) {
  for (
    let index = select.selectedIndex + step;
    index >= 0 && index < select.options.length;
    index += step
  ) {
    const option = select.options[index]!;
    if (option.disabled || option.hidden) continue;
    const followRebuilt = rememberControlPlace(select);
    select.selectedIndex = index;
    // React's onChange listens for this event.
    select.dispatchEvent(new Event("change", { bubbles: true }));
    followRebuilt();
    return;
  }
}

// A change can build the page anew: a new language remounts it. The ring
// then moves to the control in the same place of the same settings row, so
// the next press goes on from there. Taken before the change, called after.
function rememberControlPlace(control: HTMLElement) {
  const row = control.closest("[data-row]");
  const rowId = row?.getAttribute("data-row");
  if (!row || !rowId) return () => {};
  const rowControls = (element: Element) =>
    controllerItems().filter(
      (item) => isControl(item) && element.contains(item),
    );
  const place = rowControls(row).indexOf(control);
  const follow = (attempt: number) => {
    globalThis.requestAnimationFrame?.(() => {
      if (control.isConnected) {
        if (attempt < 2) follow(attempt + 1);
        return;
      }
      // Something else took focus meanwhile: leave it there.
      if (document.activeElement && document.activeElement !== document.body)
        return;
      const rebuilt = [...document.querySelectorAll("[data-row]")].find(
        (element) => element.getAttribute("data-row") === rowId,
      );
      const replacement = rebuilt ? rowControls(rebuilt)[place] : undefined;
      if (replacement) focusItem(replacement);
    });
  };
  return () => follow(0);
}

function activateItem(item: HTMLElement | undefined, keyboard: boolean) {
  if (!item) return;
  const role = item.getAttribute("data-controller-item");
  if (isSidebarItem(item) || role === "view-link") {
    item.click();
    // The controller stays on the sidebar, except in My Games (and its source
    // tabs) where the cards are what it moves through.
    if (
      keyboard ||
      role === "view-link" ||
      useAppStore.getState().activeView === "games"
    ) {
      focusViewContentWhenReady(keyboard);
    }
    return;
  }
  const launchControl = item.matches("[data-controller-launch]")
    ? item
    : item.querySelector<HTMLElement>("[data-controller-launch]");
  if (launchControl) {
    launchControl.click();
    focusOpenedDialogWhenReady();
    return;
  }
  if (item instanceof HTMLSelectElement && "showPicker" in item) {
    try {
      item.showPicker();
      return;
    } catch {
      // Fall back to the regular click below.
    }
  }
  const followRebuilt = isControl(item) ? rememberControlPlace(item) : () => {};
  item.click();
  focusOpenedDialogWhenReady();
  followRebuilt();
}

/** For a dialog that swaps its buttons: selects the one it names, so A /
 *  Cross never lands on a button the player did not pick. */
export function selectControllerItem(item: HTMLElement | null | undefined) {
  if (!item) return;
  if (document.documentElement.getAttribute("data-controller-mode") === "true")
    focusItem(item);
  else item.focus();
}

function selectedGameCard() {
  return document.querySelector<HTMLElement>(
    '[data-controller-item="game-card"][data-controller-selected="true"]',
  );
}

// Y / Triangle opens Details of the selected card. In a dialog the button
// does nothing.
function openSelectedDetails() {
  if (topDialog()) return;
  const card = selectedGameCard();
  if (!card) return;
  card.dispatchEvent(new CustomEvent(CONTROLLER_DETAILS_EVENT));
  focusOpenedDialogWhenReady();
}

// LB / RB (L1 / R1) open the tab before or after the open one, round like
// the arrow keys: in the open dialog, else in the view. A ring on the tab
// row moves along.
function switchTab(step: 1 | -1) {
  const scope =
    topDialog() ??
    document.querySelector<HTMLElement>('[data-controller-content="true"]');
  if (!scope) return;
  const tablist = [
    ...scope.querySelectorAll<HTMLElement>('[role="tablist"]'),
  ].find((list) => isShown(list, scope));
  if (!tablist) return;
  const tabs = [
    ...tablist.querySelectorAll<HTMLElement>('[role="tab"]'),
  ].filter(
    (tab) =>
      isShown(tab, scope) &&
      !tab.hasAttribute("disabled") &&
      tab.getAttribute("aria-disabled") !== "true",
  );
  if (tabs.length < 2) return;
  const current = tabs.findIndex(
    (tab) => tab.getAttribute("aria-selected") === "true",
  );
  const next =
    current < 0
      ? tabs[step > 0 ? 0 : tabs.length - 1]
      : tabs[(current + step + tabs.length) % tabs.length];
  const ringOnTabs = tablist.contains(document.activeElement);
  next?.click();
  if (ringOnTabs) focusItem(next);
}

// X / Square asks to close the game on the selected card. Only a running
// card has a stop control; in a dialog the button does nothing.
function stopSelectedGame() {
  if (topDialog()) return;
  const stopControl = selectedGameCard()?.querySelector<HTMLButtonElement>(
    "[data-controller-stop]",
  );
  if (!stopControl || stopControl.disabled) return;
  stopControl.click();
  focusOpenedDialogWhenReady();
}

function focusOpenedDialogWhenReady(attempt = 0) {
  if (!globalThis.requestAnimationFrame) return;
  globalThis.requestAnimationFrame(() => {
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    );
    if (dialog) {
      const items = controllerItems();
      const preferred =
        dialog.querySelector<HTMLElement>("[data-autofocus]") ??
        preferredControllerItem(items);
      focusItem(preferred);
    } else if (attempt < 2) {
      focusOpenedDialogWhenReady(attempt + 1);
    }
  });
}

function scrollCurrentView(direction: "scrollUp" | "scrollDown") {
  if (typeof document === "undefined") return;
  const focused = document.activeElement as HTMLElement | null;
  const modal = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    ),
  ].at(-1);
  const container =
    focused?.closest<HTMLElement>("[data-controller-scroll]") ??
    modal?.querySelector<HTMLElement>("[data-controller-scroll]") ??
    document.querySelector<HTMLElement>('[data-tour="content"]');
  container?.scrollBy({
    top: direction === "scrollDown" ? 34 : -34,
    behavior: "auto",
  });
}

function handleControllerEvent(
  state: ControllerBridgeState,
  event: ControllerEvent,
) {
  if (bridge !== state || state.disposed || !state.armed || !shouldWatch(state))
    return;
  setControllerKind(event.kind ?? "xbox");
  emitControllerMode(true);
  if (event.action === "toggleFullscreen") {
    void toggleFullscreen().catch((error) =>
      console.warn("fullscreen toggle failed", error),
    );
    return;
  }
  if (useAppStore.getState().activeTour) return;
  if (event.action === "scrollUp" || event.action === "scrollDown") {
    scrollCurrentView(event.action);
    return;
  }

  if (event.action === "reveal") {
    useAppStore.getState().setActiveView("games");
    globalThis.requestAnimationFrame?.(() => focusFirstItemWhenReady(state));
    return;
  }

  if (event.action === "toggleLibraryView") {
    if (useAppStore.getState().activeView === "games") {
      window.dispatchEvent(new CustomEvent(CONTROLLER_LIBRARY_VIEW_EVENT));
    }
    return;
  }

  if (event.action === "stopGame") {
    stopSelectedGame();
    return;
  }

  if (event.action === "openDetails") {
    openSelectedDetails();
    return;
  }

  if (event.action === "previousTab" || event.action === "nextTab") {
    switchTab(event.action === "nextTab" ? 1 : -1);
    return;
  }

  if (event.action === "back") {
    clearControllerSelection();
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      return;
    }
    const activeNavigation = activeNavigationItem();
    if (activeNavigation && !document.activeElement?.closest?.("aside")) {
      focusItem(activeNavigation);
      return;
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    return;
  }

  navigateItems(event.action);
}

function navigateItems(action: ControllerAction, keyboard = false) {
  const items = controllerItems(keyboard);
  if (items.length === 0) return;
  const contentRoot = document.querySelector<HTMLElement>(
    '[data-controller-content="true"]',
  );
  if (contentRoot && document.activeElement === contentRoot) {
    if (action === "left") {
      focusActiveNavigationItem();
      return;
    }
    const preferred = preferredControllerItem(
      items.filter((item) => contentRoot.contains(item)),
    );
    if (preferred) {
      focusItem(preferred);
      if (action === "confirm") activateItem(preferred, keyboard);
    }
    return;
  }
  const current = items.findIndex((item) => item === document.activeElement);
  if (
    action === "up" ||
    action === "down" ||
    action === "left" ||
    action === "right"
  ) {
    if (current < 0) {
      focusItem(preferredControllerItem(items));
      return;
    }
    const selected = items[current];
    const sidebarItems = items.filter(isSidebarItem);
    const contentItems = contentRoot
      ? items.filter((item) => contentRoot.contains(item))
      : [];

    if (sidebarItems.includes(selected)) {
      if (action === "right") {
        const preferred = preferredControllerItem(contentItems);
        // Without cards, Right enters the view itself so the right stick (or
        // the arrow keys) scroll it instead of the sidebar.
        if (preferred) focusItem(preferred);
        else if (contentRoot) {
          clearControllerSelection();
          contentRoot.focus({ preventScroll: true });
        }
      } else if (action === "up" || action === "down") {
        moveWithinItems(sidebarItems, selected, action);
      }
      return;
    }

    if (contentItems.includes(selected)) {
      const gameCards = contentItems.filter(
        (item) => item.getAttribute("data-controller-item") === "game-card",
      );
      if (gameCards.includes(selected)) {
        const cardIndex = gameCards.indexOf(selected);
        const cardRects: ControllerItemRect[] = gameCards.map((item) =>
          item.getBoundingClientRect(),
        );
        if (action === "left" && isLeftmostVisualItem(cardRects, cardIndex)) {
          focusActiveNavigationItem();
          return;
        }
        moveWithinItems(gameCards, selected, action);
        return;
      }
      if (isControl(selected)) {
        moveAmongControls(contentItems, selected, action);
        return;
      }
      moveWithinItems(contentItems, selected, action);
      return;
    }

    moveWithinItems(items, selected, action);
  } else if (action === "confirm") {
    const selected = items[current < 0 ? 0 : current];
    focusItem(selected);
    activateItem(selected, keyboard);
  }
}

const KEYBOARD_ACTIONS: Partial<Record<string, ControllerAction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "confirm",
  " ": "confirm",
  Escape: "back",
};

const TEXT_ENTRY =
  'textarea, select, [contenteditable="true"], input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"])';

// Arrow keys move like the stick between the cards and the sidebar, and
// Enter/Space act as the A button. This works without the controller setting.
// From a card or sidebar item it works in every view, so the sidebar can be
// used to leave the library. With nothing selected, only the library's cards
// take the keys; other views keep native arrow scrolling, and Left returns
// from their content to the sidebar.
function handleKeyboardNavigation(
  state: ControllerBridgeState,
  event: KeyboardEvent,
) {
  const action = KEYBOARD_ACTIONS[event.key];
  if (
    !action ||
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    bridge !== state ||
    state.disposed ||
    !state.armed
  )
    return;
  const store = useAppStore.getState();
  if (
    store.activeTour ||
    store.settings.gameLaunchingEnabled !== true ||
    document.querySelector('[role="dialog"][aria-modal="true"]')
  )
    return;
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused.matches(TEXT_ENTRY)) return;
  const content = document.querySelector('[data-controller-content="true"]');
  const onItem =
    focused instanceof HTMLElement && isNavigableItem(focused, true);
  // Escape lets go of the selected card or sidebar item and its ring. It is
  // not prevented, so other Escape handlers still see it.
  if (action === "back") {
    if (!onItem) return;
    clearControllerSelection();
    focused.blur();
    return;
  }
  if (!onItem) {
    const onNothing =
      !focused || focused === document.body || focused === content;
    if (action === "confirm" || !onNothing) return;
    const toSidebar = action === "left" && focused === content;
    const toCards =
      store.activeView === "games" &&
      controllerItems(true).some(
        (item) => item.getAttribute("data-controller-item") === "game-card",
      );
    if (!toSidebar && !toCards) return;
  }
  event.preventDefault();
  navigateItems(action, true);
}

export function initializeControllerBridge() {
  if (bridge || !controllerSupported()) return;
  const state: ControllerBridgeState = {
    armed: false,
    disposed: false,
    watching: false,
    teardown: [],
  };
  bridge = state;
  let readPads = shouldReadPads(state);
  state.teardown.push(
    useAppStore.subscribe((current, previous) => {
      const readPadsNow = shouldReadPads(state);
      if (
        current.settings.gameLaunchingEnabled !==
          previous.settings.gameLaunchingEnabled ||
        current.settings.controllerNavigationEnabled !==
          previous.settings.controllerNavigationEnabled ||
        current.settings.controllerCountingEnabled !==
          previous.settings.controllerCountingEnabled ||
        readPadsNow !== readPads
      ) {
        readPads = readPadsNow;
        syncWatcher(state);
      }
    }),
  );
  const onKeyDown = (event: KeyboardEvent) =>
    handleKeyboardNavigation(state, event);
  // The ring marks the focused item only: focus moving elsewhere (Tab, a
  // click, a view opening) or a mouse press takes it away.
  const onFocusIn = (event: FocusEvent) => {
    for (const item of document.querySelectorAll<HTMLElement>(
      '[data-controller-selected="true"]',
    )) {
      if (item !== event.target)
        item.removeAttribute("data-controller-selected");
    }
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("focusin", onFocusIn);
  window.addEventListener("pointerdown", clearControllerSelection);
  state.teardown.push(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("focusin", onFocusIn);
    window.removeEventListener("pointerdown", clearControllerSelection);
  });
  track(
    state,
    listen<ControllerEvent>("controller-input", ({ payload }) =>
      handleControllerEvent(state, payload),
    ),
  );
}

export function armControllerBridge() {
  if (!bridge || bridge.disposed) return;
  bridge.armed = true;
  syncWatcher(bridge);
}

export function disposeControllerBridge() {
  const state = bridge;
  if (!state) return;
  state.armed = false;
  clearControllerSelection();
  emitControllerMode(false);
  void setWatcher(state, { navigation: false, counting: false }, false);
  state.disposed = true;
  state.teardown.splice(0).forEach((teardown) => teardown());
  bridge = null;
}
