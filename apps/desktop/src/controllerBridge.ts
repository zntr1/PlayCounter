import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { currentPlatform } from "./platform";
import { useAppStore } from "./store";
import {
  isLeftmostVisualItem,
  isTopmostVisualItem,
  nextControllerIndex,
  type ControllerAction,
  type ControllerItemRect,
} from "./controllerInput";

type ControllerEvent = { action: ControllerAction; at: number };

export const CONTROLLER_MODE_EVENT = "playcounter:controller-mode";
export const CONTROLLER_LIBRARY_VIEW_EVENT =
  "playcounter:controller-library-view";

type ControllerBridgeState = {
  armed: boolean;
  disposed: boolean;
  watching: boolean;
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

async function setWatcher(state: ControllerBridgeState, enabled: boolean) {
  if (state.disposed || bridge !== state || state.watching === enabled) return;
  state.watching = enabled;
  try {
    await invoke(enabled ? "controller_watch_start" : "controller_watch_stop");
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

function syncWatcher(state: ControllerBridgeState) {
  const enabled = shouldWatch(state);
  if (!enabled) {
    clearControllerSelection();
    emitControllerMode(false);
  }
  void setWatcher(state, enabled);
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

// The keyboard walks only the cards and the sidebar. The controls above the
// cards keep their own keyboard behavior.
const KEYBOARD_ROLES = new Set(["game-card", "navigation"]);

function isKeyboardItem(item: Element) {
  return KEYBOARD_ROLES.has(item.getAttribute("data-controller-item") ?? "");
}

function controllerItems(keyboard = false) {
  if (typeof document === "undefined") return [];
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    ),
  ];
  const root: Document | HTMLElement = dialogs.at(-1) ?? document;
  const selector = "[data-controller-item]";
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (item, index, items) => {
      if (items.indexOf(item) !== index || item.offsetParent === null)
        return false;
      if (keyboard && !isKeyboardItem(item)) return false;
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
    clearControllerSelection();
    content.focus({ preventScroll: true });
  });
}

function preferredControllerItem(items: HTMLElement[]) {
  return (
    items.find(
      (item) => item.getAttribute("data-controller-item") === "game-card",
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
) {
  const current = items.indexOf(selected);
  if (current < 0) return;
  const rects: ControllerItemRect[] = items.map((item) =>
    item.getBoundingClientRect(),
  );
  focusItem(items[nextControllerIndex(rects, current, action)]);
}

function activateItem(item: HTMLElement | undefined, keyboard: boolean) {
  if (!item) return;
  const role = item.getAttribute("data-controller-item");
  if (role === "navigation" || role === "view-link") {
    item.click();
    focusViewContentWhenReady(keyboard);
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
  item.click();
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
  emitControllerMode(true);
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
    const navigationItems = items.filter(
      (item) => item.getAttribute("data-controller-item") === "navigation",
    );
    const contentItems = contentRoot
      ? items.filter((item) => contentRoot.contains(item))
      : [];

    if (navigationItems.includes(selected)) {
      if (action === "right") {
        const preferred = preferredControllerItem(contentItems);
        if (preferred) focusItem(preferred);
        else if (contentRoot) {
          clearControllerSelection();
          contentRoot.focus({ preventScroll: true });
        }
      } else if (action === "up" || action === "down") {
        moveWithinItems(navigationItems, selected, action);
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
        if (action === "up" && isTopmostVisualItem(cardRects, cardIndex)) {
          const controlsAbove = contentItems.filter(
            (item) =>
              !gameCards.includes(item) &&
              item.getBoundingClientRect().top <
                selected.getBoundingClientRect().top,
          );
          const preferredControl =
            controlsAbove.find(
              (item) => item.getAttribute("aria-selected") === "true",
            ) ?? controlsAbove.at(-1);
          if (preferredControl) {
            focusItem(preferredControl);
            return;
          }
        }
        moveWithinItems(gameCards, selected, action);
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
  const onItem = focused instanceof HTMLElement && isKeyboardItem(focused);
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
  state.teardown.push(
    useAppStore.subscribe((current, previous) => {
      if (
        current.settings.gameLaunchingEnabled !==
          previous.settings.gameLaunchingEnabled ||
        current.settings.controllerNavigationEnabled !==
          previous.settings.controllerNavigationEnabled
      ) {
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
  void setWatcher(state, false);
  state.disposed = true;
  state.teardown.splice(0).forEach((teardown) => teardown());
  bridge = null;
}
