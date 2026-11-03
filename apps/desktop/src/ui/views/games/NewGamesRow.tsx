import {
  LIBRARY_PROVIDER_LABELS,
  type LibraryProviderId,
} from "@playcounter/shared";
import clsx from "clsx";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  EyeOff,
  Layers,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { appLocale, getT } from "../../../i18n";
import { useCoverLookup } from "../../../pickedCovers";
import { GameOriginBadges } from "../../components";
import {
  ContextMenu,
  ContextMenuItem,
  useAnchoredMenu,
} from "../../ContextMenu";
import { GameCover } from "../../GameCover";
import {
  addedLabel,
  newRowEntries,
  newRowSummary,
  type NewRowEntry,
} from "../../newGamesRow";
import { Button, IconButton } from "../../primitives";
import type { GameSummary } from "../MyGamesView";

const t = getT("myGames");

/** The narrowest card; the row fits as many as its width allows. */
const CARD_MIN_WIDTH = 150;

/* The "New" row above the library (docs/new-games-row-plan.md): games added
   in the last 7 days and not played yet, on small cards, one line of them.
   The caller draws the game cards; the row draws the import cards. */
export function NewGamesRow({
  games,
  collapsed,
  onCollapsedChange,
  onHide,
  renderCard,
}: {
  /** The row's games, newest first (newRowGames). */
  games: readonly GameSummary[];
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onHide: () => void;
  /** A small game card, with its key. */
  renderCard: (game: GameSummary) => ReactNode;
}) {
  // Show all in the header: every new game on its own card, every line.
  const [expanded, setExpanded] = useState(false);
  // An import opened with its own Show all: the row shows only its games.
  const [openImport, setOpenImport] = useState<string | null>(null);
  const [grid, setGrid] = useState<HTMLDivElement | null>(null);
  // How many cards fit on one line. Null until measured.
  const [columns, setColumns] = useState<number | null>(null);
  const menu = useAnchoredMenu();
  const entries = useMemo(() => newRowEntries(games), [games]);

  useLayoutEffect(() => {
    if (!grid) return;
    const measure = () => {
      const width = grid.clientWidth;
      if (!width) {
        // No layout (a hidden view, or a test): keep the last count, else all.
        setColumns((current) => current ?? Number.POSITIVE_INFINITY);
        return;
      }
      const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
      setColumns(
        Math.max(1, Math.floor((width + gap) / (CARD_MIN_WIDTH + gap))),
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(grid);
    return () => observer?.disconnect();
  }, [grid]);

  const overflow = columns !== null && entries.length > columns;
  // Gone once all its games were played or turned 7 days old.
  const importShown = expanded
    ? undefined
    : entries.find(
        (entry): entry is Extract<typeof entry, { kind: "import" }> =>
          entry.kind === "import" && entry.key === openImport,
      );
  const opened = expanded || importShown !== undefined;
  const asCards = (list: readonly GameSummary[]): NewRowEntry<GameSummary>[] =>
    list.map((game) => ({ kind: "game", game }));
  // Opened, every line; closed, the first line.
  const shown = expanded
    ? asCards(games)
    : importShown
      ? asCards(importShown.games)
      : columns === null
        ? []
        : entries.slice(0, columns);
  const close = () => {
    setExpanded(false);
    setOpenImport(null);
  };
  const toggleCollapsed = () => {
    close();
    onCollapsedChange(!collapsed);
  };
  const foldLabel = collapsed ? t("Show the row") : t("Fold the row");

  return (
    <section
      aria-label={t("New games")}
      className={collapsed ? "mb-5" : "mb-7"}
    >
      <div
        className={clsx(
          "flex min-h-8 items-center justify-between gap-3",
          collapsed
            ? "rounded-xl border border-border/70 bg-surface/85 py-1.5 pl-1 pr-2"
            : "mb-3",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            aria-label={foldLabel}
            title={foldLabel}
            aria-expanded={!collapsed}
            aria-controls={collapsed ? undefined : "new-games-row-cards"}
            onClick={toggleCollapsed}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-text-muted transition hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <ChevronDown
              size={16}
              className={clsx(
                "transition-transform duration-200",
                collapsed && "-rotate-90",
              )}
            />
          </button>
          {/* The title folds too, for the mouse; the arrow is the control. */}
          <h2
            onClick={toggleCollapsed}
            className="flex shrink-0 cursor-pointer select-none items-center gap-2 text-lg font-bold tracking-tight text-text"
          >
            <Sparkles size={17} className="text-accent-ink" />
            {t("New games")}
          </h2>
          <span className="shrink-0 rounded-full border border-accent/30 bg-accent/15 px-2 font-mono text-xs font-semibold text-accent-ink">
            {games.length.toLocaleString(appLocale())}
          </span>
          <span
            className="min-w-0 truncate text-[13px] text-text-muted"
            title={collapsed ? newRowSummary(entries) : undefined}
          >
            {collapsed
              ? newRowSummary(entries)
              : importShown
                ? t("{{launcher}} import, {{count}} new games", {
                    launcher: LIBRARY_PROVIDER_LABELS[importShown.provider],
                    count: importShown.games.length,
                  })
                : t("Added in the last 7 days, not played yet")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!collapsed && (opened || overflow) ? (
            <Button
              variant="ghost"
              aria-expanded={opened}
              aria-controls="new-games-row-cards"
              onClick={() => (opened ? close() : setExpanded(true))}
              className="h-8 px-2.5 text-[13px]"
            >
              {opened ? (
                <>
                  {t("Show less")}
                  <ChevronUp size={15} />
                </>
              ) : (
                <>
                  {t("Show all {{count}}", { count: games.length })}
                  <ChevronRight size={15} />
                </>
              )}
            </Button>
          ) : null}
          <IconButton
            ref={menu.anchorRef}
            icon={MoreHorizontal}
            aria-label={t("More options for the New games row")}
            aria-haspopup="menu"
            aria-expanded={menu.open}
            title={t("More")}
            onClick={menu.toggle}
            className="border-transparent"
          />
        </div>
      </div>
      {collapsed ? null : (
        <div
          ref={setGrid}
          id="new-games-row-cards"
          className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3"
        >
          {shown.map((entry) =>
            entry.kind === "game" ? (
              renderCard(entry.game)
            ) : (
              <ImportCard
                key={`import:${entry.key}`}
                provider={entry.provider}
                games={entry.games}
                onShowAll={() => setOpenImport(entry.key)}
              />
            ),
          )}
        </div>
      )}
      <ContextMenu
        open={menu.open}
        position={menu.position}
        onClose={menu.close}
        anchorRef={menu.anchorRef}
      >
        <ContextMenuItem
          icon={EyeOff}
          onClick={() => {
            menu.close();
            onHide();
          }}
        >
          {t("Hide row")}
        </ContextMenuItem>
      </ContextMenu>
    </section>
  );
}

/* 5 or more games one launcher brought in on one day: fanned covers, the
   count, and Show all, which makes the row show only this import's games. */
function ImportCard({
  provider,
  games,
  onShowAll,
}: {
  provider: LibraryProviderId;
  games: readonly GameSummary[];
  onShowAll: () => void;
}) {
  const coverFor = useCoverLookup();
  const launcher = LIBRARY_PROVIDER_LABELS[provider];
  const count = games.length;
  // Three covers fanned out: the newest in front, the next two behind it.
  const covers = games
    .map((game) => coverFor({ ...game, gameName: game.name }, game.coverUrl))
    .filter(Boolean)
    .slice(0, 3);
  const [front, right, left] = covers;

  return (
    <article
      data-controller-item="game-card"
      tabIndex={-1}
      aria-label={t("{{launcher}} import, {{count}} new games", {
        launcher,
        count,
      })}
      className="group relative isolate flex flex-col overflow-hidden rounded-[10px] border border-border/70 bg-surface shadow-raised transition duration-200 hover:-translate-y-1 hover:border-accent/80 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg data-[controller-selected=true]:z-20 data-[controller-selected=true]:scale-[1.04] data-[controller-selected=true]:border-accent data-[controller-selected=true]:outline data-[controller-selected=true]:outline-2 data-[controller-selected=true]:outline-offset-[7px] data-[controller-selected=true]:outline-white/80 data-[controller-selected=true]:ring-[7px] data-[controller-selected=true]:ring-accent data-[controller-selected=true]:ring-offset-4 data-[controller-selected=true]:ring-offset-bg"
    >
      {/* A / Enter on the selected card opens the row. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-controller-launch="import"
        className="hidden"
        onClick={onShowAll}
      />
      <div className="new-row-stack relative aspect-[3/4] w-full shrink-0 overflow-hidden">
        {left ? (
          <GameCover
            src={left}
            alt=""
            draggable={false}
            className="new-row-fan new-row-fan-left"
          />
        ) : null}
        {right ? (
          <GameCover
            src={right}
            alt=""
            draggable={false}
            className="new-row-fan new-row-fan-right"
          />
        ) : null}
        {front ? (
          <GameCover
            src={front}
            alt=""
            draggable={false}
            className="new-row-fan new-row-fan-front"
          />
        ) : (
          <div className="grid h-full place-items-center text-text-faint">
            <Layers size={32} />
          </div>
        )}
        <span className="absolute bottom-[9%] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/15 bg-black/75 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          {t("{{count}} games", { count })}
        </span>
      </div>
      <div className="flex flex-1 flex-col border-t border-border bg-surface px-2.5 pb-2 pt-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <GameOriginBadges providers={[provider]} emulatorIds={[]} />
          <h3 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-text">
            {t("{{launcher}} import", { launcher })}
          </h3>
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-text-muted">
          {addedLabel(games[0]?.addedAt, Date.now())}
        </div>
      </div>
      <button
        type="button"
        onClick={onShowAll}
        className="flex h-8 shrink-0 items-center justify-center gap-1.5 border-t border-border text-[11.5px] font-semibold text-text-muted transition hover:bg-surface-hover hover:text-text"
      >
        {t("Show all {{count}}", { count })}
        <ChevronRight size={13} />
      </button>
    </article>
  );
}
