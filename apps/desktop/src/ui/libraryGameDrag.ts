import {
  usePersonalLibraryApi,
  usePersonalLibraryState,
} from "./PersonalLibraryContext";
import type { PersonalLibraryState } from "../personalLibraryStore";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { personalGameIdentity, type GameIdentityRef } from "../store";
import type { PersonalShelf } from "../personalLibrary";
import {
  positionLibraryGameHints,
  type ShelfDropHint,
} from "./LibraryGameDropHint";

const PREVIEW_WIDTH = 84;
const PREVIEW_HEIGHT = 114;
const PREVIEW_GAP = 16;
const RETURN_DURATION = 320;
const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"]';

export type StartLibraryGameDrag = (
  game: GameIdentityRef,
  event: ReactPointerEvent<HTMLElement>,
) => void;

function shelfDropHint(
  shelfId: string,
  shelf: PersonalShelf | undefined,
  assignedShelves: ReadonlySet<string>,
  count: number,
): Omit<ShelfDropHint, "target"> | null {
  const alreadyAdded = (name: string): Omit<ShelfDropHint, "target"> => ({
    reason: "already-added",
    title:
      count > 1
        ? `All selected games are already in ${name}`
        : `Already in ${name}`,
  });
  if (shelfId === "all") return alreadyAdded("All games");
  if (shelfId !== "favorites" && !shelf)
    return {
      reason: "unavailable",
      title: "This shelf is no longer available",
    };
  if (shelf?.filters)
    return {
      reason: "saved-filter",
      title: "This shelf fills itself from filters",
      detail:
        "Games are added automatically when they match. Right-click the shelf to edit its filters.",
    };

  const favorite = shelfId === "favorites";
  const name = favorite ? "Favorites" : shelf!.name;
  if (assignedShelves.has(shelfId)) return alreadyAdded(name);
  return null;
}

/** A shelf is blocked only if every dragged game already belongs to it. */
function commonShelfMemberships(
  games: readonly GameIdentityRef[],
  state: PersonalLibraryState,
) {
  const identity = personalGameIdentity(state);
  const memberships = new Map(
    games.map((game) => [identity(game), new Set<string>()]),
  );
  // Union linked journals once, without scanning the library for every game.
  for (const journal of Object.values(state.gameJournals)) {
    const assigned = memberships.get(identity(journal.game));
    if (!assigned) continue;
    if (journal.favorite) assigned.add("favorites");
    for (const shelfId of journal.shelfIds) assigned.add(shelfId);
  }
  const [first, ...others] = memberships.values();
  return new Set(
    [...(first ?? [])].filter((id) =>
      others.every((assigned) => assigned.has(id)),
    ),
  );
}

function assignShelf(
  games: readonly GameIdentityRef[],
  shelfId: string,
  state: PersonalLibraryState,
) {
  const shelf = state.personalShelves.find((entry) => entry.id === shelfId);
  // Recheck at drop time, including changes made since the hover hints were prepared.
  const blocked = shelfDropHint(
    shelfId,
    shelf,
    commonShelfMemberships(games, state),
    games.length,
  );
  if (blocked) return blocked;
  const favorite = shelfId === "favorites";
  const added = state.addGamesToShelf(games, shelfId);
  const name = favorite ? "Favorites" : shelf!.name;
  state.addToast({
    tone: "success",
    title:
      games.length > 1
        ? `Added ${added} ${added === 1 ? "game" : "games"} to ${name}`
        : `Added to ${name}`,
    detail:
      games.length === 1
        ? games[0].gameName
        : added < games.length
          ? `${games.length - added} already in ${name}`
          : undefined,
  });
  return null;
}

function prepareShelfHints(
  games: readonly GameIdentityRef[],
  state: PersonalLibraryState,
) {
  const assignedShelves = commonShelfMemberships(games, state);
  const shelves = new Map(
    state.personalShelves.map((shelf) => [shelf.id, shelf]),
  );
  const targets = [
    ...document.querySelectorAll<HTMLElement>("[data-library-shelf]"),
  ];
  const hints: { target: HTMLElement; element: HTMLElement }[] = [];
  const restore: (() => void)[] = [];
  for (const target of targets) {
    const title = target.getAttribute("title");
    target.removeAttribute("title");
    restore.push(() => {
      if (title !== null) target.setAttribute("title", title);
      target.removeAttribute("data-library-drag-blocked");
    });
    const id = target.dataset.libraryShelf!;
    const blocked = shelfDropHint(
      id,
      shelves.get(id),
      assignedShelves,
      games.length,
    );
    const element = target.querySelector<HTMLElement>(
      ".library-game-hover-hint",
    );
    if (!blocked || !element) continue;
    target.dataset.libraryDragBlocked = blocked.reason;
    element.querySelector<HTMLElement>("[data-hint-title]")!.textContent =
      blocked.title;
    element.querySelector<HTMLElement>("[data-hint-detail]")!.textContent =
      blocked.detail ?? "";
    const describedBy = target.getAttribute("aria-describedby");
    target.setAttribute(
      "aria-describedby",
      [describedBy, element.id].filter(Boolean).join(" "),
    );
    hints.push({ target, element });
    restore.push(() => {
      if (describedBy === null) target.removeAttribute("aria-describedby");
      else target.setAttribute("aria-describedby", describedBy);
      element.querySelector<HTMLElement>("[data-hint-title]")!.textContent = "";
      element.querySelector<HTMLElement>("[data-hint-detail]")!.textContent =
        "";
    });
  }
  positionLibraryGameHints(hints);
  let frame = 0;
  const reposition = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      positionLibraryGameHints(hints);
    });
  };
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
    for (const reset of restore) reset();
  };
}

