import type { Session } from "@playcounter/shared";
import {
  Check,
  Clock3,
  Copy,
  ExternalLink,
  Flag,
  Hourglass,
  Timer,
  Trophy,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import type { GameDetailsState } from "../../../gameDetails";
import {
  hltbPlatform,
  hltbRuns,
  hltbStorefront,
  howLongToBeatSubmitUrl,
  howLongToBeatUrl,
  PACES,
  preferredRun,
  runDates,
  splitDuration,
  timeToBeatMarks,
  timeToBeatProgress,
  type HltbRun,
  type Pace,
  type TimeToBeatProgress,
} from "../../../howLongToBeat";
import { appLocale, getT } from "../../../i18n";
import { defaultPlaythroughName } from "../../../personalLibrary";
import { personalGameIdentity, useAppStore } from "../../../store";
import { formatDuration } from "../../components";
import {
  usePersonalLibraryApi,
  usePersonalLibraryState,
} from "../../PersonalLibraryContext";
import { Button } from "../../primitives";
import { emitTourEvent } from "../../tour/TourUI";
import { useGameJournal } from "../../useGameJournal";
import type { GameSummary } from "../MyGamesView";
import { Figure, Panel, SkeletonBar, SourceTag } from "./detailsPanels";

const t = getT("games");

/* The "How long to beat" tab ─────────────────────────────────────────────────
   IGDB's three times under HowLongToBeat's names, a bar with a mark for each,
   and the values for adding your own time on howlongtobeat.com. PlayCounter
   never talks to HowLongToBeat itself: the buttons open HowLongToBeat's form
   for the game and the game's page there (its id comes from Wikidata through
   the API). Without that id only HowLongToBeat's search is left.

   One playthrough picker drives both halves, so the time left and the values
   can never be about different runs. It starts on the playthrough played or
   finished last (preferredRun). See docs/howlongtobeat-plan.md. */

const PACE_ICONS: Record<Pace, LucideIcon> = {
  hastily: Timer,
  normally: Hourglass,
  completely: Trophy,
};

function paceLabel(pace: Pace) {
  return pace === "hastily"
    ? t("Main story")
    : pace === "normally"
      ? t("Main + extras")
      : t("Completionist");
}

const HOUR = 3_600;

/** IGDB's averages and what is left of them: whole hours from two hours on,
 *  shorter spans keep their minutes. */
function roughDuration(seconds: number, showDays: boolean) {
  if (seconds < 2 * HOUR) return formatDuration(seconds, showDays);
  const hours = Math.round(seconds / HOUR);
  return showDays && hours >= 24
    ? formatDuration(hours * HOUR, true)
    : t("{{hours}}h", { hours });
}

function progressLine(progress: TimeToBeatProgress, showDays: boolean) {
  const played = formatDuration(progress.playedSeconds, showDays);
  if (progress.state === "finished")
    return progress.averageSeconds
      ? t("Finished in {{played}} · average {{average}}", {
          played,
          average: roughDuration(progress.averageSeconds, showDays),
        })
      : t("Finished in {{played}}", { played });
  if (progress.state === "past-all")
    return t("{{played}} played · past every average", { played });
  const left = roughDuration(progress.leftSeconds, showDays);
  return progress.nextPace === "hastily"
    ? t("{{played}} played · about {{left}} to Main story", { played, left })
    : progress.nextPace === "normally"
      ? t("{{played}} played · about {{left}} to Main + extras", {
          played,
          left,
        })
      : t("{{played}} played · about {{left}} to Completionist", {
          played,
          left,
        });
}

const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString(appLocale());

export function HowLongToBeatTab({
  game,
  details,
  sessions,
  demo,
  onOpenIgdb,
}: {
  game: GameSummary;
  details: GameDetailsState;
  /** The dialog's sessions: the real ones, or the tour's sample sessions. */
  sessions: readonly Session[];
  demo: boolean;
  onOpenIgdb: () => void;
}) {
  const showDays = useAppStore((state) => state.settings.showDurationDays);
  const addToast = useAppStore((state) => state.addToast);
  const libraryApi = usePersonalLibraryApi();
  const gameRef = { ...game, gameName: game.name };
  const journal = useGameJournal(gameRef);
  const archived = usePersonalLibraryState(
    (state) => state.archivedPlaythroughSeconds,
  );
  // Scoped like the journal's playthrough ledger, so both show the same hours.
  const identity = personalGameIdentity(libraryApi.getState());
  const gameKey = identity(gameRef);
  const runs = hltbRuns({
    journal,
    gameSessions: sessions.filter((session) => identity(session) === gameKey),
    archivedPlaythroughSeconds: archived,
    gameTotalSeconds: game.totalSeconds,
  });
  // Undefined until the player picks: then the tab follows preferredRun.
  const [pickedId, setPickedId] = useState<string | null | undefined>();
  const run =
    (pickedId === undefined
      ? undefined
      : runs.find((entry) => entry.id === pickedId)) ?? preferredRun(runs);

  const resolved = details.status === "ready" ? details.details : null;
  const time = resolved?.timeToBeat;
  const marks = timeToBeatMarks(time);
  const progress = run
    ? timeToBeatProgress(time, run.seconds, run.finished)
    : null;

  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1_500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copy(name: string, text: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard"); // i18n-exempt: never shown
      await navigator.clipboard.writeText(text);
      setCopied(name);
    } catch {
      addToast({
        tone: "error",
        title: t("PlayCounter cannot reach the clipboard right now."),
      });
    }
  }

  const submitUrl = howLongToBeatSubmitUrl(resolved?.hltbId);

  async function openHowLongToBeat(url: string, demoMessage: string) {
    if (demo) {
      emitTourEvent("demo.action-completed", demoMessage);
      return;
    }
    try {
      await invoke("open_external_url", { url });
    } catch (error) {
      addToast({
        tone: "error",
        title: t("Could not open HowLongToBeat"),
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const numbers =
    details.status === "loading" ? (
      <div
        className="grid gap-2"
        role="status"
        aria-label={t("Loading details")}
      >
        <SkeletonBar className="h-14 w-full" />
        <SkeletonBar className="h-3 w-2/3" />
      </div>
    ) : details.status === "offline" ? (
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <WifiOff size={14} />
        {t("Details need a connection to the PlayCounter database.")}
      </p>
    ) : details.status === "error" ? (
      <p className="text-sm text-text-muted">
        {t("Time to beat could not be loaded right now.")}
      </p>
    ) : marks.length === 0 || !time ? (
      <p className="text-sm text-text-muted">
        {t("No time to beat known for this game yet.")}
      </p>
    ) : (
      <div className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-3">
          {PACES.map((pace) => {
            const seconds = marks.find((mark) => mark.pace === pace)?.seconds;
            return (
              <Figure
                key={pace}
                icon={PACE_ICONS[pace]}
                label={paceLabel(pace)}
                value={seconds ? roughDuration(seconds, showDays) : "-"}
              />
            );
          })}
        </div>
        <div className="grid gap-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="text-sm font-semibold text-text">
              {progress ? progressLine(progress, showDays) : null}
            </span>
            <span className="text-xs text-text-faint">
              {t("From {{players}} players on IGDB", {
                count: time.count,
                players: time.count.toLocaleString(appLocale()),
              })}
            </span>
          </div>
          {run ? (
            <MarksBar
              marks={marks}
              playedSeconds={run.seconds}
              finished={run.finished}
              showDays={showDays}
            />
          ) : null}
        </div>
      </div>
    );

  return (
    <div className="grid gap-4">
      {runs.length > 1 && run ? (
        <RunPicker
          runs={runs}
          selected={run}
          showDays={showDays}
          onSelect={(entry) => setPickedId(entry.id)}
        />
      ) : null}

      <Panel
        title={t("How long to beat")}
        icon={Hourglass}
        action={<SourceTag label={t("Source: IGDB")} onClick={onOpenIgdb} />}
      >
        {numbers}
      </Panel>

      {run ? (
        <Panel title={t("Add your time to HowLongToBeat")} icon={Clock3}>
          <p className="mb-3 text-sm text-text-muted">
            {t(
              "HowLongToBeat opens in your browser. Sign in there, then enter these values.",
            )}
          </p>
          <RunValues
            run={run}
            providers={game.libraryImports.map(({ provider }) => provider)}
            copied={copied}
            onCopy={(name, text) => void copy(name, text)}
          />
          <p className="mt-3 text-xs leading-5 text-text-muted">
            {run.finished
              ? t(
                  "On HowLongToBeat, enter it as “Main Story”, “Main + Extras” or “Completionist”, whichever fits how you played.",
                )
              : t(
                  "Still playing? On HowLongToBeat, add it to “Playing” with this time as your progress.",
                )}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {submitUrl ? (
              <Button
                variant="primary"
                icon={ExternalLink}
                onClick={() =>
                  void openHowLongToBeat(
                    submitUrl,
                    t(
                      "This is a sample. For a real game, this opens HowLongToBeat's form for adding your time.",
                    ),
                  )
                }
                className="h-11 rounded-lg px-6 font-semibold"
              >
                {t("Add my time on HowLongToBeat")}
              </Button>
            ) : null}
            <Button
              variant={submitUrl ? "secondary" : "primary"}
              icon={ExternalLink}
              onClick={() =>
                void openHowLongToBeat(
                  howLongToBeatUrl(game.name, resolved?.hltbId),
                  t(
                    "This is a sample. A real game's HowLongToBeat link opens its page.",
                  ),
                )
              }
              className="h-11 rounded-lg px-6 font-semibold"
            >
              {t("Open on HowLongToBeat")}
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

/** One pill per playthrough, marked like the journal's ledger: amber dot =
 *  finished, green dot = active. Arrow keys move between them. */
function RunPicker({
  runs,
  selected,
  showDays,
  onSelect,
}: {
  runs: readonly HltbRun[];
  selected: HltbRun;
  showDays: boolean;
  onSelect: (run: HltbRun) => void;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const index = runs.indexOf(selected);
    const next = (index + step + runs.length) % runs.length;
    onSelect(runs[next]);
    buttons.current[next]?.focus();
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[11px] font-medium uppercase tracking-wider text-text-faint">
        {t("Playthrough")}
      </span>
      <div
        role="radiogroup"
        aria-label={t("Playthrough")}
        onKeyDown={handleKeyDown}
        className="flex flex-wrap gap-2"
      >
        {runs.map((run, index) => {
          const checked = run === selected;
          return (
            <button
              key={run.id ?? "default"}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onSelect(run)}
              className={clsx(
                "inline-flex max-w-full items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                checked
                  ? "border-accent/70 bg-accent-tint text-accent-ink"
                  : "border-border bg-surface text-text-muted hover:border-accent/40 hover:text-text",
              )}
            >
              <span
                aria-hidden
                className={clsx(
                  "h-2 w-2 shrink-0 rounded-full",
                  run.finished
                    ? "bg-accent"
                    : run.active
                      ? "bg-success"
                      : "bg-text-faint",
                )}
              />
              <span className="truncate">
                {run.name ?? defaultPlaythroughName()}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-text-faint">
                {formatDuration(run.seconds, showDays)}
              </span>
              {run.active ? (
                <span
                  title={t("New sessions count towards this playthrough")}
                  className="shrink-0 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-ink"
                >
                  {t("Active")}
                </span>
              ) : null}
              {run.finished ? (
                <Flag
                  size={12}
                  className="shrink-0 text-success"
                  aria-label={t("Finished")}
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The track with a mark at each of IGDB's times. Labels that would run into
 *  the one before move to a second line. A bobble head ends the fill, with
 *  the played time on top (docs/howlongtobeat-bobble-mockups.html, A). */
function MarksBar({
  marks,
  playedSeconds,
  finished,
  showDays,
}: {
  marks: ReadonlyArray<{ pace: Pace; seconds: number }>;
  playedSeconds: number;
  finished: boolean;
  showDays: boolean;
}) {
  const scale =
    Math.max(marks[marks.length - 1]?.seconds ?? 0, playedSeconds, 1) * 1.04;
  const percent = (seconds: number) => Math.min(100, (seconds / scale) * 100);
  const rows: number[] = [];
  marks.forEach((mark, index) => {
    const gap =
      index > 0
        ? percent(mark.seconds) - percent(marks[index - 1].seconds)
        : Number.POSITIVE_INFINITY;
    rows.push(gap < 16 && rows[index - 1] === 0 ? 1 : 0);
  });
  const played = percent(playedSeconds);
  // The head stays fully on the track; near either end the bubble hangs
  // inward from it, its tip still on the head.
  const head = `clamp(10px, ${played}%, calc(100% - 10px))`;
  const bubble =
    played < 6
      ? { shift: "translateX(-10px)", tip: "10px" }
      : played > 94
        ? { shift: "translateX(calc(-100% + 10px))", tip: "calc(100% - 10px)" }
        : { shift: "translateX(-50%)", tip: "50%" };
  return (
    <div aria-hidden className="pt-8">
      <div className="relative h-2.5 rounded-full bg-surface-hover">
        <div
          className={clsx(
            "absolute inset-y-0 left-0 rounded-full",
            finished ? "bg-success" : "bg-accent",
          )}
          style={{ width: `${percent(playedSeconds)}%` }}
        />
        {marks.map((mark) => (
          <span
            key={mark.pace}
            data-hltb-mark={mark.pace}
            className={clsx(
              "absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 rounded-full",
              playedSeconds >= mark.seconds
                ? "bg-accent-fg ring-2 ring-accent/60"
                : "bg-text ring-2 ring-bg",
            )}
            style={{ left: `${percent(mark.seconds)}%` }}
          />
        ))}
        <span
          data-hltb-knob
          className={clsx(
            "absolute top-1/2 z-[2] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-md ring-4",
            finished ? "bg-success ring-success/25" : "bg-accent ring-accent/25",
          )}
          style={{ left: head }}
        />
        <span
          data-hltb-played
          className={clsx(
            "absolute bottom-[calc(100%+11px)] z-[3] whitespace-nowrap rounded-md px-[7px] font-mono text-[11px] font-bold leading-[18px] shadow",
            finished ? "bg-success text-bg" : "bg-accent text-accent-fg",
          )}
          style={{ left: head, transform: bubble.shift }}
        >
          {formatDuration(playedSeconds, showDays)}
          <span
            className={clsx(
              "absolute top-full h-0 w-0 -translate-x-1/2 border-[5px] border-transparent",
              finished ? "border-t-success" : "border-t-accent",
            )}
            style={{ left: bubble.tip }}
          />
        </span>
      </div>
      <div
        className={clsx(
          "relative mt-1.5 text-[11px] text-text-faint",
          rows.includes(1) ? "h-8" : "h-4",
        )}
      >
        {marks.map((mark, index) => {
          const left = percent(mark.seconds);
          return (
            <span
              key={mark.pace}
              className={clsx(
                "absolute whitespace-nowrap",
                rows[index] ? "top-4" : "top-0",
                left > 88 ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: `${left}%` }}
            >
              {paceLabel(mark.pace)} {roughDuration(mark.seconds, showDays)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** What HowLongToBeat's form asks for, about the picked playthrough. */
function RunValues({
  run,
  providers,
  copied,
  onCopy,
}: {
  run: HltbRun;
  providers: Parameters<typeof hltbStorefront>[0];
  copied: string | null;
  onCopy: (name: string, text: string) => void;
}) {
  const platform = hltbPlatform(run.sessions);
  const store = hltbStorefront(providers);
  const { startedAt } = runDates(run.sessions);
  const time = t("{{hours}} h {{minutes}} min {{seconds}} s", {
    ...splitDuration(run.seconds),
  });
  const pickOnSite = t("Pick it on HowLongToBeat");
  const rows: Array<{
    name: string;
    label: string;
    value: string;
    note?: string;
    copy: boolean;
  }> = [
    {
      name: "platform",
      label: t("Platform"),
      value: platform ?? pickOnSite,
      copy: Boolean(platform),
    },
    {
      name: "store",
      label: t("Store"),
      value: store ?? pickOnSite,
      copy: Boolean(store),
    },
    { name: "time", label: t("Time played"), value: time, copy: true },
    {
      name: "started",
      label: t("Started on"),
      value: startedAt ? formatDay(startedAt) : t("Unknown"),
      copy: Boolean(startedAt),
    },
    {
      name: "finished",
      label: t("Finished on"),
      value:
        run.finished && run.finishedAt
          ? formatDay(run.finishedAt)
          : t("Not finished yet"),
      // The default playthrough has no finish date of its own.
      note:
        run.finished && run.finishedAt && run.id === null
          ? t("Your last session")
          : undefined,
      copy: Boolean(run.finished && run.finishedAt),
    },
  ];
  return (
    <div className="divide-y divide-border/70 overflow-hidden rounded-lg border border-border bg-surface">
      {rows.map((row) => (
        <div
          key={row.name}
          data-hltb-value={row.name}
          className="grid grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5"
        >
          <span className="text-xs uppercase tracking-wider text-text-faint">
            {row.label}
          </span>
          <span
            className={clsx(
              "min-w-0 text-sm",
              row.copy ? "font-semibold text-text" : "text-text-muted",
            )}
          >
            {row.value}
            {row.note ? (
              <span className="block text-xs font-normal text-text-faint">
                {row.note}
              </span>
            ) : null}
          </span>
          {row.copy ? (
            <button
              type="button"
              onClick={() => onCopy(row.name, row.value)}
              className={clsx(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                copied === row.name
                  ? "text-success"
                  : "text-text-muted hover:text-text",
              )}
            >
              {copied === row.name ? <Check size={14} /> : <Copy size={14} />}
              {copied === row.name ? t("Copied") : t("Copy")}
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
    </div>
  );
}
