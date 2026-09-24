import type { LibraryProviderId } from "@playcounter/shared";
import {
  BarChart3,
  Building2,
  CalendarDays,
  Clock3,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  Info,
  Loader2,
  MoveRight,
  Play,
  Users,
  UserRound,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { useGameDetails } from "../../../gameDetails";
import type { ScopedExeLink } from "../../../library/types";
import { customHeroArtKey, gameMetadataKey, useAppStore } from "../../../store";
import { artSrcSet } from "../../artSrcSet";
import { heroArtwork } from "../../GameBanner";
import { GameCover } from "../../GameCover";
import { ExeIcon } from "../../ExeIcon";
import { Button, IconButton, Modal } from "../../primitives";
import {
  formatDuration,
  GameProvenanceBadges,
  ProviderBadge,
  communitySuggestionApproval,
} from "../../components";
import {
  libraryProviders,
  hasUnknownProviderPlaytime,
} from "../../providerLibrary";
import { summarizeGameSessions } from "../../gameDetailsStats";
import { useHeroLauncher } from "./useHeroLauncher";
import type { GameSummary } from "../MyGamesView";
import { emitTourEvent } from "../../tour/TourUI";
import { tourSessionsForGame } from "../../tour/tourDemoGame";

/* The game details dialog ────────────────────────────────────────────────────
   A hero header (the same artwork the library banner shows) with the cover,
   title, genres and IGDB rating, then two tabs. "General" answers "what is
   this game and how much have I played it"; "Files" answers "which file names
   and emulator matches are known for it and where did it come from".
   Anything deeper about sessions lives in History, one click away.

   The IGDB half degrades quietly: loading, offline and "no IGDB entry" are
   normal states here, not errors worth a toast. */

const PROVIDER_LABEL: Record<LibraryProviderId, string> = {
  steam: "Steam",
  xbox: "Xbox",
  battlenet: "Battle.net",
};

const PROVIDER_ID_LABEL: Record<LibraryProviderId, string> = {
  steam: "Steam AppID",
  xbox: "Xbox title ID",
  battlenet: "Battle.net product",
};

type DetailsTab = "general" | "files";

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

function Panel({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-bg p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
          <Icon size={15} className="text-accent-ink" />
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}

function Figure({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-accent/20 bg-accent-tint text-accent-ink">
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-text-faint">{label}</div>
        <div className="truncate font-mono text-base font-semibold text-text">
          {value}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5">
      <span className="text-xs uppercase tracking-wider text-text-faint">
        {label}
      </span>
      <span className="min-w-0 break-all text-right text-sm text-text">
        {value}
      </span>
    </div>
  );
}

/* Placeholders for the IGDB parts while they load: a pulsing block the size
   of the thing that is coming, so the dialog does not jump once the request
   lands. */
function SkeletonBar({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-surface-hover motion-reduce:animate-none ${className}`}
    />
  );
}

function Chips({ values }: { values: readonly string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          key={value}
          className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-text-muted"
        >
          {value}
        </span>
      ))}
    </div>
  );
}

function SourceTag({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-muted transition hover:border-accent/40 hover:text-text"
    >
      {label}
      <ExternalLink size={12} />
    </button>
  );
}

export function GameDetailsDialog({
  game,
  launchKey,
  launchBlocked,
  onAcquireLaunch,
  onReleaseLaunch,
  onClose,
  onMoveToPlayCounter,
  onDemoHistory,
}: {
  game: GameSummary;
  /** Own lock key, distinct from the opener's, so closing the dialog never
   *  releases a launch the card or banner still has in flight. */
  launchKey: string;
  launchBlocked: boolean;
  onAcquireLaunch: (key: string) => boolean;
  onReleaseLaunch: (key: string) => void;
  onClose: () => void;
  onMoveToPlayCounter?: () => void;
  onDemoHistory?: () => void;
}) {
  const demo = game.kind === "tour-demo";
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const realSessions = useAppStore((state) => state.recentSessions);
  const realScopedExeLinks = useAppStore((state) => state.scopedExeLinks);
  const sessions = useMemo(
    () => (demo ? tourSessionsForGame(game) : realSessions),
    [demo, game, realSessions],
  );
  const scopedExeLinks = useMemo(
    () => (demo ? new Map<string, ScopedExeLink>() : realScopedExeLinks),
    [demo, realScopedExeLinks],
  );
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setHistoryQuery = useAppStore((state) => state.setHistoryQuery);
  const setHistoryGameKey = useAppStore((state) => state.setHistoryGameKey);
  const addToast = useAppStore((state) => state.addToast);
  const pickedArt = useAppStore(
    (state) => state.customHeroArt[customHeroArtKey(game)],
  );
  const details = useGameDetails(demo ? undefined : game.igdbId);
  // Release year already known from matching, so the title line is never empty
  // while the details request is in flight.
  const cachedReleaseYear = useAppStore((state) =>
    game.source === "igdb" || game.source === "community"
      ? state.gameMetadata.get(
          gameMetadataKey({ id: game.gameId, source: game.source }),
        )?.releaseYear
      : undefined,
  );
  const realLauncher = useHeroLauncher(game, {
    launchKey,
    launchBlocked,
    onAcquireLaunch,
    onReleaseLaunch,
  });
  const launcher = demo
    ? { ...realLauncher, canLaunch: false, launchTargets: [] }
    : realLauncher;
  const [tab, setTab] = useState<DetailsTab>("general");
  const tabRefs = useRef<Record<DetailsTab, HTMLButtonElement | null>>({
    general: null,
    files: null,
  });

  const stats = useMemo(
    () =>
      summarizeGameSessions(sessions, {
        gameKey: game.historyGameKey,
        archivedSeconds: game.archivedSeconds,
        nowMs: Date.now(),
      }),
    [game.archivedSeconds, game.historyGameKey, sessions],
  );
  // The library summary already selects the newest local or provider date.
  // Without play evidence its timestamp is only the date the game was added.
  const hasLastPlayedEvidence =
    game.hasLastPlayedEvidence || game.sessionCount > 0;
  const lastPlayedAt = hasLastPlayedEvidence
    ? game.lastPlayedAt
    : stats.lastPlayedAt;
  const hasPlayed =
    hasLastPlayedEvidence ||
    stats.sessionCount > 0 ||
    game.recordedSeconds > 0 ||
    game.totalSeconds > 0 ||
    game.libraryImports.some(({ entry }) => entry.providerSeconds === null);

  const scopedByExe = useMemo(() => {
    const byExe = new Map<string, ScopedExeLink>();
    for (const link of scopedExeLinks.values()) {
      byExe.set(link.exeName.toLowerCase(), link);
    }
    return byExe;
  }, [scopedExeLinks]);

  const importedProviders = libraryProviders(game.libraryImports);
  const duration = (seconds: number) =>
    formatDuration(Math.max(0, seconds), showDurationDays);
  const resolved = details.status === "ready" ? details.details : null;
  const artwork = heroArtwork(demo ? undefined : pickedArt, resolved);
  const igdbUrl =
    resolved?.igdbUrl ??
    `https://www.igdb.com/search?type=1&q=${encodeURIComponent(game.name)}`;
  // IGDB's exact date when the details load, otherwise the year the match
  // already carries, so the line under the title is filled in immediately and
  // does not depend on the details request succeeding.
  const releaseLabel =
    (resolved?.releaseDate ? formatDate(resolved.releaseDate) : null) ??
    (resolved?.releaseYear ?? cachedReleaseYear)?.toString() ??
    null;
  const fileCount =
    game.exeNames.length +
    game.emulatorLabels.length +
    game.libraryImports.length;

  async function openOnIgdb() {
    if (demo) {
      emitTourEvent(
        "demo.action-completed",
        "This is a sample. A real game's IGDB link opens its database page.",
      );
      return;
    }
    try {
      await invoke("open_external_url", { url: igdbUrl });
    } catch (error) {
      addToast({
        tone: "error",
        title: "Could not open IGDB",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function revealPath(path: string) {
    if (demo) return;
    try {
      await invoke("reveal_executable", { path });
    } catch (error) {
      addToast({
        tone: "error",
        title: "Could not open the game file",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function showHistory() {
    if (demo) {
      onDemoHistory?.();
      return;
    }
    setHistoryQuery(game.name);
    setHistoryGameKey(game.historyGameKey);
    setActiveView("history");
    onClose();
  }

  function selectTab(next: DetailsTab) {
    setTab(next);
    tabRefs.current[next]?.focus();
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    selectTab(tab === "general" ? "files" : "general");
  }

  const launchTitle = launcher.hasActiveSession
    ? "Already running"
    : launcher.launching
      ? "Starting…"
      : launchBlocked
        ? "Another game is starting"
        : launcher.launchLabel;

  const tabs: Array<{ id: DetailsTab; label: string; icon: LucideIcon }> = [
    { id: "general", label: "General", icon: Info },
    { id: "files", label: "Files", icon: FolderOpen },
  ];

  const header = (
    // Only the artwork layer clips: the badge popover hangs below the header
    // and must be free to overlap the body.
    <div className="relative isolate z-10 shrink-0 border-b border-border bg-surface">
      {/* Artwork sits behind everything; the shade keeps the left half
          readable and the bottom fades into the panel so the tabs read. */}
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {artwork ? (
          <img
            src={artwork}
            srcSet={artSrcSet(artwork)}
            sizes="1024px"
            alt=""
            decoding="async"
            className="library-hero-art absolute inset-0 h-full w-full object-cover object-[72%_0%]"
          />
        ) : game.coverUrl ? (
          <GameCover
            src={game.coverUrl}
            alt=""
            loading="eager"
            className="hero-backdrop absolute inset-0 h-full w-full scale-125 object-cover blur-3xl saturate-150"
          />
        ) : null}
        <div className="library-hero-shade absolute inset-0" />
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-surface via-surface/70 to-transparent" />
      </div>

      <IconButton
        icon={X}
        aria-label="Close"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 bg-bg/40 backdrop-blur"
      />

      <div className="game-details-heading relative grid gap-5 px-5 pt-5 sm:grid-cols-[150px_minmax(0,1fr)] sm:px-6 sm:pt-6">
        <div className="hidden sm:block">
          {game.coverUrl ? (
            // Always the larger art here: one image, opened deliberately.
            <GameCover
              src={game.coverUrl}
              highRes
              alt=""
              className="aspect-[3/4] w-full rounded-lg object-cover shadow-card-hover ring-1 ring-white/10"
            />
          ) : (
            <div className="grid aspect-[3/4] w-full place-items-center rounded-lg border border-border bg-surface/80 text-xs text-text-faint backdrop-blur">
              No cover
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-accent-ink">
            <Gamepad2 size={13} />
            Game details
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2 pr-10">
            <h2
              id="game-details-title"
              className="break-words font-serif text-[32px] font-bold leading-[1.1] tracking-tight text-text drop-shadow-md"
            >
              {game.name}
            </h2>
            <GameProvenanceBadges
              sources={game.sources}
              emulatorSources={game.emulatorSources}
              approval={
                game.emulatorApproval ??
                communitySuggestionApproval({
                  suggestionId: game.communitySuggestionId,
                  verified: game.communitySuggestionVerified,
                  status: game.communitySuggestionStatus,
                })
              }
              providers={importedProviders}
              emulatorIds={game.emulatorIds}
              unknownDurationProviders={importedProviders.filter((provider) =>
                hasUnknownProviderPlaytime(game.libraryImports, provider),
              )}
            />
          </div>
          {releaseLabel ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-text-muted">
              <CalendarDays size={15} />
              Released {releaseLabel}
            </p>
          ) : null}

          <div className="mt-auto flex items-end justify-between gap-4 pt-5">
            <div
              role="tablist"
              aria-label="Game details sections"
              onKeyDown={handleTabKeyDown}
              className="flex gap-1"
            >
              {tabs.map(({ id, label, icon: Icon }) => {
                const selected = tab === id;
                return (
                  <button
                    key={id}
                    ref={(element) => {
                      tabRefs.current[id] = element;
                    }}
                    type="button"
                    role="tab"
                    id={`game-details-tab-${id}`}
                    aria-selected={selected}
                    data-autofocus={selected || undefined}
                    aria-controls={`game-details-panel-${id}`}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTab(id)}
                    className={clsx(
                      "relative inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                      selected
                        ? "bg-surface/80 text-accent-ink backdrop-blur after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent"
                        : "text-text-muted hover:bg-surface/50 hover:text-text",
                    )}
                  >
                    <Icon size={15} />
                    {label}
                    {id === "files" ? (
                      <span
                        className={clsx(
                          "font-mono text-[11px] tabular-nums",
                          selected ? "text-accent-ink/80" : "text-text-faint",
                        )}
                      >
                        {fileCount}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {resolved?.rating !== undefined ? (
              <div
                className="mb-2 flex shrink-0 items-center gap-3 rounded-lg border border-border bg-surface/80 px-3 py-2 backdrop-blur"
                title="IGDB user rating"
              >
                <div className="text-[11px] leading-tight text-text-muted">
                  IGDB
                  <br />
                  Rating
                </div>
                <div className="font-mono text-2xl font-bold text-text">
                  {resolved.rating}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );

  const aboutBody = !game.igdbId ? (
    // Community entries added before suggestions carried an IGDB id - and
    // custom games - have no IGDB identity to look anything up with. Saying
    // so beats hiding the panel, which just looks like it failed.
    <p className="text-sm text-text-muted">
      {game.source === "custom"
        ? "This is your own entry, so there is no database record behind it."
        : "This game is not linked to an IGDB entry yet, so there is nothing to show here."}{" "}
      Open on IGDB searches by name instead.
    </p>
  ) : details.status === "loading" ? (
    <div className="grid gap-2" role="status" aria-label="Loading details">
      <SkeletonBar className="h-3 w-full" />
      <SkeletonBar className="h-3 w-full" />
      <SkeletonBar className="h-3 w-2/3" />
    </div>
  ) : details.status === "offline" ? (
    <p className="flex items-center gap-2 text-sm text-text-muted">
      <WifiOff size={14} />
      Details need a connection to the PlayCounter database.
    </p>
  ) : details.status === "error" ? (
    <p className="text-sm text-text-muted">
      Details could not be loaded right now. Your summary below comes from this
      PC and is unaffected.
    </p>
  ) : resolved ? (
    <div className="grid gap-4">
      {resolved.summary ? (
        <p className="whitespace-pre-line text-sm leading-6 text-text-muted">
          {resolved.summary}
        </p>
      ) : (
        <p className="text-sm text-text-muted">
          The database has no description for this game yet.
        </p>
      )}
      {(
        [
          ["Genres", resolved.genres],
          ["Modes", resolved.gameModes],
          ["Platforms", resolved.platforms],
        ] as const
      )
        .filter(([, values]) => values.length > 0)
        .map(([label, values]) => (
          <div key={label} className="flex flex-wrap items-center gap-2">
            <span className="w-20 shrink-0 text-[11px] font-medium uppercase tracking-wider text-text-faint">
              {label}
            </span>
            <Chips values={values} />
          </div>
        ))}
    </div>
  ) : (
    <p className="text-sm text-text-muted">
      The database has no description for this game yet.
    </p>
  );

  const generalTab = (
    <div className="grid gap-4">
      <Panel
        title="About this game"
        icon={Info}
        action={
          <SourceTag label="Source: IGDB" onClick={() => void openOnIgdb()} />
        }
      >
        {aboutBody}
      </Panel>

      <Panel title="Your summary" icon={Gamepad2}>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Figure
            icon={Clock3}
            label="Total playtime"
            value={duration(game.totalSeconds)}
          />
          <Figure
            icon={Users}
            label="Sessions"
            value={String(Math.max(game.sessionCount, stats.sessionCount))}
          />
          <Figure
            icon={CalendarDays}
            label="First played"
            value={formatDate(stats.firstPlayedAt) ?? "-"}
          />
          <Figure
            icon={CalendarDays}
            label="Last played"
            value={
              formatDate(lastPlayedAt) ?? (hasPlayed ? "Unknown" : "Never")
            }
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {launcher.canLaunch ? (
            // Same weight as the banner's Play: the one thing to do here.
            <Button
              variant="primary"
              icon={launcher.launching ? Loader2 : Play}
              disabled={
                launcher.launching || launcher.hasActiveSession || launchBlocked
              }
              title={launchTitle}
              aria-label={`${launcher.launchLabel}: ${game.name}`}
              onClick={() => void launcher.launch()}
              className="library-hero-play h-12 rounded-lg px-7 text-[15px] font-bold shadow-[0_8px_24px_rgb(var(--color-accent)/0.35)]"
            >
              {launcher.hasActiveSession
                ? "Running"
                : launcher.launching
                  ? "Starting…"
                  : launcher.launchLabel}
            </Button>
          ) : null}
          <Button
            icon={ExternalLink}
            onClick={() => void openOnIgdb()}
            className="h-12 rounded-lg px-5 font-semibold"
          >
            Open on IGDB
          </Button>
          {game.historyGameKey ? (
            <Button
              icon={BarChart3}
              onClick={showHistory}
              className="ml-auto h-12 rounded-lg px-5 font-semibold"
            >
              Show in History
            </Button>
          ) : null}
        </div>
      </Panel>

      {resolved &&
      (resolved.developers.length > 0 || resolved.publishers.length > 0) ? (
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 px-2 pt-1">
          {resolved.developers.length > 0 ? (
            <div className="flex items-center gap-3">
              <UserRound size={20} className="text-text-faint" />
              <div>
                <div className="text-xs text-text-faint">Developer</div>
                <div className="text-sm text-text">
                  {resolved.developers.join(", ")}
                </div>
              </div>
            </div>
          ) : null}
          {resolved.developers.length > 0 && resolved.publishers.length > 0 ? (
            <div className="hidden h-8 w-px bg-border sm:block" />
          ) : null}
          {resolved.publishers.length > 0 ? (
            <div className="flex items-center gap-3">
              <Building2 size={20} className="text-text-faint" />
              <div>
                <div className="text-xs text-text-faint">Publisher</div>
                <div className="text-sm text-text">
                  {resolved.publishers.join(", ")}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const filesTab = (
    <div className="grid gap-4">
      <Panel title="Known file matches" icon={FolderOpen}>
        {game.exeNames.length === 0 && game.emulatorLabels.length === 0 ? (
          <p className="text-sm text-text-muted">
            No file names or emulator matches are saved for this game yet.
            PlayCounter can look for a match when you run the game.
          </p>
        ) : (
          <div className="grid gap-2">
            <p className="text-sm text-text-muted">
              These matches help PlayCounter recognize the game when it runs.
              They do not confirm that it is currently installed.
            </p>
            {game.exeNames.map((exeName) => {
              const scoped = scopedByExe.get(exeName.toLowerCase());
              const target = launcher.launchTargets.find(
                (entry) =>
                  entry.exeName.toLowerCase() === exeName.toLowerCase(),
              );
              return (
                <div
                  key={exeName}
                  className="rounded-lg border border-border bg-surface px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <ExeIcon
                      exePath={target?.path ?? null}
                      className="h-4 w-4 shrink-0"
                      fallback={
                        <Gamepad2
                          size={15}
                          className="shrink-0 text-text-faint"
                        />
                      }
                    />
                    <span className="min-w-0 truncate font-mono text-sm text-text">
                      {exeName}
                    </span>
                    <span className="ml-auto shrink-0 text-[11px] uppercase tracking-wider text-text-faint">
                      {scoped ? "Matches in folder" : "Matches by name"}
                    </span>
                  </div>
                  {scoped ? (
                    <div className="mt-1.5 break-all text-xs text-text-faint">
                      Tracking folder: {scoped.pathPrefix}
                    </div>
                  ) : null}
                  {target ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="min-w-0 flex-1 break-all text-xs text-text-muted">
                        Saved launch path: {target.path}
                      </span>
                      <Button
                        icon={FolderOpen}
                        className="shrink-0 px-2 py-1 text-xs"
                        onClick={() => void revealPath(target.path)}
                      >
                        Show
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {game.emulatorLabels.map((label, index) => (
              <div
                key={`${label}-${index}`}
                className="rounded-lg border border-border bg-surface px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <Gamepad2 size={15} className="shrink-0 text-text-faint" />
                  <span className="text-sm text-text">{label}</span>
                  <span className="ml-auto text-[11px] uppercase tracking-wider text-text-faint">
                    Emulator
                  </span>
                </div>
                {game.emulatorContentKeys[index] ? (
                  <div className="mt-1.5 break-all font-mono text-xs text-text-faint">
                    {game.emulatorContentKeys[index]}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {game.libraryImports.length > 0 ? (
        <Panel
          title="Where it came from"
          icon={CalendarDays}
          action={
            onMoveToPlayCounter ? (
              <Button icon={MoveRight} onClick={onMoveToPlayCounter}>
                Move to PlayCounter
              </Button>
            ) : undefined
          }
        >
          <div className="grid gap-3">
            {game.libraryImports.map((entry) => (
              <div
                key={`${entry.provider}:${entry.externalId}`}
                className="rounded-lg border border-border bg-surface px-3 py-2"
              >
                {/* The launcher's own mark, so the source is recognisable
                    before reading a word of it. */}
                <div className="flex items-center gap-2 border-b border-border pb-2">
                  <ProviderBadge provider={entry.provider} variant="mark" />
                  <span className="text-sm font-semibold text-text">
                    {PROVIDER_LABEL[entry.provider]}
                  </span>
                </div>
                <div className="divide-y divide-border">
                  <Row
                    label={PROVIDER_ID_LABEL[entry.provider]}
                    value={
                      <span className="font-mono">{entry.externalId}</span>
                    }
                  />
                  <Row
                    label={`${PROVIDER_LABEL[entry.provider]} playtime`}
                    value={
                      entry.entry.providerSeconds === null
                        ? entry.provider === "battlenet"
                          ? "Not available"
                          : "Not reported"
                        : duration(entry.entry.providerSeconds)
                    }
                  />
                  <Row
                    label="Imported"
                    value={formatDate(entry.entry.importedAt) ?? "Unknown"}
                  />
                  <Row
                    label="Installed here"
                    value={entry.installed ? "Yes" : "No"}
                  />
                  {entry.install?.installPath ? (
                    <Row
                      label="Install folder"
                      value={
                        <span className="font-mono text-xs">
                          {entry.install.installPath}
                        </span>
                      }
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );

  return (
    <Modal
      dataTour={demo ? "demo-game-details" : undefined}
      backdropDataTour={demo ? "demo-library-modal" : undefined}
      className="game-details-dialog"
      size="xl"
      labelId="game-details-title"
      title={game.name}
      header={header}
      onClose={onClose}
    >
      <div
        role="tabpanel"
        id={`game-details-panel-${tab}`}
        aria-labelledby={`game-details-tab-${tab}`}
      >
        {tab === "general" ? generalTab : filesTab}
      </div>
    </Modal>
  );
}