function createPreview(source: HTMLElement, rect: DOMRect) {
  const preview = source.cloneNode(true) as HTMLElement;
  preview.querySelector("[data-library-selection-toggle]")?.remove();
  // Keep the card's appearance without duplicating controller targets or IDs.
  for (const element of [preview, ...preview.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name === "id" || attribute.name.startsWith("data-"))
        element.removeAttribute(attribute.name);
    }
  }
  preview.classList.remove("game-library-card");
  preview.classList.add("library-game-drag-preview");
  preview.setAttribute("aria-hidden", "true");
  preview.inert = true;
  Object.assign(preview.style, {
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  const cover = source.querySelector<HTMLElement>(".game-card-cover-image");
  const previewCover = preview.querySelector<HTMLElement>(
    ".game-card-cover-image",
  );
  if (cover && previewCover) {
    previewCover.style.transform = getComputedStyle(cover).transform;
    previewCover.style.transition = "none";
  }
  document.body.append(preview);
  return preview;
}

/** Pointer dragging gives us an opaque card and a return animation, including in WebView2. */
export function useLibraryGameDrag(
  selectedGames: readonly GameIdentityRef[],
  /** Called once a dragged selection lands on a shelf, so Select can close
   *  itself the way applying a status does. */
  onSelectionAssigned?: () => void,
) {
  const libraryApi = usePersonalLibraryApi();
  const selectedGamesRef = useRef(selectedGames);
  const onSelectionAssignedRef = useRef(onSelectionAssigned);
  useLayoutEffect(() => {
    selectedGamesRef.current = selectedGames;
    onSelectionAssignedRef.current = onSelectionAssigned;
  }, [selectedGames, onSelectionAssigned]);
  const cleanupRef = useRef<() => void>(() => {});
  const clickCleanupRef = useRef<() => void>(() => {});
  const [hint, setHint] = useState<ShelfDropHint | null>(null);
  const hintVisibleRef = useRef(false);
  const dismissHint = useCallback(() => {
    // Even a redundant state update can schedule a library render at pickup.
    if (!hintVisibleRef.current) return;
    hintVisibleRef.current = false;
    setHint(null);
  }, []);
  const activeView = usePersonalLibraryState((state) => state.activeView);
  const showShelves = usePersonalLibraryState(
    (state) => state.settings.libraryShowShelves !== false,
  );
  // My Games stays mounted when another app view is opened.
  useEffect(() => {
    cleanupRef.current();
    clickCleanupRef.current();
    dismissHint();
  }, [activeView, showShelves, dismissHint]);
  useEffect(
    () => () => {
      cleanupRef.current();
      clickCleanupRef.current();
    },
    [],
  );

  const start = useCallback<StartLibraryGameDrag>(
    (game, event) => {
      if (
        libraryApi.getState().settings.libraryShowShelves === false ||
        event.button !== 0 ||
        event.isPrimary === false ||
        event.pointerType === "touch" ||
        // Portals bubble through the React card even though their DOM is outside it.
        !(event.target instanceof Node) ||
        !event.currentTarget.contains(event.target) ||
        document.querySelector(MODAL_SELECTOR) ||
        (event.target instanceof Element &&
          event.target.closest(
            "button, a, input, textarea, select, [role='button'], [contenteditable='true']",
          ) &&
          !event.target.closest(
            "[data-library-selection-toggle][aria-checked='true']",
          ))
      )
        return;

      cleanupRef.current();
      clickCleanupRef.current();
      dismissHint();
      const source = event.currentTarget;
      const restingCursor = source.style.cursor;
      source.style.cursor = "grabbing";
      const pointerId = event.pointerId;
      const selection = selectedGamesRef.current;
      let games: readonly GameIdentityRef[] = [game];
      const downX = event.clientX;
      const downY = event.clientY;
      let preview: HTMLElement | null = null;
      let countBadge: HTMLElement | null = null;
      let origin: DOMRect;
      let x = 0;
      let y = 0;
      let pointerX = downX;
      let pointerY = downY;
      let moveFrame = 0;
      let dragScale = 1;
      let frame = 0;
      let animation: Animation | undefined;
      let returning = false;
      let draggingSelection = false;
      let clearHoverHints = () => {};

      function stopListening() {
        source.style.cursor = restingCursor;
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", release, true);
        window.removeEventListener("pointercancel", cancel, true);
        document.documentElement.removeEventListener("pointerleave", cancel);
        window.removeEventListener("keydown", keyDown, true);
        window.removeEventListener("blur", cancel);
        window.removeEventListener("focusin", modalFocused, true);
        cancelAnimationFrame(moveFrame);
        moveFrame = 0;
        document.documentElement.classList.remove("library-game-dragging");
        clearHoverHints();
        clearHoverHints = () => {};
        countBadge?.remove();
      }
      function cleanup() {
        stopListening();
        cancelAnimationFrame(frame);
        if (animation) {
          animation.onfinish = null;
          animation.cancel();
        }
        source.removeAttribute("data-library-drag-source");
        preview?.remove();
      }
      cleanupRef.current = cleanup;

      function targetAt(clientX: number, clientY: number) {
        return (
          document
            .elementFromPoint(clientX, clientY)
            ?.closest<HTMLElement>("[data-library-shelf]") ?? null
        );
      }
      function scheduleMove() {
        if (preview && !moveFrame)
          moveFrame = requestAnimationFrame(updatePreview);
      }
      function move(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        if (!(event.buttons & 1) || !source.isConnected) {
          cancel();
          return;
        }
        pointerX = event.clientX;
        pointerY = event.clientY;
        if (!preview) {
          if (Math.hypot(event.clientX - downX, event.clientY - downY) < 8)
            return;
          const identity = personalGameIdentity(libraryApi.getState());
          const sourceKey = identity(game);
          if (selection.some((selected) => identity(selected) === sourceKey)) {
            draggingSelection = true;
            games = [
              ...new Map(
                [game, ...selection].map((entry) => [identity(entry), entry]),
              ).values(),
            ];
          }
          origin = source.getBoundingClientRect();
          dragScale = Math.min(
            1,
            PREVIEW_WIDTH / origin.width,
            PREVIEW_HEIGHT / origin.height,
          );
          preview = createPreview(source, origin);
          if (games.length > 1) {
            countBadge = document.createElement("span");
            countBadge.className = "library-game-drag-count";
            countBadge.textContent = `+${games.length - 1}`;
            countBadge.setAttribute("aria-hidden", "true");
            document.body.append(countBadge);
          }
          source.setAttribute("data-library-drag-source", "true");
          document.documentElement.classList.add("library-game-dragging");
          clearHoverHints = prepareShelfHints(games, libraryApi.getState());
          window.getSelection()?.removeAllRanges();
          // Position the initial copy immediately; subsequent input is coalesced per frame.
          updatePreview();
        } else {
          scheduleMove();
        }
        event.preventDefault();
      }
      function updatePreview() {
        moveFrame = 0;
        if (!preview || returning) return;
        if (!source.isConnected) {
          cancel();
          return;
        }
        // Movement only translates the preview. CSS reveals the prepared shelf hints.
        x = pointerX + PREVIEW_GAP;
        y = pointerY + PREVIEW_GAP;
        preview.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${dragScale})`;
        if (countBadge)
          countBadge.style.transform = `translate3d(${x + origin.width * dragScale - 10}px, ${y - 10}px, 0)`;
      }
      function suppressReleaseClick() {
        // A drag must not turn into a click on a shelf or a card action on release.
        const clear = () => {
          window.removeEventListener("click", block, true);
          window.removeEventListener("pointerdown", clear, true);
          clearTimeout(timeout);
        };
        const block = (event: MouseEvent) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          clear();
        };
        const timeout = window.setTimeout(clear, 1000);
        window.addEventListener("click", block, true);
        window.addEventListener("pointerdown", clear, true);
        clickCleanupRef.current = clear;
      }
      function finish(target: HTMLElement | null) {
        if (returning) return;
        if (document.querySelector(MODAL_SELECTOR)) {
          cancelForModal();
          return;
        }
        returning = true;
        stopListening();
        if (!preview) {
          cleanup();
          return;
        }
        suppressReleaseClick();
        const reducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        if (
          target?.dataset.libraryShelf &&
          source.isConnected &&
          libraryApi.getState().settings.libraryShowShelves !== false
        ) {
          const blocked = assignShelf(
            games,
            target.dataset.libraryShelf,
            libraryApi.getState(),
          );
          if (blocked) {
            hintVisibleRef.current = true;
            setHint({ ...blocked, target });
          } else {
            if (draggingSelection) onSelectionAssignedRef.current?.();
            if (!reducedMotion)
              target.animate?.(
                [
                  { transform: "scale(1)" },
                  { transform: "scale(1.08)", offset: 0.4 },
                  { transform: "scale(1)" },
                ],
                { duration: 280, easing: "ease-out" },
              );
          }
        }
        if (reducedMotion || !preview.animate) {
          cleanup();
          return;
        }
        // Let updated shelf counts render before measuring the card's current slot.
        frame = requestAnimationFrame(() => {
          const destination = source.getBoundingClientRect();
          if (
            !source.isConnected ||
            !destination.width ||
            !destination.height
          ) {
            cleanup();
            return;
          }
          const scaleX = destination.width / origin.width;
          const scaleY = destination.height / origin.height;
          let destinationX = destination.left;
          let destinationY = destination.top;
          const scrollContainer = source.closest<HTMLElement>(
            "[data-controller-content]",
          );
          if (scrollContainer) {
            // Return in the library's content coordinates so native scrolling
            // moves the copy and its destination together throughout the bounce.
            const bounds = scrollContainer.getBoundingClientRect();
            const offsetX =
              bounds.left +
              scrollContainer.clientLeft -
              scrollContainer.scrollLeft;
            const offsetY =
              bounds.top +
              scrollContainer.clientTop -
              scrollContainer.scrollTop;
            x -= offsetX;
            y -= offsetY;
            destinationX -= offsetX;
            destinationY -= offsetY;
            preview!.style.position = "absolute";
            preview!.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${dragScale})`;
            scrollContainer.append(preview!);
          }
          const translate = `translate3d(${destinationX}px, ${destinationY}px, 0)`;
          const sourceShadow = getComputedStyle(source).boxShadow;
          const cover = source.querySelector<HTMLElement>(
            ".game-card-cover-image",
          );
          const previewCover = preview!.querySelector<HTMLElement>(
            ".game-card-cover-image",
          );
          if (cover && previewCover) {
            // Settle the frozen hover zoom before handing back to the real card.
            previewCover.style.transition = `transform ${RETURN_DURATION}ms ease-out`;
            previewCover.style.transform = getComputedStyle(cover).transform;
          }
          animation = preview!.animate(
            [
              {
                transform: `translate3d(${x}px, ${y}px, 0) scale(${dragScale})`,
                boxShadow: getComputedStyle(preview!).boxShadow,
                easing: "cubic-bezier(.22,.8,.28,1)",
              },
              {
                transform: `${translate} scale(${scaleX * 1.015}, ${scaleY * 1.015})`,
                boxShadow: sourceShadow,
                offset: 0.8,
                easing: "ease-in-out",
              },
              {
                transform: `${translate} scale(${scaleX}, ${scaleY})`,
                boxShadow: sourceShadow,
              },
            ],
            { duration: RETURN_DURATION, fill: "forwards" },
          );
          animation.onfinish = cleanup;
        });
      }
      function release(event: PointerEvent) {
        if (event.pointerId !== pointerId) return;
        if (preview) {
          // A fast release can arrive before the scheduled frame: use the actual release point.
          cancelAnimationFrame(moveFrame);
          pointerX = event.clientX;
          pointerY = event.clientY;
          updatePreview();
        }
        finish(preview ? targetAt(event.clientX, event.clientY) : null);
      }
      function cancel() {
        finish(null);
      }
      function cancelForModal() {
        if (preview) suppressReleaseClick();
        cleanup();
      }
      function modalFocused(event: FocusEvent) {
        if (
          event.target instanceof Element &&
          event.target.closest(MODAL_SELECTOR)
        ) {
          // Dialog focus cancels pending and active drags without a return animation
          // or repeatedly inspecting the DOM during pointer movement.
          cancelForModal();
        }
      }
      function keyDown(event: KeyboardEvent) {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
      // Window capture listeners keep receiving events over child controls without
      // capturing the pointer to the card, so shelves can use ordinary CSS :hover.
      window.addEventListener("pointermove", move, {
        passive: false,
        capture: true,
      });
      window.addEventListener("pointerup", release, true);
      window.addEventListener("pointercancel", cancel, true);
      document.documentElement.addEventListener("pointerleave", cancel);
      window.addEventListener("keydown", keyDown, true);
      window.addEventListener("blur", cancel);
      window.addEventListener("focusin", modalFocused, true);
    },
    [dismissHint, libraryApi],
  );

  return { start, hint, dismissHint };
}

export function libraryGameDragSourceProps(
  game: GameIdentityRef,
  start: StartLibraryGameDrag,
  disabled: boolean,
): HTMLAttributes<HTMLElement> {
  return {
    draggable: false,
    style: { cursor: disabled ? undefined : "default" },
    onPointerDown: disabled ? undefined : (event) => start(game, event),
    onDragStart: (event) => event.preventDefault(),
  };
}
