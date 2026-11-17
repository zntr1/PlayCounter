import {
  useLibraryPractice,
  usePersonalLibraryState,
} from "./PersonalLibraryContext";
import clsx from "clsx";
import {
  Check,
  ChevronDown,
  EyeOff,
  FolderHeart,
  MoveRight,
  Plus,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  GAME_TIERS,
  gameStatusLabel,
  shelfHides,
  type GameStatus,
  type GameTier,
} from "../personalLibrary";
import {
  Button,
  ContextMenu,
  ContextMenuSeparator,
  useAnchoredMenu,
} from "./primitives";
import { GAME_STATUS_LIST } from "./journalStyles";
import { GameStatusIcon } from "./GameStatusIcon";
import { tierMenuLabel } from "./GameJournalActions";
import { getT } from "../i18n";

const t = getT("myGames");

const MENU_ROW =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text transition-colors hover:bg-surface-hover focus:bg-surface-hover focus:outline-none";

export function LibraryBulkActions({
  active,
  count,
  total,
  onSelectAll,
  onClear,
  onDone,
  onStatus,
  onTier,
  onShelf,
  onNewShelf,
  moveToPlayCounterCount = 0,
  onMoveToPlayCounter,
}: {
  active: boolean;
  count: number;
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
  onStatus: (status: GameStatus | null) => void;
  onTier?: (tier: GameTier | null) => void;
  onShelf?: (shelfId: string) => void;
  onNewShelf?: () => void;
  moveToPlayCounterCount?: number;
  onMoveToPlayCounter?: () => void;
}) {
  const practice = useLibraryPractice();
  const barRef = useRef<HTMLDivElement>(null);
  const shelves = usePersonalLibraryState((s) => s.personalShelves);
  const showShelves = usePersonalLibraryState(
    (s) => s.settings.libraryShowShelves !== false,
  );
  // Like the card menu's Shelves: filter shelves fill themselves.
  const handShelves = shelves.filter((shelf) => !shelf.filters);
  if (!active) return null;
  return (
    <div
      data-tour={practice ? "demo-bulk-actions" : undefined}
      ref={barRef}
      tabIndex={-1}
      aria-label={t("Bulk game actions")}
      className="sticky top-0 z-40 rounded-xl border border-accent/30 bg-surface px-3 py-2 shadow-raised focus:outline-none"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-tour={practice ? "demo-bulk-count" : undefined}
          className="min-w-24 px-1 text-sm font-semibold text-text"
          aria-live="polite"
        >
          {t("{{count}} selected", { count })}
        </span>
        <BulkMenu
          label={t("Set status")}
          menuId="library-bulk-status-menu"
          menuLabel={t("Set status for {{count}} selected games", { count })}
          variant="primary"
          disabled={!count}
          onDone={onDone}
          dataTour={practice ? "demo-bulk-set-status" : undefined}
          menuDataTour={practice ? "demo-library-menu" : undefined}
        >
          {(apply) => (
            <>
              {GAME_STATUS_LIST.map((status) => (
                <button
                  key={status}
                  data-tour={
                    practice ? `demo-bulk-status-${status}` : undefined
                  }
                  type="button"
                  role="menuitem"
                  className={MENU_ROW}
                  onClick={() => apply(() => onStatus(status))}
                >
                  <GameStatusIcon status={status} />
                  {gameStatusLabel(status)}
                </button>
              ))}
              <ContextMenuSeparator />
              <button
                type="button"
                role="menuitem"
                className={MENU_ROW}
                onClick={() => apply(() => onStatus(null))}
              >
                {t("Clear status")}
              </button>
            </>
          )}
        </BulkMenu>
        {onTier ? (
          <BulkMenu
            label={t("Set tier")}
            menuId="library-bulk-tier-menu"
            menuLabel={t("Set tier for {{count}} selected games", { count })}
            disabled={!count}
            onDone={onDone}
          >
            {(apply) => (
              <>
                {GAME_TIERS.map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    role="menuitem"
                    className={MENU_ROW}
                    onClick={() => apply(() => onTier(tier))}
                  >
                    {tierMenuLabel(tier)}
                  </button>
                ))}
                <ContextMenuSeparator />
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ROW}
                  onClick={() => apply(() => onTier(null))}
                >
                  {t("Clear tier")}
                </button>
              </>
            )}
          </BulkMenu>
        ) : null}
        {onShelf && onNewShelf && showShelves ? (
          <BulkMenu
            label={t("Add to shelf")}
            menuId="library-bulk-shelf-menu"
            menuLabel={t("Add {{count}} selected games to a shelf", { count })}
            disabled={!count}
            onDone={onDone}
          >
            {(apply) => (
              <>
                {handShelves.map((shelf) => {
                  const Icon = shelfHides(shelf) ? EyeOff : FolderHeart;
                  return (
                    <button
                      key={shelf.id}
                      type="button"
                      role="menuitem"
                      className={MENU_ROW}
                      onClick={() => apply(() => onShelf(shelf.id))}
                    >
                      <Icon size={14} className="shrink-0 text-text-muted" />
                      <span className="truncate">{shelf.name}</span>
                    </button>
                  );
                })}
                {handShelves.length ? <ContextMenuSeparator /> : null}
                <button
                  type="button"
                  role="menuitem"
                  className={MENU_ROW}
                  onClick={() => apply(onNewShelf)}
                >
                  <Plus size={14} className="shrink-0 text-text-muted" />
                  {t("New shelf")}
                </button>
              </>
            )}
          </BulkMenu>
        ) : null}
        {onMoveToPlayCounter ? (
          <div className="flex items-center gap-2">
            <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />
            <Button
              variant="secondary"
              icon={MoveRight}
              disabled={moveToPlayCounterCount === 0}
              title={
                count > 0 && moveToPlayCounterCount === 0
                  ? t("Selected games are already in PlayCounter")
                  : t("Move selected launcher games to PlayCounter")
              }
              data-controller-item="library-option"
              onClick={onMoveToPlayCounter}
            >
              {t("Move to PlayCounter")}
            </Button>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />
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
            {t("Select all {{count}} results", { count: total })}
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
              {t("Clear selection")}
            </Button>
          ) : null}
        </div>
        <Button
          variant="secondary"
          className="ml-auto"
          data-controller-item="library-option"
          onClick={onDone}
        >
          {t("Done")}
        </Button>
      </div>
    </div>
  );
}

