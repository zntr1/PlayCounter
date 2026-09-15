import {
  usePersonalLibraryState,
  useLibraryPractice,
} from "./PersonalLibraryContext";
import {
  FolderHeart,
  Pencil,
  Plus,
  Save,
  SlidersHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GAME_STATUSES,
  NAME_LIMIT,
  matchesLibraryFilters,
  normalizeLibraryFilters,
  readJournal,
  type FilterableLibraryGame,
  type GameJournal,
  type GameStatus,
  type LibraryFilters,
  type PersonalShelf,
} from "../personalLibrary";
import { personalGameIdentity, type GameIdentityRef } from "../store";
import {
  Button,
  ContextMenu,
  ContextMenuHeading,
  ContextMenuItem,
  Input,
  Modal,
  Pill,
  useContextMenu,
} from "./primitives";
import { GAME_STATUS_LIST, STATUS_TONES } from "./journalStyles";
import type { LibraryTabId } from "./libraryTabs";
import { LibraryGameHoverHint } from "./LibraryGameDropHint";
import { emitTourEvent } from "./tour/TourUI";

export type OrganizedGame = FilterableLibraryGame & GameIdentityRef;

export function useLibraryJournalLookup() {
  const gameJournals = usePersonalLibraryState((s) => s.gameJournals);
  const gameMetadata = usePersonalLibraryState((s) => s.gameMetadata);
  const exeCache = usePersonalLibraryState((s) => s.exeCache);
  const libraryImports = usePersonalLibraryState((s) => s.libraryImports);
  return useMemo(() => {
    const identity = personalGameIdentity({
      gameMetadata,
      exeCache,
      libraryImports,
    });
    const cache = new Map<string, GameJournal>();
    return (game: GameIdentityRef) => {
      const key = identity(game);
      let journal = cache.get(key);
      if (!journal) {
        journal = readJournal(gameJournals, game, identity);
        cache.set(key, journal);
      }
      return journal;
    };
  }, [gameJournals, gameMetadata, exeCache, libraryImports]);
}

export function matchesShelf(
  game: OrganizedGame,
  journal: GameJournal,
  id: string,
  shelves: readonly PersonalShelf[],
) {
  if (id === "all") return true;
  if (id === "favorites") return journal.favorite;
  const shelf = shelves.find((s) => s.id === id);
  return !shelf
    ? true
    : shelf.filters
      ? matchesLibraryFilters(game, journal, shelf.filters)
      : journal.shelfIds.includes(shelf.id);
}

