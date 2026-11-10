import {
  usePersonalLibraryState,
  useLibraryPractice,
} from "./PersonalLibraryContext";
import { LIBRARY_PROVIDER_LABELS } from "@playcounter/shared";
import { EMULATORS } from "../emulators/registry";
import {
  AlertTriangle,
  EyeOff,
  FolderHeart,
  Pencil,
  Plus,
  PinOff,
  Save,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GAME_TIERS,
  gameStatusLabel,
  NAME_LIMIT,
  SHELF_HIDE_PLACES,
  journalHiddenIn,
  matchesLibraryFilters,
  normalizeLibraryFilters,
  readJournal,
  shelfHides,
  type FilterableLibraryGame,
  type GameJournal,
  type GameStatus,
  type LibraryFilters,
  type PersonalShelf,
  type ShelfHidePlace,
} from "../personalLibrary";
import { personalGameIdentity, type GameIdentityRef } from "../store";
import {
  Button,
  ContextMenu,
  ContextMenuHeading,
  ContextMenuItem,
  ContextMenuSubmenu,
  Input,
  Modal,
  Pill,
  useContextMenu,
} from "./primitives";
import { GAME_STATUS_LIST } from "./journalStyles";
import { GameStatusIcon } from "./GameStatusIcon";
import type { LibraryTabId } from "./libraryTabs";
import { LibraryGameHoverHint } from "./LibraryGameDropHint";
import { emitTourEvent } from "./tour/TourUI";
import { appLocale, getT } from "../i18n";
import { cn } from "./cn";

const t = getT("myGames");

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
  if (id === "favorites") return journal.favorite;
  const shelf = shelves.find((s) => s.id === id);
  // Favorites and the shelves the player filled show what is on them; All
  // games and the shelves that narrow it leave out what a shelf hides there.
  if (shelf && !shelf.filters) return journal.shelfIds.includes(shelf.id);
  if (journalHiddenIn(journal, shelves, "all")) return false;
  return shelf?.filters
    ? matchesLibraryFilters(game, journal, shelf.filters)
    : true;
}

export function countShelfGames(
  games: readonly OrganizedGame[],
  journalFor: (game: GameIdentityRef) => GameJournal,
  shelves: readonly PersonalShelf[],
) {
  const counts: Record<string, number> = {
    all: 0,
    favorites: 0,
  };
  for (const shelf of shelves) counts[shelf.id] = 0;
  for (const game of games) {
    const journal = journalFor({ ...game, gameName: game.name });
    if (matchesShelf(game, journal, "all", shelves)) counts.all += 1;
    if (journal.favorite) counts.favorites += 1;
    for (const shelf of shelves)
      if (matchesShelf(game, journal, shelf.id, shelves)) counts[shelf.id] += 1;
  }
  return counts;
}

export function hidePlaceLabel(place: ShelfHidePlace) {
  switch (place) {
    case "all":
      return t("All games and search");
    case "new":
      return t("New games row and banner");
    case "history":
      return t("My History");
    case "achievements":
      return t("Achievements");
    case "nowPlaying":
      return t("Now Playing");
  }
}

function hidePlaceDescription(place: ShelfHidePlace) {
  switch (place) {
    case "all":
      return t("Searching inside this shelf still finds them.");
    case "new":
      return t("They never show as new or as the featured game.");
    case "history":
      return t("Sessions, totals, charts and the calendar.");
    case "achievements":
      return t("Their ladders and unlocks.");
    case "nowPlaying":
      return t("The timer and the tray still show the game.");
  }
}

function hidePlaceShort(place: ShelfHidePlace) {
  switch (place) {
    case "all":
      return t("All games");
    case "new":
      return t("New games");
    case "history":
      return t("My History");
    case "achievements":
      return t("Achievements");
    case "nowPlaying":
      return t("Now Playing");
  }
}

/** Why a shelf that fills itself from filters cannot hide. Ticks saved
 *  before are paused: that one is a warning. */
function HidingNote({
  shelf,
  className,
}: {
  shelf: PersonalShelf;
  className?: string;
}) {
  if (!shelf.filters) return null;
  if (!shelf.hiddenIn?.length)
    return (
      <p className={cn("text-xs text-text-muted", className)}>
        {t("Only shelves you fill yourself can hide games.")}
      </p>
    );
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg border border-warning-border/60 bg-warning-tint/40 px-3 py-2 text-xs leading-5 text-warning",
        className,
      )}
    >
      <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
      <span className="min-w-0">
        {t(
          "Hiding is paused while this shelf fills itself from filters. Remove the saved filters to hide its games again.",
        )}
      </span>
    </p>
  );
}

