import {
  FolderHeart,
  Pencil,
  Plus,
  SlidersHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GAME_STATUSES,
  NAME_LIMIT,
  matchesLibraryFilters,
  readJournal,
  type FilterableLibraryGame,
  type GameJournal,
  type GameStatus,
  type LibraryFilters,
  type PersonalShelf,
} from "../personalLibrary";
import {
  personalGameIdentity,
  useAppStore,
  type GameIdentityRef,
} from "../store";
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

export type OrganizedGame = FilterableLibraryGame & GameIdentityRef;

export function useLibraryJournalLookup() {
  const gameJournals = useAppStore((s) => s.gameJournals);
  const gameMetadata = useAppStore((s) => s.gameMetadata);
  const exeCache = useAppStore((s) => s.exeCache);
  const libraryImports = useAppStore((s) => s.libraryImports);
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
  selection,
  onSelect,
  filters,
  onFiltersChange,
  source,
  query,
  counts,
}: {
  selection: string;
  onSelect: (id: string) => void;
  filters: LibraryFilters;
  onFiltersChange: (filters: LibraryFilters) => void;
  source: LibraryTabId;
  query: string;
  /** Games per shelf id, counted across every import source. */
  counts: Record<string, number>;
}) {
  const shelves = useAppStore((s) => s.personalShelves);
  const save = useAppStore((s) => s.savePersonalShelf);
  const remove = useAppStore((s) => s.deletePersonalShelf);
  const [expanded, setExpanded] = useState(false);
  const [editor, setEditor] = useState<PersonalShelf | "new" | "filter" | null>(
    null,
  );
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
  const selected = shelves.find((s) => s.id === selection);
  const activeCount = Object.values(filters).filter(
    (v) => v !== undefined && v !== false && v !== "",
  ).length;
  useEffect(() => {
    if (
      selection !== "all" &&
      selection !== "favorites" &&
      !shelves.some((s) => s.id === selection)
    )
      onSelect("all");
  }, [selection, shelves, onSelect]);
  function edit(value: typeof editor) {
    setEditor(value);
    setName(typeof value === "object" && value ? value.name : "");
  }
  function setFilter(key: keyof LibraryFilters, value: unknown) {
    const next = { ...filters, [key]: value };
    if (value === undefined) delete next[key];
    onFiltersChange(next);
  }

  function dropProps(id: string, allowed = true) {
    return {
      "data-library-shelf": id,
      "data-library-drop-shelf": allowed ? id : undefined,
    };
  }

  return (
    <div className="grid gap-3 border-b border-border px-4 py-3">
      <div className="flex items-start gap-2">
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
              {...dropProps(shelf.id, !shelf.filters)}
              role="tab"
              aria-selected={selection === shelf.id}
              selected={selection === shelf.id}
              icon={shelf.filters ? SlidersHorizontal : FolderHeart}
              count={counts[shelf.id]}
              title={
                shelf.filters
                  ? "Saved filter · updates as your library changes. Right-click to edit or delete."
                  : "Right-click to edit or delete"
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
          <Pill icon={Plus} onClick={() => edit("new")}>
            New shelf
          </Pill>
        </div>
        <Button
          variant={expanded || activeCount ? "secondary" : "ghost"}
          icon={SlidersHorizontal}
          aria-expanded={expanded}
          className="shrink-0"
          onClick={() => setExpanded(!expanded)}
        >
          Filters{activeCount ? ` · ${activeCount}` : ""}
        </Button>
      </div>

      {expanded ? (
        <div className="grid gap-3 rounded-xl border border-border bg-bg p-4">
          <FilterGroup label="Progress">
            <Pill
              selected={!filters.status}
              onClick={() => setFilter("status", undefined)}
            >
              Any
            </Pill>
            {GAME_STATUS_LIST.map((value) => (
              <Pill
                key={value}
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
            <Button
              variant="secondary"
              icon={Plus}
              disabled={!activeCount}
              onClick={() => edit("filter")}
            >
              Save as shelf
            </Button>
            {selected?.filters ? (
              <Button
                variant="secondary"
                onClick={() =>
                  save({
                    ...selected,
                    filters: {
                      ...filters,
                      source,
                      search: query.trim() || undefined,
                    },
                  })
                }
              >
                Update {selected.name}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => onFiltersChange({})}
              disabled={!activeCount}
            >
              Clear filters
            </Button>
            <p className="ml-auto text-xs text-text-faint">
              A saved shelf keeps these rules, the search, and the import
              source.
            </p>
          </div>
        </div>
      ) : null}

      {menuShelf ? (
        <ContextMenu
          open={shelfMenu.open}
          position={shelfMenu.position}
          onClose={closeShelfMenu}
          focusFirstItem
        >
          <ContextMenuHeading>{menuShelf.name}</ContextMenuHeading>
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

      {editor ? (
        <Modal
          labelId="shelf-editor-title"
          title={
            typeof editor === "object"
              ? "Edit shelf"
              : editor === "filter"
                ? "Save filter as shelf"
                : "New shelf"
          }
          icon={FolderHeart}
          onClose={() => setEditor(null)}
          footer={
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={() => {
                const builtin =
                  selection === "favorites" ? { favorite: true } : {};
                const id = save({
                  id: typeof editor === "object" ? editor.id : undefined,
                  name,
                  filters:
                    editor === "filter"
                      ? {
                          ...builtin,
                          ...filters,
                          source,
                          search: query.trim() || undefined,
                        }
                      : typeof editor === "object"
                        ? editor.filters
                        : undefined,
                });
                if (id) {
                  if (typeof editor !== "object") onSelect(id);
                  setEditor(null);
                }
              }}
            >
              Save shelf
            </Button>
          }
        >
          <div className="grid gap-4">
            <Input
              data-autofocus
              aria-label="Shelf name"
              maxLength={NAME_LIMIT}
              value={name}
              placeholder={
                editor === "filter" ? "Installed but unplayed" : "Weekend games"
              }
              onChange={(e) => setName(e.target.value)}
            />
            {editor === "filter" ? (
              <p className="text-sm text-text-muted">
                Games join and leave this shelf on their own as your library
                changes.
              </p>
            ) : null}
            {typeof editor === "object" && editor.filters ? (
              <p className="text-xs text-text-muted">
                Change its rules under Filters, then choose Update {editor.name}
                .
              </p>
            ) : null}
          </div>
        </Modal>
      ) : null}
      {deleting ? (
        <Modal
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
