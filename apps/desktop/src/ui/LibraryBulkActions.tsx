import { useLibraryPractice } from "./PersonalLibraryContext";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
} from "react";
import { GAME_STATUSES, type GameStatus } from "../personalLibrary";
import {
  Button,
  ContextMenu,
  ContextMenuSeparator,
  useAnchoredMenu,
} from "./primitives";
import { GAME_STATUS_LIST, STATUS_TONES } from "./journalStyles";

export function LibraryBulkActions({
  active,
  count,
  total,
  onSelectAll,
  onClear,
  onDone,
  onStatus,
}: {
  active: boolean;
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
  onStatus: (status: GameStatus | null) => void;
}) {
  const practice = useLibraryPractice();
  const menu = useAnchoredMenu();
  const menuRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => {
    menu.close();
    menu.anchorRef.current?.focus({ preventScroll: true });
  }, [menu.close]);
  useEffect(() => {
    if (!active || !count) menu.close();
  }, [active, count, menu.close]);
  useLayoutEffect(() => {
    if (menu.open)
      menuRef.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
  }, [menu.open]);
  function apply(status: GameStatus | null) {
    menu.close();
    onStatus(status);
  }
  if (!active) return null;
  return (
    <div
      data-tour={practice ? "demo-bulk-actions" : undefined}
      ref={barRef}
      tabIndex={-1}
      aria-label="Bulk status actions"
      className="sticky top-0 z-40 rounded-xl border border-accent/30 bg-surface px-3 py-2 shadow-raised focus:outline-none"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-tour={practice ? "demo-bulk-count" : undefined}
          className="min-w-24 px-1 text-sm font-semibold text-text"
          aria-live="polite"
        >
          {count} selected
        </span>
        <button
          data-tour={practice ? "demo-bulk-set-status" : undefined}
          ref={menu.anchorRef}
          type="button"
          disabled={!count}
          aria-haspopup="menu"
          aria-expanded={menu.open}
          aria-controls={menu.open ? "library-bulk-status-menu" : undefined}
          data-controller-item="library-option"
          onClick={menu.toggle}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Set status <ChevronDown size={14} />
        </button>
        <Button
          data-tour={practice ? "demo-bulk-select-all" : undefined}
          variant="ghost"
          disabled={!total || count === total}
          data-controller-item="library-option"
          onClick={() => {
            onSelectAll();
            barRef.current?.focus({ preventScroll: true });
          }}
        >
          Select all {total} {total === 1 ? "result" : "results"}
        </Button>
        {count ? (
          <Button
            variant="ghost"
            data-controller-item="library-option"
            onClick={() => {
              onClear();
              barRef.current?.focus({ preventScroll: true });
            }}
          >
            Clear selection
          </Button>
        ) : null}
        <Button
          variant="secondary"
          className="ml-auto"
          data-controller-item="library-option"
          onClick={onDone}
        >
          Done
        </Button>
      </div>
      {!count ? (
        <p className="px-1 pt-1 text-xs text-text-faint">
          Click games to select them. Shift-click selects a range. Press Esc to
          exit.
        </p>
      ) : null}
      <ContextMenu
        dataTour={practice ? "demo-library-menu" : undefined}
        open={menu.open && active && count > 0}
        position={menu.position}
        anchorRef={menu.anchorRef}
        onClose={closeMenu}
      >
        <div
          ref={menuRef}
          id="library-bulk-status-menu"
          role="menu"
          aria-label={`Set status for ${count} selected games`}
          onKeyDown={(event) => {
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button",
              ),
            ];
            const current = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const next =
              event.key === "ArrowDown"
                ? (current + 1) % buttons.length
                : event.key === "ArrowUp"
                  ? (current - 1 + buttons.length) % buttons.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? buttons.length - 1
                      : -1;
            if (next >= 0) {
              event.preventDefault();
              buttons[next]?.focus();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              menu.close();
              onDone();
            } else if (event.key === "Tab") {
              event.stopPropagation();
              closeMenu();
            }
          }}
        >
          {GAME_STATUS_LIST.map((status) => (
            <button
              key={status}
              data-tour={practice ? `demo-bulk-status-${status}` : undefined}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text transition-colors hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
              onClick={() => apply(status)}
            >
              <span
                className={`h-2 w-2 rounded-full ${STATUS_TONES[status].dot}`}
              />
              {GAME_STATUSES[status]}
            </button>
          ))}
          <ContextMenuSeparator />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text transition-colors hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
            onClick={() => apply(null)}
          >
            Clear status
          </button>
        </div>
      </ContextMenu>
    </div>
  );
}

function LibrarySelectionOverlay({
  name,
  selected,
  onToggle,
}: {
  name: string;
  selected: boolean;
  onToggle: (range: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`Select ${name}`}
      data-controller-item="library-option"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(event.shiftKey);
      }}
      className={clsx(
        "absolute inset-0 z-[75] cursor-pointer rounded-[inherit] border-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
        selected
          ? "border-accent bg-accent/10"
          : "border-transparent hover:border-accent/60",
      )}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-md border shadow-md",
          selected
            ? "border-accent bg-accent text-accent-fg"
            : "border-white/60 bg-bg text-text",
        )}
      >
        {selected ? <Check size={16} strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

export function SelectableLibraryCard({
  selectionMode,
  selected,
  gameName,
  onToggleSelection,
  children,
  ...props
}: ComponentProps<"article"> & {
  selectionMode: boolean;
  selected: boolean;
  gameName: string;
  onToggleSelection: (range: boolean) => void;
}) {
  return (
    <article {...props} data-library-selecting={selectionMode || undefined}>
      {selectionMode ? (
        <LibrarySelectionOverlay
          name={gameName}
          selected={selected}
          onToggle={onToggleSelection}
        />
      ) : null}
      <div
        className="contents"
        inert={selectionMode}
        data-controller-ignore={selectionMode ? "" : undefined}
      >
        {children}
      </div>
    </article>
  );
}