function shelfTitle(shelf: PersonalShelf) {
  if (shelf.filters)
    return shelf.hiddenIn?.length
      ? t(
          "Fills itself from saved filters, so hiding is paused. Right-click to edit filters, rename, or delete.",
        )
      : t(
          "Fills itself from saved filters. Right-click to edit filters, rename, or delete.",
        );
  if (shelfHides(shelf))
    return t("Hidden in {{places}}. Right-click to change.", {
      places: new Intl.ListFormat(appLocale(), { type: "conjunction" }).format(
        shelf.hiddenIn!.map(hidePlaceShort),
      ),
    });
  return t("Right-click to edit filters, rename, or delete");
}

function toggledPlaces(
  places: readonly ShelfHidePlace[] | undefined,
  place: ShelfHidePlace,
) {
  return places?.includes(place)
    ? places.filter((entry) => entry !== place)
    : [...(places ?? []), place];
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
  leading,
  trailing,
}: {
  showShelves: boolean;
  selection: string;
  onSelect: (id: string) => void;
  filters: LibraryFilters;
  onFiltersChange: (filters: LibraryFilters) => void;
  expanded: boolean;
  onExpandedChange: (open: boolean, saved?: boolean) => void;
  onClearFilters: () => void;
  source: LibraryTabId;
  query: string;
  /** Games per shelf id within the selected library source. */
  counts: Record<string, number>;
  selectionAction?: React.ReactNode;
  /** Sits before the shelf chips: the library's title and count. */
  leading?: React.ReactNode;
  /** Sits after Filters: sort, view toggle, customize. */
  trailing?: React.ReactNode;
}) {
  const practice = useLibraryPractice();
  const shelves = usePersonalLibraryState((s) => s.personalShelves);
  const save = usePersonalLibraryState((s) => s.savePersonalShelf);
  const remove = usePersonalLibraryState((s) => s.deletePersonalShelf);
  const addToast = usePersonalLibraryState((s) => s.addToast);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const toolbarRowRef = useRef<HTMLDivElement>(null);
  const fitToolbar = useCallback(() => {
    const container = toolbarRef.current;
    const row = toolbarRowRef.current;
    if (!container || !row || !row.hasAttribute("data-heading")) return;
    const availableWidth = container.getBoundingClientRect().width;
    if (!availableWidth) return;

    // Measure the complete row before painting. A fixed breakpoint can move
    // shelves above the controls while the controls still need a second row.
    row.setAttribute("data-measuring", "");
    const requiredWidth = row.getBoundingClientRect().width;
    row.removeAttribute("data-measuring");
    row.toggleAttribute("data-single-row", requiredWidth <= availableWidth);
  }, []);
  // Labels, shelf counts, and summary settings can change the required width.
  useLayoutEffect(fitToolbar);
  useLayoutEffect(() => {
    const container = toolbarRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fitToolbar);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitToolbar]);
  const [editor, setEditor] = useState<PersonalShelf | "new" | null>(null);
  const [name, setName] = useState("");
  const [hiddenDraft, setHiddenDraft] = useState<ShelfHidePlace[]>([]);
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
  const sourceLabel =
    source === "all"
      ? null
      : source === "unimported"
        ? "PlayCounter"
        : LIBRARY_PROVIDER_LABELS[source];
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
    setHiddenDraft(
      typeof value === "object" && value ? (value.hiddenIn ?? []) : [],
    );
  }
  function setFilter(key: keyof LibraryFilters, value: unknown) {
    const next = { ...filters, [key]: value };
    if (value === undefined) delete next[key];
    onFiltersChange(next);
  }
  function closeFilters(saved = false) {
    onExpandedChange(false, saved);
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
      className="library-organization grid gap-3"
    >
      <div
        ref={toolbarRowRef}
        className="library-toolbar"
        data-heading={leading ? "true" : undefined}
        data-shelves={showShelves ? "true" : undefined}
      >
        {leading ? (
          <div className="library-toolbar-heading min-w-0">{leading}</div>
        ) : null}
        {showShelves ? (
          <div
            role="tablist"
            aria-label={t("Library shelf")}
            data-library-shelf-rail=""
            className="library-toolbar-shelves flex min-w-0 flex-wrap items-center gap-1.5"
          >
            <Pill
              {...dropProps("all", false)}
              role="tab"
              aria-selected={selection === "all"}
              selected={selection === "all"}
              count={counts.all}
              onClick={() => onSelect("all")}
            >
              {t("All games")}
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
              {t("Favorites")}
              <LibraryGameHoverHint />
            </Pill>
            {shelves.map((shelf) => (
              <Pill
                key={shelf.id}
                className="max-w-full [&>svg]:shrink-0 [&>span:last-child]:shrink-0"
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
                icon={
                  shelf.filters
                    ? SlidersHorizontal
                    : shelfHides(shelf)
                      ? EyeOff
                      : FolderHeart
                }
                count={counts[shelf.id]}
                title={shelfTitle(shelf)}
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
                <span className="min-w-0 truncate" title={shelf.name}>
                  {shelf.name}
                </span>
                <LibraryGameHoverHint />
              </Pill>
            ))}
            <Pill
              data-tour={practice ? "demo-new-shelf" : undefined}
              icon={Plus}
              onClick={() => edit("new")}
            >
              {t("New shelf")}
            </Pill>
          </div>
        ) : null}
        <div className="library-toolbar-actions">
          <div className="library-toolbar-selection flex items-center gap-2">
            {selectionAction}
            <Button
              data-tour={practice ? "demo-filters-toggle" : undefined}
              variant={expanded ? "active" : "secondary"}
              icon={SlidersHorizontal}
              aria-expanded={expanded}
              aria-controls="library-filters"
              className="h-9 shrink-0"
              onClick={() => onExpandedChange(!expanded)}
            >
              {t("Filters")}
              {activeCount ? ` · ${activeCount}` : ""}
            </Button>
          </div>
          {trailing ? (
            <div className="library-toolbar-display min-w-0">{trailing}</div>
          ) : null}
        </div>
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
                {t("Filters for {{name}}", { name: selected.name })}
              </h3>
              <p className="mt-1 text-xs text-text-muted">
                {t(
                  "The cards below preview every game in your library that matches these filters. Click Save filters to make this shelf fill itself from them.",
                )}
              </p>
            </div>
          ) : null}
          {sourceLabel ? (
            <FilterGroup label={t("Library")}>
              <Pill
                selected
                aria-label={t("Clear {{sourceLabel}} library filter", {
                  sourceLabel,
                })}
                title={t("Show games from all libraries")}
                onClick={() => setFilter("source", "all")}
              >
                {sourceLabel}
                <X size={12} aria-hidden className="shrink-0" />
              </Pill>
            </FilterGroup>
          ) : null}
          {draftFilters.search ? (
            <FilterGroup label={t("Search")}>
              <Pill
                selected
                className="min-w-0 max-w-full"
                aria-label={t("Clear search filter: {{search}}", {
                  search: draftFilters.search,
                })}
                title={t("Clear search filter: {{search}}", {
                  search: draftFilters.search,
                })}
                onClick={() => setFilter("search", "")}
              >
                <span className="min-w-0 truncate">{draftFilters.search}</span>
                <X size={12} aria-hidden className="shrink-0" />
              </Pill>
            </FilterGroup>
          ) : null}
          <FilterGroup label={t("Progress")}>
            <Pill
              selected={!filters.status}
              onClick={() => setFilter("status", undefined)}
            >
              {t("Any")}
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
              {t("No status")}
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
                <GameStatusIcon status={value} />
                {gameStatusLabel(value)}
              </Pill>
            ))}
          </FilterGroup>
          <FilterGroup label={t("Tier")}>
            <Pill
              selected={!filters.tier}
              onClick={() => setFilter("tier", undefined)}
            >
              {t("Any")}
            </Pill>
            {GAME_TIERS.map((value) => (
              <Pill
                key={value}
                data-tour={practice ? `demo-filter-tier-${value}` : undefined}
                selected={filters.tier === value}
                onClick={() =>
                  setFilter("tier", filters.tier === value ? undefined : value)
                }
              >
                {value}
              </Pill>
            ))}
            <Pill
              selected={filters.tier === "none"}
              onClick={() =>
                setFilter("tier", filters.tier === "none" ? undefined : "none")
              }
            >
              {t("No tier")}
            </Pill>
          </FilterGroup>
          <FilterGroup label={t("Playtime")}>
            <Pill
              selected={!filters.played}
              onClick={() => setFilter("played", undefined)}
            >
              {t("Any")}
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
              {t("Played")}
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
              {t("Never played")}
            </Pill>
            <span aria-hidden className="mx-1 h-6 w-px bg-border" />
            <Pill
              icon={Star}
              selected={filters.favorite === true}
              onClick={() =>
                setFilter("favorite", filters.favorite ? undefined : true)
              }
            >
              {t("Favorites only")}
            </Pill>
            <Pill
              selected={filters.installed === true}
              title={t(
                "Games PlayCounter can start: an installed Steam, Xbox, Epic or GOG copy, or a known .exe or ROM on this PC",
              )}
              onClick={() =>
                setFilter("installed", filters.installed ? undefined : true)
              }
            >
              {t("Launchable")}
            </Pill>
            <Pill
              selected={filters.installed === false}
              title={t(
                "Games PlayCounter can't start yet. Play one once or set its .exe to make it launchable.",
              )}
              onClick={() =>
                setFilter(
                  "installed",
                  filters.installed === false ? undefined : false,
                )
              }
            >
              {t("Not launchable")}
            </Pill>
          </FilterGroup>
          <FilterGroup label={t("Emulator")}>
            <Pill
              selected={!filters.emulator}
              onClick={() => setFilter("emulator", undefined)}
            >
              {t("Any")}
            </Pill>
            {EMULATORS.map(({ id: value, label }) => (
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
          <FilterGroup label={t("Not played for")}>
            <Pill
              selected={!filters.lastPlayedDays}
              onClick={() => setFilter("lastPlayedDays", undefined)}
            >
              {t("Any")}
            </Pill>
            {(
              [
                [30, t("30 days")],
                [90, t("90 days")],
                [180, t("6 months")],
                [365, t("A year")],
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
                aria-label={t("Save filters to {{name}}", {
                  name: selected.name,
                })}
                disabled={!activeCount || !filtersChanged}
                onClick={() => {
                  const pausing = shelfHides(selected);
                  save({ ...selected, filters: draftFilters });
                  closeFilters(true);
                  addToast(
                    pausing
                      ? {
                          tone: "info",
                          title: t("Hiding is paused for {{shelf}}", {
                            shelf: selected.name,
                          }),
                          detail: t(
                            "Its games show everywhere again while it fills itself from filters.",
                          ),
                        }
                      : {
                          tone: "success",
                          title: t("Filters saved"),
                          detail: selected.name,
                        },
                  );
                }}
              >
                {t("Save filters")}
              </Button>
            ) : null}
            {/* On a shelf this throws the draft away; with no shelf to revert
                to there is nothing to discard, so it only shuts the drawer. */}
            <Button variant="ghost" onClick={() => closeFilters()}>
              {selected ? t("Cancel") : t("Close")}
            </Button>
            {selected?.filters ? (
              <Button
                variant="ghost"
                onClick={() => {
                  save({ ...selected, filters: undefined });
                  closeFilters();
                  addToast(
                    selected.hiddenIn?.length
                      ? {
                          tone: "info",
                          title: t("{{shelf}} hides its games again", {
                            shelf: selected.name,
                          }),
                        }
                      : {
                          tone: "success",
                          title: t("Saved filters removed"),
                          detail: selected.name,
                        },
                  );
                }}
              >
                {t("Remove saved filters")}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={onClearFilters}
              disabled={!activeCount}
            >
              {t("Clear filters")}
            </Button>
            {showShelves ? (
              <p className="ml-auto text-xs text-text-faint">
                {selected
                  ? t(
                      "Remove saved filters brings back the games you added by hand.",
                    )
                  : t("Select a shelf to save these filters to it.")}
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
          {menuShelf.featuredGame ? (
            <ContextMenuItem
              icon={PinOff}
              onClick={() => {
                closeShelfMenu();
                save({ ...menuShelf, featuredGame: null });
              }}
            >
              {t("Use library banner")}
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem
            icon={SlidersHorizontal}
            onClick={() => {
              closeShelfMenu();
              onSelect(menuShelf.id);
              onExpandedChange(true);
              focusFiltersButton();
            }}
          >
            {t("Edit filters")}
          </ContextMenuItem>
          <ContextMenuItem
            icon={Pencil}
            onClick={() => {
              closeShelfMenu();
              edit(menuShelf);
            }}
          >
            {t("Edit")}
          </ContextMenuItem>
          {/* Each tick saves at once; the menu stays open for the next. The
              guide's practice leaves hiding out, like its shelf dialog. */}
          {!practice ? (
            <ContextMenuSubmenu label={t("Hide in")} icon={EyeOff}>
              <HidingNote
                shelf={menuShelf}
                className={
                  menuShelf.hiddenIn?.length
                    ? "mx-2 my-1 max-w-60"
                    : "max-w-60 px-3 py-1.5"
                }
              />
              {SHELF_HIDE_PLACES.map((place) => (
                <ContextMenuItem
                  key={place}
                  selected={Boolean(menuShelf.hiddenIn?.includes(place))}
                  disabled={Boolean(menuShelf.filters)}
                  onClick={() =>
                    save({
                      ...menuShelf,
                      hiddenIn: toggledPlaces(menuShelf.hiddenIn, place),
                    })
                  }
                >
                  {hidePlaceLabel(place)}
                </ContextMenuItem>
              ))}
            </ContextMenuSubmenu>
          ) : null}
          <ContextMenuItem
            icon={Trash2}
            danger
            onClick={() => {
              closeShelfMenu();
              setDeleting(menuShelf);
            }}
          >
            {t("Delete")}
          </ContextMenuItem>
        </ContextMenu>
      ) : null}

      {showShelves && editor ? (
        <Modal
          dataTour={practice ? "demo-shelf-editor" : undefined}
          backdropDataTour={practice ? "demo-library-modal" : undefined}
          labelId="shelf-editor-title"
          title={typeof editor === "object" ? t("Edit shelf") : t("New shelf")}
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
              {t("Save shelf")}
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
                ...(typeof editor === "object" ? editor : {}),
                id: typeof editor === "object" ? editor.id : undefined,
                name,
                filters:
                  typeof editor === "object" ? editor.filters : undefined,
                hiddenIn: hiddenDraft,
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
              aria-label={t("Shelf name")}
              maxLength={NAME_LIMIT}
              value={name}
              placeholder={t("Online Games")}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-text-muted">
              {t(
                "Drag games onto the shelf, or select the shelf, open Filters, and save them so the shelf fills itself.",
              )}
            </p>
            {!practice && typeof editor === "object" ? (
              <p className="text-xs text-text-muted">
                {t(
                  "Right-click a game on this shelf and choose Pin to shelf banner to give this shelf its own featured game.",
                )}
              </p>
            ) : null}
            {!practice ? (
              <ShelfHideSection
                shelf={typeof editor === "object" ? editor : null}
                places={hiddenDraft}
                onChange={setHiddenDraft}
              />
            ) : null}
          </form>
        </Modal>
      ) : null}
      {showShelves && deleting ? (
        <Modal
          dataTour={practice ? "demo-shelf-editor" : undefined}
          backdropDataTour={practice ? "demo-library-modal" : undefined}
          labelId="delete-shelf-title"
          title={t("Delete “{{name}}”?", { name: deleting.name })}
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
                {t("Cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  remove(deleting.id);
                  if (selection === deleting.id) onSelect("all");
                  setDeleting(null);
                }}
              >
                {t("Delete shelf")}
              </Button>
            </>
          }
        >
          <p className="text-sm text-text-muted">
            {t("The games and their notes stay in your library.")}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

/** The Edit / New shelf dialog's ticks. Saved with Save shelf. */
function ShelfHideSection({
  shelf,
  places,
  onChange,
}: {
  /** Null for a new shelf. One that fills itself from filters locks the ticks. */
  shelf: PersonalShelf | null;
  places: readonly ShelfHidePlace[];
  onChange: (places: ShelfHidePlace[]) => void;
}) {
  const locked = Boolean(shelf?.filters);
  return (
    <div
      role="group"
      aria-labelledby="shelf-hide-heading"
      className="grid gap-2 border-t border-border pt-4"
    >
      <h3
        id="shelf-hide-heading"
        className="flex items-center gap-2 text-sm font-semibold text-text"
      >
        <EyeOff size={15} aria-hidden="true" className="text-text-muted" />
        {t("Hide these games in")}
      </h3>
      {shelf && locked ? (
        <HidingNote shelf={shelf} />
      ) : (
        <p className="text-xs text-text-muted">
          {t(
            "They stay on this shelf. Untick a place to show them there again.",
          )}
        </p>
      )}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {SHELF_HIDE_PLACES.map((place) => (
          <li key={place}>
            <label
              className={cn(
                "flex items-start gap-3 px-3 py-2.5 transition-colors",
                locked
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer hover:bg-surface-hover/50",
              )}
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--color-accent))]"
                checked={places.includes(place)}
                disabled={locked}
                onChange={() => onChange(toggledPlaces(places, place))}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-text">
                  {hidePlaceLabel(place)}
                </span>
                <span className="block text-xs text-text-muted">
                  {hidePlaceDescription(place)}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
