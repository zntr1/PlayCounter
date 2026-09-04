import type { GameSource, LibraryProviderId } from "@playcounter/shared";
import {
  CalendarDays,
  Clock3,
  ExternalLink,
  FolderOpen,
  Gamepad2,
  History,
  Info,
  Loader2,
  Star,
  WifiOff,
} from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGameDetails } from "../../../gameDetails";
import type { ScopedExeLink } from "../../../library/types";
import type { LaunchTarget } from "../../../store";
import { gameMetadataKey, useAppStore } from "../../../store";
import { GameCover } from "../../GameCover";
import { ExeIcon } from "../../ExeIcon";
import { Button } from "../../primitives";
import { Modal } from "../../primitives";
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
import {
  summarizeGameSessions,
  RECENT_WINDOW_DAYS,
} from "../../gameDetailsStats";

/* The game details dialog ────────────────────────────────────────────────────
   Two halves that answer two different questions. "What do I know about my
   time with this game" comes entirely from local data and is always shown.
   "What is this game" comes from IGDB through the API and degrades quietly:
   loading, offline and "no IGDB entry" are all normal states here, not errors
   worth a toast. */

const PROVIDER_LABEL: Record<LibraryProviderId, string> = {
  steam: "Steam",
  xbox: "Xbox",
};

const PROVIDER_ID_LABEL: Record<LibraryProviderId, string> = {
  steam: "Steam AppID",
  xbox: "Xbox title ID",
};

export type GameDetailsTarget = {
  gameId: number;
  igdbId?: number;
  name: string;
  coverUrl: string;
  source: GameSource | null;
  sources: GameSource[];
  totalSeconds: number;
  recordedSeconds: number;
  adjustmentSeconds: number;
  archivedSeconds: number;
  sessionCount: number;
  historyGameKey: string | null;
  lastPlayedAt: string;
  exeNames: string[];
  emulatorLabels: string[];
  emulatorIds: string[];
  emulatorContentKeys: string[];
  providerFloorSeconds: number;
  communitySuggestionId?: number;
  communitySuggestionVerified?: boolean;
  communitySuggestionStatus?: Parameters<
    typeof communitySuggestionApproval
  >[0]["status"];
  libraryImports: Array<{
    provider: LibraryProviderId;
    externalId: string;
    installed: boolean;
    entry: { providerSeconds: number | null; importedAt: string };
    install?: { installPath: string };
  }>;
};

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

