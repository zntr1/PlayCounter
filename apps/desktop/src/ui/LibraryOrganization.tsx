import {
  FolderHeart,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Button, Input, Modal } from "./primitives";
import { journalSelectClass } from "./GameJournalDialog";
import type { LibraryTabId } from "./libraryTabs";

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
  if (id.startsWith("status:")) return journal.status === id.slice(7);
  const shelf = shelves.find((s) => s.id === id);
  return !shelf
    ? true
    : shelf.filters
      ? matchesLibraryFilters(game, journal, shelf.filters)
      : journal.shelfIds.includes(shelf.id);
}

export function LibraryOrganizationToolbar({
  selection,
  onSelect,
  filters,
  onFiltersChange,
  source,
  query,
}: {
  selection: string;
  onSelect: (id: string) => void;
  filters: LibraryFilters;
  onFiltersChange: (filters: LibraryFilters) => void;
  source: LibraryTabId;
  query: string;
}) {
  const shelves = useAppStore((s) => s.personalShelves);
  const save = useAppStore((s) => s.savePersonalShelf);
  const remove = useAppStore((s) => s.deletePersonalShelf);
  const [expanded, setExpanded] = useState(false);
  const [editor, setEditor] = useState<PersonalShelf | "new" | "filter" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected = shelves.find((s) => s.id === selection);
  const count = Object.values(filters).filter(
    (v) => v !== undefined && v !== false && v !== "",
  ).length;
  useEffect(() => {
    if (
      selection !== "all" &&
      selection !== "favorites" &&
      !selection.startsWith("status:") &&
      !shelves.some((s) => s.id === selection)
    )
      onSelect("all");
  }, [selection, shelves, onSelect]);
  function edit(value: typeof editor) {
    setEditor(value);
    setName(typeof value === "object" && value ? value.name : "");
    setConfirmDelete(false);
  }
  function setFilter(key: keyof LibraryFilters, value: unknown) {
    const next = { ...filters, [key]: value };
    if (value === undefined) delete next[key];
    onFiltersChange(next);
  }
  return (
    <div className="grid gap-3 border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <FolderHeart size={16} className="text-accent" />
        <select
          aria-label="Library shelf"
          value={selection}
          onChange={(event) => onSelect(event.target.value)}
          className={`${journalSelectClass} flex-1 sm:max-w-[280px]`}
        >
          <option value="all">All shelves</option>
          <option value="favorites">Favorites</option>
          <optgroup label="Progress">
            {Object.entries(GAME_STATUSES).map(([value, label]) => (
              <option key={value} value={`status:${value}`}>
                {label}
              </option>
            ))}
          </optgroup>
          {shelves.some((s) => !s.filters) ? (
            <optgroup label="My shelves">
              {shelves
                .filter((s) => !s.filters)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </optgroup>
          ) : null}
          {shelves.some((s) => s.filters) ? (
            <optgroup label="Saved filters">
              {shelves
                .filter((s) => s.filters)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </optgroup>
          ) : null}
        </select>
        <Button variant="ghost" icon={Plus} onClick={() => edit("new")}>
          New shelf
        </Button>
        {selected ? (
          <Button variant="ghost" icon={Pencil} onClick={() => edit(selected)}>
            Edit shelf
          </Button>
        ) : null}
        <Button
          variant={expanded || count ? "secondary" : "ghost"}
          icon={SlidersHorizontal}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          Filters{count ? ` · ${count}` : ""}
        </Button>
      </div>
      {selected?.filters ? (
        <p className="text-xs text-text-muted">
          Saved filter · updates automatically as your library changes.
        </p>
      ) : null}
      {expanded ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <select
              aria-label="Filter by status"
              className={journalSelectClass}
              value={filters.status ?? ""}
              onChange={(e) => setFilter("status", e.target.value || undefined)}
            >
              <option value="">Any status</option>
              {Object.entries(GAME_STATUSES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by playtime"
              className={journalSelectClass}
              value={filters.played ?? ""}
              onChange={(e) => setFilter("played", e.target.value || undefined)}
            >
              <option value="">Any playtime</option>
              <option value="unplayed">Unplayed</option>
              <option value="played">Played</option>
            </select>
            <select
              aria-label="Filter by installation"
              className={journalSelectClass}
              value={filters.installed ? "installed" : ""}
              onChange={(e) =>
                setFilter("installed", e.target.value ? true : undefined)
              }
            >
              <option value="">Any installation</option>
              <option value="installed">Installed (Steam / Xbox)</option>
            </select>
            <select
              aria-label="Filter by emulator"
              className={journalSelectClass}
              value={filters.emulator ?? ""}
              onChange={(e) =>
                setFilter("emulator", e.target.value || undefined)
              }
            >
              <option value="">Any emulator</option>
              <option value="dosbox">DOSBox</option>
              <option value="dolphin">Dolphin</option>
              <option value="pcsx2">PlayStation 2 · PCSX2</option>
            </select>
            <select
              aria-label="Filter by last played"
              className={journalSelectClass}
              value={filters.lastPlayedDays ?? ""}
              onChange={(e) =>
                setFilter(
                  "lastPlayedDays",
                  e.target.value ? Number(e.target.value) : undefined,
                )
              }
            >
              <option value="">Any last played date</option>
              <option value="30">Not played in 30 days</option>
              <option value="90">Not played in 90 days</option>
              <option value="180">Not played in 6 months</option>
              <option value="365">Not played in a year</option>
            </select>
            <label className="flex items-center gap-2 px-2 text-sm text-text">
              <input
                type="checkbox"
                checked={filters.favorite === true}
                className="h-4 w-4 accent-accent"
                onChange={(e) =>
                  setFilter("favorite", e.target.checked || undefined)
                }
              />
              Favorites only
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={Search}
              onClick={() => edit("filter")}
            >
              Save filter as shelf
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
                Update saved filter
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => onFiltersChange({})}
              disabled={!count}
            >
              Clear filters
            </Button>
          </div>
        </div>
      ) : null}
      {editor ? (
        <Modal
          labelId="shelf-editor-title"
          title={
            typeof editor === "object"
              ? "Edit shelf"
              : editor === "filter"
                ? "Save filter"
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
                  selection === "favorites"
                    ? { favorite: true }
                    : selection.startsWith("status:")
                      ? { status: selection.slice(7) as GameStatus }
                      : {};
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
                  onSelect(id);
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
                Saves these filters, the search, and the selected import source.
                Games join this shelf automatically.
              </p>
            ) : null}
            {typeof editor === "object" ? (
              <>
                {editor.filters ? (
                  <p className="text-xs text-text-muted">
                    Change its rules using Filters, then choose Update saved
                    filter.
                  </p>
                ) : null}
                {confirmDelete ? (
                  <div className="text-sm text-text-muted">
                    Delete this shelf? The games and their notes stay in your
                    library.
                    <div className="mt-2 flex gap-2">
                      <Button
                        variant="danger"
                        onClick={() => {
                          remove(editor.id);
                          onSelect("all");
                          setEditor(null);
                        }}
                      >
                        Delete shelf
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setConfirmDelete(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    icon={Trash2}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete shelf
                  </Button>
                )}
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
