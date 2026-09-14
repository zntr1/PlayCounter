import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { getGameJournal, useAppStore, type GameIdentityRef } from "../store";

const DRAG_SCALE = 0.75;
const RETURN_DURATION = 320;

export type StartLibraryGameDrag = (
  game: GameIdentityRef,
  event: ReactPointerEvent<HTMLElement>,
) => void;

function assignShelf(game: GameIdentityRef, shelfId: string) {
  const state = useAppStore.getState();
  const shelf = state.personalShelves.find((entry) => entry.id === shelfId);
  if (shelfId !== "favorites" && (!shelf || shelf.filters)) return;

  // Read at drop time so an assignment never overwrites a newer membership.
  const journal = getGameJournal(state, game);
  const favorite = shelfId === "favorites";
  const alreadyAssigned = favorite
    ? journal.favorite
    : journal.shelfIds.includes(shelfId);
  if (!alreadyAssigned) {
    state.updateGameJournal(
      game,
      favorite
        ? { favorite: true }
        : { shelfIds: [...journal.shelfIds, shelfId] },
    );
  }
  const name = favorite ? "Favorites" : shelf!.name;
  state.addToast({
    tone: alreadyAssigned ? "info" : "success",
    title: `${alreadyAssigned ? "Already in" : "Added to"} ${name}`,
    detail: game.gameName,
  });
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
  const [game, setGame] = useState<GameIdentityRef | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const cleanupRef = useRef<() => void>(() => {});
  const clickCleanupRef = useRef<() => void>(() => {});
  const activeView = useAppStore((state) => state.activeView);
  // My Games stays mounted when another app view is opened.
  useEffect(() => {
    cleanupRef.current();
    clickCleanupRef.current();
    setGame(null);
    setDropTarget(null);
  }, [activeView]);
  useEffect(
    () => () => {
      cleanupRef.current();
      clickCleanupRef.current();
    },
    [],
  );

  const start = useCallback<StartLibraryGameDrag>((game, event) => {
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
    const source = event.currentTarget;
    const pointerId = event.pointerId;
    const downX = event.clientX;
    const downY = event.clientY;
    let preview: HTMLElement | null = null;
    let origin: DOMRect;
    let x = 0;
    let y = 0;
    let frame = 0;
    let animation: Animation | undefined;
    let returning = false;

    function stopListening() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("blur", cancel);
      if (source.hasPointerCapture?.(pointerId))
        source.releasePointerCapture(pointerId);
      document.documentElement.classList.remove("library-game-dragging");
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

    function reset() {
      cleanup();
      setGame(null);
      setDropTarget(null);
    }
    function targetAt(clientX: number, clientY: number) {
      return (
        document
          .elementFromPoint(clientX, clientY)
          ?.closest<HTMLElement>("[data-library-drop-shelf]") ?? null
      );
    }
    function move(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      if (!(event.buttons & 1) || !source.isConnected) {
        cancel();
        return;
      }
      if (!preview) {
        if (Math.hypot(event.clientX - downX, event.clientY - downY) < 8)
          return;
        origin = source.getBoundingClientRect();
        preview = createPreview(source, origin);
        source.setAttribute("data-library-drag-source", "true");
        document.documentElement.classList.add("library-game-dragging");
        window.getSelection()?.removeAllRanges();
        source.setPointerCapture?.(pointerId);
        setGame(game);
      }
      event.preventDefault();
      // Keep the grabbed point under the pointer as the card shrinks.
      x = event.clientX - (downX - origin.left) * DRAG_SCALE;
      y = event.clientY - (downY - origin.top) * DRAG_SCALE;
      preview.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${DRAG_SCALE})`;
      setDropTarget(
        targetAt(event.clientX, event.clientY)?.dataset.libraryDropShelf ??
          null,
      );
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
      setGame(null);
      setDropTarget(null);
      if (!preview) {
        reset();
        return;
      }
      suppressReleaseClick();
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (target?.dataset.libraryDropShelf && source.isConnected) {
        assignShelf(game, target.dataset.libraryDropShelf);
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
      if (reducedMotion || !preview.animate) {
        reset();
        return;
      }
      // Let the toolbar leave its sticky position before measuring the card's current slot.
      frame = requestAnimationFrame(() => {
        const destination = source.getBoundingClientRect();
        if (!source.isConnected || !destination.width || !destination.height) {
          reset();
          return;
        }
        const scaleX = destination.width / origin.width;
        const scaleY = destination.height / origin.height;
        const translate = `translate3d(${destination.left}px, ${destination.top}px, 0)`;
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
              transform: `translate3d(${x}px, ${y}px, 0) scale(${DRAG_SCALE})`,
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
        animation.onfinish = reset;
      });
    }
    function release(event: PointerEvent) {
      if (event.pointerId === pointerId)
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
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("blur", cancel);
  }, []);

  return { game, dropTarget, start };
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