/* The shelf rail ─────────────────────────────────────────────────────────────
   Shelves were hidden behind a dropdown, so nobody could see what they had
   made. They are chips now: one row, one click, each carrying its own count.
   Everything that narrows the library further — progress, playtime, emulator —
   lives in the filter drawer, stated as pills rather than a wall of selects. */

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[104px_minmax(0,1fr)] sm:items-baseline">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-faint">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function LibraryOrganizationToolbar({
  showShelves,
  selection,
  onSelect,
  filters,
  onFiltersChange,
  expanded,
  onExpandedChange,
  onClearFilters,
  source,
  query,
  counts,
  selectionAction,
}: {
  showShelves: boolean;
  selection: string;
  onSelect: (id: string) => void;
  filters: LibraryFilters;
  onFiltersChange: (filters: LibraryFilters) => void;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
  onClearFilters: () => void;
  source: LibraryTabId;
  query: string;
  /** Games per shelf id, counted across every import source. */
  counts: Record<string, number>;
  selectionAction?: React.ReactNode;
}) {
  const practice = useLibraryPractice();
  const shelves = usePersonalLibraryState((s) => s.personalShelves);
  const save = usePersonalLibraryState((s) => s.savePersonalShelf);
  const remove = usePersonalLibraryState((s) => s.deletePersonalShelf);
  const addToast = usePersonalLibraryState((s) => s.addToast);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<PersonalShelf | "new" | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<PersonalShelf | null>(null);
  const [menuShelfId, setMenuShelfId] = useState<string | null>(null);
  const shelfMenu = useContextMenu();
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const closeShelfMenu = useCallback(() => {
    shelfMenu.close();
    menuTriggerRef.current?.focus();
  }, [shelfMenu.close]);
  const menuShelf = shelves.find((s) => s.id === menuShelfId);
  const selected = showShelves
    ? shelves.find((s) => s.id === selection)
    : undefined;
  const draftFilters = normalizeLibraryFilters({
    ...filters,
    source,
    search: query,
  });
  const activeCount = Object.keys(draftFilters).length;
  const filtersChanged =
    selected &&
    JSON.stringify(draftFilters) !==
      JSON.stringify(normalizeLibraryFilters(selected.filters ?? {}));
  useEffect(() => {
    if (
      selection !== "all" &&
      (!showShelves ||
        (selection !== "favorites" && !shelves.some((s) => s.id === selection)))
    )
      onSelect("all");
  }, [showShelves, selection, shelves, onSelect]);
  function edit(value: typeof editor) {
    setEditor(value);
    setName(typeof value === "object" && value ? value.name : "");
  }
  function setFilter(key: keyof LibraryFilters, value: unknown) {
    const next = { ...filters, [key]: value };
    if (value === undefined) delete next[key];
    onFiltersChange(next);
  }
  function closeFilters() {
    onExpandedChange(false);
    focusFiltersButton();
  }
  function focusFiltersButton() {
    toolbarRef.current
      ?.querySelector<HTMLButtonElement>('[aria-controls="library-filters"]')
      ?.focus({ preventScroll: true });
  }

  function dropProps(id: string, allowed = true) {
    return {
      "data-library-shelf": showShelves ? id : undefined,
      "data-library-drop-shelf": showShelves && allowed ? id : undefined,
    };
  }

  return (
    <div
      data-tour={practice ? "demo-organization" : undefined}
      ref={toolbarRef}
      className="grid gap-3 border-b border-border px-4 py-3"
    >
      <div className="flex items-start justify-end gap-2">
        {showShelves ? (
          <div
            role="tablist"
            aria-label="Library shelf"
            data-library-shelf-rail=""
            className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
          >
            <Pill
              {...dropProps("all", false)}
              role="tab"
              aria-selected={selection === "all"}
              selected={selection === "all"}
              count={counts.all}
              onClick={() => onSelect("all")}
            >
              All games
              <LibraryGameHoverHint />
            </Pill>
            <Pill
              {...dropProps("favorites")}
              data-tour={practice ? "demo-favorites" : undefined}
              role="tab"
              aria-selected={selection === "favorites"}
              selected={selection === "favorites"}
              icon={Star}
              count={counts.favorites}
              onClick={() => onSelect("favorites")}
            >
              Favorites
              <LibraryGameHoverHint />
            </Pill>
            {shelves.map((shelf) => (
              <Pill
                key={shelf.id}
                data-tour={
                  practice
                    ? shelf.filters
                      ? "demo-filtered-shelf"
                      : "demo-personal-shelf"
                    : undefined
                }
                {...dropProps(shelf.id, !shelf.filters)}
                role="tab"
                aria-selected={selection === shelf.id}
                selected={selection === shelf.id}
                icon={shelf.filters ? SlidersHorizontal : FolderHeart}
                count={counts[shelf.id]}
                title={
                  shelf.filters
                    ? "Saved filters · updates automatically. Right-click to edit filters, rename, or delete."
                    : "Right-click to edit filters, rename, or delete"
                }
                onClick={() => onSelect(shelf.id)}
                onContextMenu={(event) => {
                  menuTriggerRef.current = event.currentTarget;
                  setMenuShelfId(shelf.id);
                  shelfMenu.props.onContextMenu(event);
                }}
                onKeyDown={(event) => {
                  if (
                    event.key !== "ContextMenu" &&
                    !(event.shiftKey && event.key === "F10")
                  )
                    return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  menuTriggerRef.current = event.currentTarget;
                  setMenuShelfId(shelf.id);
                  shelfMenu.openAt({ x: rect.left, y: rect.bottom + 6 });
                }}
              >
                {shelf.name}
                <LibraryGameHoverHint />
              </Pill>
            ))}
            <Pill
              data-tour={practice ? "demo-new-shelf" : undefined}
              icon={Plus}
              onClick={() => edit("new")}
            >
              New shelf
            </Pill>
          </div>
        ) : null}
        {selectionAction}
        <Button
          data-tour={practice ? "demo-filters-toggle" : undefined}
          variant={expanded || activeCount ? "secondary" : "ghost"}
          icon={SlidersHorizontal}
          aria-expanded={expanded}
          aria-controls="library-filters"
          className="shrink-0"
          onClick={() => onExpandedChange(!expanded)}
        >
          Filters{activeCount ? ` · ${activeCount}` : ""}
        </Button>
      </div>

      {expanded ? (
        <div
          data-tour={practice ? "demo-library-filters" : undefined}
          id="library-filters"
          className="grid gap-3 rounded-xl border border-border bg-bg p-4"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closeFilters();
          }}
        >
          {selected ? (
            <div className="border-b border-border pb-3">
              <h3 className="text-sm font-semibold text-text">
                Filters for {selected.name}
              </h3>
              <p className="mt-1 text-xs text-text-muted">
                Preview matches from your whole library. Save these filters to
                update this shelf automatically.
              </p>
            </div>
          ) : null}
          <FilterGroup label="Progress">
            <Pill
              selected={!filters.status}
              onClick={() => setFilter("status", undefined)}
            >
              Any
            </Pill>
            <Pill
              data-tour={practice ? "demo-filter-status-none" : undefined}
              selected={filters.status === "none"}
              onClick={() =>
                setFilter(
                  "status",
                  filters.status === "none" ? undefined : "none",
                )
              }
            >
              No status
            </Pill>
            {GAME_STATUS_LIST.map((value) => (
              <Pill
                key={value}
                data-tour={practice ? `demo-filter-status-${value}` : undefined}
                selected={filters.status === value}
                onClick={() =>
                  setFilter(
                    "status",
                    filters.status === value
                      ? undefined
                      : (value as GameStatus),
                  )
                }
              >
                <span
                  className={`h-2 w-2 rounded-full ${STATUS_TONES[value].dot}`}
                />
                {GAME_STATUSES[value]}
              </Pill>
            ))}
          </FilterGroup>
          <FilterGroup label="Playtime">
            <Pill
              selected={!filters.played}
              onClick={() => setFilter("played", undefined)}
            >
              Any
            </Pill>
            <Pill
              selected={filters.played === "played"}
              onClick={() =>
                setFilter(
                  "played",
                  filters.played === "played" ? undefined : "played",
                )
              }
            >
              Played
            </Pill>
            <Pill
              selected={filters.played === "unplayed"}
              onClick={() =>
                setFilter(
                  "played",
                  filters.played === "unplayed" ? undefined : "unplayed",
                )
              }
            >
              Never played
            </Pill>
            <span aria-hidden className="mx-1 h-6 w-px bg-border" />
            <Pill
              icon={Star}
              selected={filters.favorite === true}
              onClick={() =>
                setFilter("favorite", filters.favorite ? undefined : true)
              }
            >
              Favorites only
            </Pill>
            <Pill
              selected={filters.installed === true}
              onClick={() =>
                setFilter("installed", filters.installed ? undefined : true)
              }
            >
              Installed (Steam / Xbox)
            </Pill>
          </FilterGroup>
          <FilterGroup label="Emulator">
            <Pill
              selected={!filters.emulator}
              onClick={() => setFilter("emulator", undefined)}
            >
              Any
            </Pill>
            {(
              [
                ["dosbox", "DOSBox"],
                ["dolphin", "Dolphin"],
                ["pcsx2", "PCSX2"],
              ] as const
            ).map(([value, label]) => (
              <Pill
                key={value}
                selected={filters.emulator === value}
                onClick={() =>
                  setFilter(
                    "emulator",
                    filters.emulator === value ? undefined : value,
                  )
                }
              >
                {label}
              </Pill>
            ))}
          </FilterGroup>
          <FilterGroup label="Untouched">
            <Pill
              selected={!filters.lastPlayedDays}
              onClick={() => setFilter("lastPlayedDays", undefined)}
            >
              Any
            </Pill>
            {(
              [
                [30, "30 days"],
                [90, "90 days"],
                [180, "6 months"],
                [365, "A year"],
              ] as const
            ).map(([days, label]) => (
              <Pill
                key={days}
                selected={filters.lastPlayedDays === days}
                onClick={() =>
                  setFilter(
                    "lastPlayedDays",
                    filters.lastPlayedDays === days ? undefined : days,
                  )
                }
              >
                {label}
              </Pill>
            ))}
          </FilterGroup>
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            {selected ? (
              <Button
                data-tour={practice ? "demo-save-filters" : undefined}
                variant="primary"
                icon={Save}
                aria-label={`Save filters to ${selected.name}`}
                disabled={!activeCount || !filtersChanged}
                onClick={() => {
                  save({ ...selected, filters: draftFilters });
                  closeFilters();
                  addToast({
                    tone: "success",
                    title: "Filters saved",
                    detail: selected.name,
                  });
                }}
              >
                Save filters
              </Button>
            ) : null}
            {selected ? (
              <Button variant="ghost" onClick={closeFilters}>
                Cancel
              </Button>
            ) : null}
            {selected?.filters ? (
              <Button
                variant="ghost"
                onClick={() => {
                  save({ ...selected, filters: undefined });
                  closeFilters();
                  addToast({
                    tone: "success",
                    title: "Saved filters removed",
                    detail: selected.name,
                  });
                }}
              >
                Remove saved filters
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={onClearFilters}
              disabled={!activeCount}
            >
              Clear filters
            </Button>
            {showShelves ? (
              <p className="ml-auto text-xs text-text-faint">
                {selected
                  ? "Removing saved filters restores games added by hand."
                  : "Create or select a shelf to save filters."}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {showShelves && menuShelf ? (
        <ContextMenu
          dataTour={practice ? "demo-library-menu" : undefined}
          open={shelfMenu.open}
          position={shelfMenu.position}
          onClose={closeShelfMenu}
          focusFirstItem
        >
          <ContextMenuHeading>{menuShelf.name}</ContextMenuHeading>
          <ContextMenuItem
            icon={SlidersHorizontal}
            onClick={() => {
              closeShelfMenu();
              onSelect(menuShelf.id);
              onExpandedChange(true);
              focusFiltersButton();
            }}
          >
            Edit filters
          </ContextMenuItem>
          <ContextMenuItem
            icon={Pencil}
            onClick={() => {
              closeShelfMenu();
              edit(menuShelf);
            }}
          >
            Edit
          </ContextMenuItem>
          <ContextMenuItem
            icon={Trash2}
            danger
            onClick={() => {
              closeShelfMenu();
              setDeleting(menuShelf);
            }}
          >
            Delete
          </ContextMenuItem>
        </ContextMenu>
      ) : null}

      {showShelves && editor ? (
        <Modal
          dataTour={practice ? "demo-shelf-editor" : undefined}
          backdropDataTour={practice ? "demo-library-modal" : undefined}
          labelId="shelf-editor-title"
          title={typeof editor === "object" ? "Edit shelf" : "New shelf"}
          icon={FolderHeart}
          onClose={() => setEditor(null)}
          footer={
            <Button
              data-tour={practice ? "demo-shelf-save" : undefined}
              type="submit"
              form="shelf-editor-form"
              variant="primary"
              disabled={!name.trim()}
            >
              Save shelf
            </Button>
          }
        >
          <form
            id="shelf-editor-form"
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              const id = save({
                id: typeof editor === "object" ? editor.id : undefined,
                name,
                filters:
                  typeof editor === "object" ? editor.filters : undefined,
              });
              if (id) {
                if (typeof editor !== "object") {
                  onExpandedChange(false);
                  onSelect(id);
                  if (practice) emitTourEvent("library.demo-shelf-created");
                }
                setEditor(null);
              }
            }}
          >
            <Input
              data-tour={practice ? "demo-shelf-name" : undefined}
              data-autofocus
              aria-label="Shelf name"
              maxLength={NAME_LIMIT}
              value={name}
              placeholder="Weekend games"
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-text-muted">
              Add games by hand, or open Filters on this shelf to save rules
              that fill it automatically.
            </p>
          </form>
        </Modal>
      ) : null}
      {showShelves && deleting ? (
        <Modal
          dataTour={practice ? "demo-shelf-editor" : undefined}
          backdropDataTour={practice ? "demo-library-modal" : undefined}
          labelId="delete-shelf-title"
          title={`Delete “${deleting.name}”?`}
          icon={Trash2}
          size="sm"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button
                variant="ghost"
                data-autofocus
                onClick={() => setDeleting(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  remove(deleting.id);
                  if (selection === deleting.id) onSelect("all");
                  setDeleting(null);
                }}
              >
                Delete shelf
              </Button>
            </>
          }
        >
          <p className="text-sm text-text-muted">
            The games and their notes stay in your library.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