/** A bar button with its menu: arrow keys move, Escape ends the selection,
 *  Tab leaves. `apply` closes the menu before the pick runs. */
function BulkMenu({
  label,
  menuId,
  menuLabel,
  variant = "secondary",
  disabled,
  onDone,
  dataTour,
  menuDataTour,
  children,
}: {
  label: string;
  menuId: string;
  menuLabel: string;
  variant?: "primary" | "secondary";
  disabled: boolean;
  onDone: () => void;
  dataTour?: string;
  menuDataTour?: string;
  children: (apply: (pick: () => void) => void) => ReactNode;
}) {
  const menu = useAnchoredMenu();
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => {
    menu.close();
    menu.anchorRef.current?.focus({ preventScroll: true });
  }, [menu.close]);
  useEffect(() => {
    if (disabled) menu.close();
  }, [disabled, menu.close]);
  useLayoutEffect(() => {
    if (menu.open)
      menuRef.current
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus({ preventScroll: true });
  }, [menu.open]);
  function apply(pick: () => void) {
    menu.close();
    pick();
  }
  return (
    <>
      <button
        data-tour={dataTour}
        ref={menu.anchorRef}
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-controls={menu.open ? menuId : undefined}
        data-controller-item="library-option"
        onClick={menu.toggle}
        className={clsx(
          "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50",
          variant === "primary"
            ? "bg-accent text-accent-fg hover:bg-accent-hover"
            : "border border-border bg-surface text-text hover:bg-surface-hover",
        )}
      >
        {label} <ChevronDown size={14} />
      </button>
      <ContextMenu
        dataTour={menuDataTour}
        open={menu.open && !disabled}
        position={menu.position}
        anchorRef={menu.anchorRef}
        onClose={closeMenu}
      >
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
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
          {children(apply)}
        </div>
      </ContextMenu>
    </>
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
      aria-label={t("Select {{name}}", { name })}
      data-library-selection-toggle=""
      data-controller-item="library-option"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(event.shiftKey);
      }}
      className={clsx(
        "absolute inset-0 z-[75] rounded-[inherit] border-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
        selected
          ? "cursor-inherit border-accent bg-accent/10"
          : "cursor-pointer border-transparent hover:border-accent/60",
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