function Section({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: typeof Info;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-bg p-4">
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-text">
          <Icon size={15} className="text-accent" />
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-text-faint">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-base font-semibold text-text">
        {value}
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

export function GameDetailsDialog({
  game,
  launchTargets,
  onClose,
}: {
  game: GameDetailsTarget;
  /** Saved launch files owned by this game, in the card's own priority order. */
  launchTargets: readonly LaunchTarget[];
  onClose: () => void;
}) {
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const sessions = useAppStore((state) => state.recentSessions);
  const scopedExeLinks = useAppStore((state) => state.scopedExeLinks);
  const setActiveView = useAppStore((state) => state.setActiveView);
  const setHistoryQuery = useAppStore((state) => state.setHistoryQuery);
  const setHistoryGameKey = useAppStore((state) => state.setHistoryGameKey);
  const addToast = useAppStore((state) => state.addToast);
  const details = useGameDetails(game.igdbId ? game.gameId : undefined);
  // Release year already known from matching, so the title line is never empty
  // while the details request is in flight.
  const cachedReleaseYear = useAppStore((state) =>
    game.source === "igdb" || game.source === "community"
      ? state.gameMetadata.get(
          gameMetadataKey({ id: game.gameId, source: game.source }),
        )?.releaseYear
      : undefined,
  );

  const stats = useMemo(
    () =>
      summarizeGameSessions(sessions, {
        gameKey: game.historyGameKey,
        archivedSeconds: game.archivedSeconds,
        nowMs: Date.now(),
      }),
    [game.archivedSeconds, game.historyGameKey, sessions],
  );

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
  const localSeconds = Math.max(
    0,
    game.recordedSeconds + game.adjustmentSeconds,
  );
  const resolved = details.status === "ready" ? details.details : null;
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

  async function openOnIgdb() {
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
    setHistoryQuery(game.name);
    setHistoryGameKey(game.historyGameKey);
    setActiveView("history");
    onClose();
  }

  return (
    <Modal
      size="wide"
      labelId="game-details-title"
      eyebrow="Game details"
      title={game.name}
      subtitle={releaseLabel ? `Released ${releaseLabel}` : undefined}
      icon={Info}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button icon={ExternalLink} onClick={() => void openOnIgdb()}>
            Open on IGDB
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-5">
          <div className="w-40 shrink-0">
            {game.coverUrl ? (
              // Always the larger art here: one image, opened deliberately.
              <GameCover
                src={game.coverUrl}
                highRes
                alt=""
                className="aspect-[3/4] w-full rounded-lg border border-border object-cover shadow-raised"
              />
            ) : (
              <div className="grid aspect-[3/4] w-full place-items-center rounded-lg border border-border bg-surface text-xs text-text-faint">
                No cover
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <GameProvenanceBadges
                sources={game.sources}
                approval={communitySuggestionApproval({
                  suggestionId: game.communitySuggestionId,
                  verified: game.communitySuggestionVerified,
                  status: game.communitySuggestionStatus,
                })}
                providers={importedProviders}
                emulatorIds={game.emulatorIds}
                unknownDurationProviders={importedProviders.filter((provider) =>
                  hasUnknownProviderPlaytime(game.libraryImports, provider),
                )}
              />
              {resolved?.rating !== undefined ? (
                <span
                  className="inline-flex items-center gap-1 text-sm text-text-muted"
                  title="IGDB user rating"
                >
                  <Star size={13} className="text-accent" />
                  {resolved.rating}/100
                </span>
              ) : null}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <Figure label="Playtime" value={duration(game.totalSeconds)} />
              <Figure
                label="Sessions"
                value={String(Math.max(game.sessionCount, stats.sessionCount))}
              />
              <Figure
                label="Last played"
                value={
                  game.sessionCount > 0
                    ? (formatDate(stats.lastPlayedAt ?? game.lastPlayedAt) ??
                      "Unknown")
                    : "Never"
                }
              />
            </div>
            {resolved?.summary ? (
              <p className="mt-3 max-h-32 overflow-y-auto whitespace-pre-line text-sm leading-6 text-text-muted">
                {resolved.summary}
              </p>
            ) : null}
          </div>
        </div>

        <Section
          title="Your playtime"
          icon={Clock3}
          action={
            game.historyGameKey ? (
              <Button icon={History} onClick={showHistory}>
                Show in History
              </Button>
            ) : undefined
          }
        >
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <Figure
              label="Tracked by PlayCounter"
              value={duration(localSeconds)}
            />
            <Figure
              label="Average session"
              value={
                stats.sessionCount > 0 ? duration(stats.averageSeconds) : "-"
              }
            />
            <Figure
              label="Longest session"
              value={
                stats.longestSeconds > 0 ? duration(stats.longestSeconds) : "-"
              }
            />
            <Figure
              label={`Last ${RECENT_WINDOW_DAYS} days`}
              value={duration(stats.last30DaysSeconds)}
            />
            <Figure label="Days played" value={String(stats.daysPlayed)} />
            <Figure
              label="First played"
              value={formatDate(stats.firstPlayedAt) ?? "-"}
            />
          </div>
          {game.providerFloorSeconds > 0 ? (
            <p className="mt-3 text-xs leading-5 text-text-faint">
              Playtime shows the highest single source, never the sum. Launcher
              lifetime: {duration(game.providerFloorSeconds)} · recorded here:{" "}
              {duration(localSeconds)}.
            </p>
          ) : null}
          {stats.truncated ? (
            <p className="mt-2 text-xs leading-5 text-text-faint">
              Older sessions have been folded into the total to save space, so
              &quot;first played&quot; and &quot;longest session&quot; describe
              the sessions still stored on this PC.
            </p>
          ) : null}
          {stats.sessionCount === 0 ? (
            <p className="mt-3 text-sm text-text-muted">
              No sessions recorded on this PC yet.
            </p>
          ) : null}
        </Section>

        <Section title="Tracked files" icon={FolderOpen}>
          {game.exeNames.length === 0 && game.emulatorLabels.length === 0 ? (
            <p className="text-sm text-text-muted">
              Nothing on this PC is linked to this game yet, so new sessions
              will not be tracked.
            </p>
          ) : (
            <div className="grid gap-2">
              {game.exeNames.map((exeName) => {
                const scoped = scopedByExe.get(exeName.toLowerCase());
                const target = launchTargets.find(
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
                        {scoped ? "This folder only" : "Anywhere on this PC"}
                      </span>
                    </div>
                    {scoped ? (
                      <div className="mt-1.5 break-all text-xs text-text-faint">
                        {scoped.pathPrefix}
                      </div>
                    ) : null}
                    {target ? (
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="min-w-0 flex-1 break-all text-xs text-text-muted">
                          {target.path}
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
        </Section>

        {game.libraryImports.length > 0 ? (
          <Section title="Where it came from" icon={CalendarDays}>
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
                          ? "Not reported"
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
          </Section>
        ) : null}

        {game.igdbId ? (
          <Section title="About this game" icon={Info}>
            {details.status === "loading" ? (
              <p className="flex items-center gap-2 text-sm text-text-muted">
                <Loader2 size={14} className="animate-spin" />
                Loading details from IGDB…
              </p>
            ) : details.status === "offline" ? (
              <p className="flex items-center gap-2 text-sm text-text-muted">
                <WifiOff size={14} />
                Details need a connection to the PlayCounter database.
              </p>
            ) : details.status === "error" ? (
              <p className="text-sm text-text-muted">
                Details could not be loaded right now. Everything above comes
                from this PC and is unaffected.
              </p>
            ) : resolved ? (
              <div className="grid gap-3">
                {resolved.genres.length > 0 ? (
                  <div>
                    <div className="mb-1.5 text-xs uppercase tracking-wider text-text-faint">
                      Genres
                    </div>
                    <Chips values={resolved.genres} />
                  </div>
                ) : null}
                {resolved.gameModes.length > 0 ? (
                  <div>
                    <div className="mb-1.5 text-xs uppercase tracking-wider text-text-faint">
                      Modes
                    </div>
                    <Chips values={resolved.gameModes} />
                  </div>
                ) : null}
                {resolved.platforms.length > 0 ? (
                  <div>
                    <div className="mb-1.5 text-xs uppercase tracking-wider text-text-faint">
                      Platforms
                    </div>
                    <Chips values={resolved.platforms} />
                  </div>
                ) : null}
                <div className="divide-y divide-border">
                  {resolved.developers.length > 0 ? (
                    <Row
                      label="Developer"
                      value={resolved.developers.join(", ")}
                    />
                  ) : null}
                  {resolved.publishers.length > 0 ? (
                    <Row
                      label="Publisher"
                      value={resolved.publishers.join(", ")}
                    />
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                The database has no extra information for this game yet.
              </p>
            )}
          </Section>
        ) : null}
      </div>
    </Modal>
  );
}
