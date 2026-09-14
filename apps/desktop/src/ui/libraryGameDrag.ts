import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getGameJournal, useAppStore, type GameIdentityRef } from "../store";
import type { GameJournal, PersonalShelf } from "../personalLibrary";
import {
  positionLibraryGameHints,
  type ShelfDropHint,
} from "./LibraryGameDropHint";

const PREVIEW_WIDTH = 56;
const PREVIEW_HEIGHT = 76;
const PREVIEW_GAP = 16;
const RETURN_DURATION = 320;

export type StartLibraryGameDrag = (
  game: GameIdentityRef,
  event: ReactPointerEvent<HTMLElement>,
) => void;

function shelfDropHint(
  shelfId: string,
  shelf: PersonalShelf | undefined,
  journal: GameJournal,
): Omit<ShelfDropHint, "target"> | null {
  if (shelfId === "all")
    return { reason: "already-added", title: "Already in All games" };
  if (shelfId !== "favorites" && !shelf)
    return {
      reason: "unavailable",
      title: "This shelf is no longer available",
    };
  if (shelf?.filters)
    return {
      reason: "saved-filter",
      title: "This shelf uses filters",
      detail: "Games appear here automatically when they match.",
    };

  const favorite = shelfId === "favorites";
  const alreadyAssigned = favorite
    ? journal.favorite
    : journal.shelfIds.includes(shelfId);
  const name = favorite ? "Favorites" : shelf!.name;
  if (alreadyAssigned)
    return { reason: "already-added", title: `Already in ${name}` };
  return null;
}

function assignShelf(game: GameIdentityRef, shelfId: string) {
  const state = useAppStore.getState();
  const shelf = state.personalShelves.find((entry) => entry.id === shelfId);
  // Recheck at drop time, including changes made since the hover hints were prepared.
  const journal = getGameJournal(state, game);
  const blocked = shelfDropHint(shelfId, shelf, journal);
  if (blocked) return blocked;
  const favorite = shelfId === "favorites";
  state.updateGameJournal(
    game,
    favorite
      ? { favorite: true }
      : { shelfIds: [...journal.shelfIds, shelfId] },
  );
  state.addToast({
    tone: "success",
    title: `Added to ${favorite ? "Favorites" : shelf!.name}`,
    detail: game.gameName,
  });
  return null;
}

function prepareShelfHints(game: GameIdentityRef) {
  const state = useAppStore.getState();
  const journal = getGameJournal(state, game);
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
    const blocked = shelfDropHint(id, shelves.get(id), journal);
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
export function useLibraryGameDrag() {
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
  const activeView = useAppStore((state) => state.activeView);
  // My Games stays mounted when another app view is opened.
  useEffect(() => {
    cleanupRef.current();
    clickCleanupRef.current();
    dismissHint();
  }, [activeView, dismissHint]);
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
        event.button !== 0 ||
        event.isPrimary === false ||
        event.pointerType === "touch" ||
        (event.target instanceof Element &&
          event.target.closest(
            "button, a, input, textarea, select, [role='button'], [contenteditable='true']",
          ))
      )
        return;

      cleanupRef.current();
      clickCleanupRef.current();
      dismissHint();
      const source = event.currentTarget;
      const pointerId = event.pointerId;
      const downX = event.clientX;
      const downY = event.clientY;
      let preview: HTMLElement | null = null;
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
      let clearHoverHints = () => {};

      function stopListening() {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", release, true);
        window.removeEventListener("pointercancel", cancel, true);
        document.documentElement.removeEventListener("pointerleave", cancel);
        window.removeEventListener("keydown", keyDown, true);
        window.removeEventListener("blur", cancel);
        cancelAnimationFrame(moveFrame);
        moveFrame = 0;
        document.documentElement.classList.remove("library-game-dragging");
        clearHoverHints();
        clearHoverHints = () => {};
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
          origin = source.getBoundingClientRect();
          dragScale = Math.min(
            1,
            PREVIEW_WIDTH / origin.width,
            PREVIEW_HEIGHT / origin.height,
          );
          preview = createPreview(source, origin);
          source.setAttribute("data-library-drag-source", "true");
          document.documentElement.classList.add("library-game-dragging");
          clearHoverHints = prepareShelfHints(game);
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
        if (target?.dataset.libraryShelf && source.isConnected) {
          const blocked = assignShelf(game, target.dataset.libraryShelf);
          if (blocked) {
            hintVisibleRef.current = true;
            setHint({ ...blocked, target });
          } else if (!reducedMotion)
            target.animate?.(
              [
                { transform: "scale(1)" },
                { transform: "scale(1.08)", offset: 0.4 },
                { transform: "scale(1)" },
              ],
              { duration: 280, easing: "ease-out" },
            );
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
    },
    [dismissHint],
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
    style: { cursor: disabled ? undefined : "grab" },
    onPointerDown: disabled ? undefined : (event) => start(game, event),
    onDragStart: (event) => event.preventDefault(),
  };
}
