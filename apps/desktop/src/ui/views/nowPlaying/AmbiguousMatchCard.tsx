import type { Game, IdentifierFlagReason } from "@playcounter/shared";
import {
  AlertTriangle,
  Ban,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  EyeOff,
  Gamepad2,
  PenLine,
  Search,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAppStore, type Toast } from "../../../store";
import {
  dismissAmbiguousMatch,
  markCommunitySuggestionRejected,
  reportNegativeMatch,
  selectAmbiguousCommunitySuggestion,
  selectAmbiguousCustomGame,
  selectAmbiguousMatch,
  type LocalProcessIgnoreOutcome,
  type NegativeReportOutcome,
} from "../../../tracker";
import { Panel, SourceBadge } from "../../components";
import { GameCover } from "../../GameCover";
import { Button, Input } from "../../primitives";
import { CommunitySuggestionForm } from "../DiscoveredView";
import { formatClock } from "../ActiveGameHero";
import { sortMatchCandidates } from "../matchCheckModel";
import { ambiguousMatchCopy, formatAgo } from "./ambiguousMatchCopy";
import { useCommunityGameCorrection } from "./useCommunityGameCorrection";

/* One executable PlayCounter would not match on its own ─────────────────────
   Header asks the question, body offers the database's candidates as cover
   tiles, footer holds every other way out. Same skeleton as the emulator
   picker card so the two "tell me what this is" moments look alike. */

export function AmbiguousMatchCard({
  exeName,
  exePath,
  candidates,
  elapsedSeconds,
  ended,
  flagReason,
}: {
  exeName: string;
  exePath: string | null;
  candidates: Game[];
  elapsedSeconds: number;
  ended: boolean;
  flagReason?: IdentifierFlagReason;
}) {
  const addToast = useAppStore((state) => state.addToast);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [customEntryOpen, setCustomEntryOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [candidatesExpanded, setCandidatesExpanded] = useState(false);
  const correction = useCommunityGameCorrection({
    exeName,
    onKnownGame: (game) => {
      selectAmbiguousMatch(exeName, game);
      closeSuggestion();
      addToast({
        tone: "success",
        title: "Already in IGDB",
        detail: `${game.name} is a known IGDB match for ${exeName} and was applied directly.`,
      });
    },
    onRejected: (id, reviewNote, { selection }) => {
      selectAmbiguousCommunitySuggestion(
        exeName,
        selection.name,
        selection.coverUrl,
        id,
        false,
        selection.igdbId,
      );
      markCommunitySuggestionRejected(exeName, reviewNote);
      closeSuggestion();
      addToast({
        tone: "info",
        title: "Suggestion already reviewed",
        detail: reviewNote ?? "This suggestion was not accepted.",
      });
    },
    onSuggested: (id, verified, { selection }) => {
      selectAmbiguousCommunitySuggestion(
        exeName,
        selection.name,
        selection.coverUrl,
        id,
        verified,
        selection.igdbId,
      );
      closeSuggestion();
      addToast({
        tone: "success",
        title: "Game added and shared",
        detail: `${exeName} is now tracked as a custom game while approval is pending.`,
      });
    },
  });
  const isOffline = correction.isOffline;
  const orderedCandidates = sortMatchCandidates(candidates);
  // The community verified this executable name as non-game software, so the
  // card leads with "not a game" and keeps the database matches folded away.
  const reportedNotAGame = flagReason === "not_a_game";
  const showCandidates =
    candidates.length > 0 && (!reportedNotAGame || candidatesExpanded);
  const copy = ambiguousMatchCopy({
    candidateCount: candidates.length,
    candidateName: candidates[0]?.name,
    flagReason,
  });
  const HeaderIcon = reportedNotAGame ? AlertTriangle : CircleHelp;

  function closeSuggestion() {
    setSuggestionOpen(false);
    correction.reset();
  }

  function submitCustomGame() {
    const name = customName.trim();
    if (!name) return;
    selectAmbiguousCustomGame(exeName, name);
    addToast({
      tone: "success",
      title: "Custom game added",
      detail: `${exeName} will be tracked as ${name}.`,
    });
  }

  async function handleNegativeReport() {
    const outcome = await reportNegativeMatch(exeName);
    notifyNegativeReportOutcome(exeName, outcome, addToast);
  }

  async function handleDismiss() {
    const outcome = await dismissAmbiguousMatch(exeName);
    notifyDismissOutcome(exeName, outcome, addToast);
  }

  return (
    <Panel className="overflow-hidden rounded-xl border-l-[3px] border-l-warning">
      <div className="flex items-start gap-4 p-5">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-warning-border bg-warning-tint text-warning">
          <HeaderIcon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-warning">
            {copy.eyebrow}
          </div>
          <h2 className="mt-1 break-words text-xl font-semibold text-text">
            <Headline template={copy.headline} exeName={exeName} />
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-text-muted">
            {copy.description}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span
              title={exePath ?? exeName}
              className="truncate rounded-md border border-border/60 bg-surface-hover/50 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-text-muted"
            >
              {exeName}
            </span>
            {ended ? (
              <span
                title="This time is not saved yet. Choosing a game assigns it."
                className="rounded-md border border-warning-border bg-warning-tint px-2 py-0.5 font-medium tabular-nums text-warning"
              >
                Closed · {formatClock(elapsedSeconds)} unsaved
              </span>
            ) : (
              <span className="text-text-faint">
                Detected {formatAgo(elapsedSeconds)}
              </span>
            )}
          </div>
        </div>
        {reportedNotAGame && candidates.length > 0 ? (
          <Button
            variant="ghost"
            icon={candidatesExpanded ? ChevronUp : ChevronDown}
            onClick={() => setCandidatesExpanded((open) => !open)}
            className="shrink-0"
          >
            {candidatesExpanded
              ? "Hide possible matches"
              : candidates.length === 1
                ? "Show 1 possible match"
                : `Show ${candidates.length} possible matches`}
          </Button>
        ) : null}
      </div>

      {showCandidates ? (
        <div className="px-5 pb-5">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-faint">
            {candidates.length === 1
              ? "Did you launch this game?"
              : "Did you launch one of these?"}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-3">
            {orderedCandidates.map((game) => (
              <CandidateTile
                key={`${game.source}:${game.id}`}
                exeName={exeName}
                game={game}
                ended={ended}
              />
            ))}
          </div>
        </div>
      ) : null}

      {customEntryOpen || isOffline ? (
        <form
          className="flex items-center gap-2 border-t border-border px-5 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            submitCustomGame();
          }}
        >
          <PenLine size={15} className="shrink-0 text-text-faint" />
          <Input
            value={customName}
            onChange={(event) => setCustomName(event.target.value)}
            maxLength={120}
            autoFocus={customEntryOpen}
            placeholder={
              isOffline
                ? "Offline - track it under a name you type..."
                : "Track it under a name you type..."
            }
            className="h-9 min-w-0 flex-1"
          />
          <Button
            variant="primary"
            type="submit"
            disabled={!customName.trim()}
            className="h-9 shrink-0"
          >
            Add
          </Button>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-bg/40 px-5 py-3">
        <p className="text-xs text-text-faint">
          Your choice is remembered on this PC.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!isOffline ? (
            <Button
              variant="secondary"
              icon={Search}
              title="Search the database and send the match in for review."
              onClick={() => setSuggestionOpen(true)}
            >
              Search database
            </Button>
          ) : null}
          {!isOffline ? (
            <Button
              variant="secondary"
              icon={PenLine}
              title="Track it under a name you type yourself. Stays on this PC only."
              onClick={() => setCustomEntryOpen((open) => !open)}
            >
              Custom name
            </Button>
          ) : null}
          <Button
            variant={reportedNotAGame ? "primary" : "secondary"}
            icon={Ban}
            title={`Stop tracking ${exeName} and report it as a launcher, tool, or other app that is not a game.`}
            onClick={() => void handleNegativeReport()}
          >
            Not a game
          </Button>
          <Button
            variant="ghost"
            icon={EyeOff}
            title="Hide it on this PC without sending a report. You can restore it under Discovered."
            onClick={() => void handleDismiss()}
          >
            Ignore on this PC
          </Button>
        </div>
      </div>

      {suggestionOpen ? (
        <CommunitySuggestionForm
          candidates={correction.candidates}
          exeName={exeName}
          hasMore={correction.hasMore}
          message={correction.message}
          search={correction.search}
          selection={correction.selection}
          state={correction.state}
          isOffline={isOffline}
          onApplyCandidate={correction.applyCandidate}
          onCancel={closeSuggestion}
          onLoadMore={(options) => void correction.loadMore(options)}
          onSearch={(options) => void correction.searchFirstPage(options)}
          onSearchChange={correction.setSearch}
          onSearchOptionsChange={correction.resetResults}
          onSubmit={() => void correction.submit()}
        />
      ) : null}
    </Panel>
  );
}

// "Which game is {exe}?" with the executable set in monospace.
function Headline({
  template,
  exeName,
}: {
  template: string;
  exeName: string;
}): ReactNode {
  const [before, after] = template.split("{exe}");
  return (
    <>
      {before}
      <span className="font-mono">{exeName}</span>
      {after}
    </>
  );
}

function CandidateTile({
  exeName,
  game,
  ended,
}: {
  exeName: string;
  game: Game;
  ended: boolean;
}) {
  const addToast = useAppStore((state) => state.addToast);

  return (
    <button
      type="button"
      aria-label={`Track ${exeName} as ${game.name}`}
      title={ended ? `Save this time as ${game.name}` : `Track as ${game.name}`}
      onClick={() => {
        selectAmbiguousMatch(exeName, game);
        addToast({
          tone: "success",
          title: "Match selected",
          detail: `${exeName} will be tracked as ${game.name}.`,
        });
      }}
      className="group flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface text-left transition hover:-translate-y-0.5 hover:border-accent hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <div className="relative aspect-[3/4] w-full bg-surface-hover">
        {game.coverUrl ? (
          <GameCover
            src={game.coverUrl}
            alt=""
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="grid h-full place-items-center text-text-faint">
            <Gamepad2 size={28} className="opacity-50" />
          </div>
        )}
        <div className="absolute left-2 top-2">
          <SourceBadge source={game.source} variant="mark" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <span
          className="line-clamp-2 text-sm font-medium leading-tight text-text"
          title={game.name}
        >
          {game.name}
        </span>
        <span className="mt-auto text-xs text-text-faint">
          {game.releaseYear ?? ""}
        </span>
      </div>
    </button>
  );
}

export function notifyNegativeReportOutcome(
  exeName: string,
  outcome: NegativeReportOutcome,
  addToast: (toast: Omit<Toast, "id">) => void,
) {
  if (!outcome.localBlockApplied) {
    addToast({
      tone: "error",
      title: `Could not ignore ${exeName}`,
      detail: "PlayCounter could not ignore it on this PC. Try again.",
    });
    return;
  }
  if (!outcome.ignoreFileUpdated) {
    addToast({
      tone: "error",
      title: `${exeName} ignored`,
      detail:
        "It comes back when you restart PlayCounter - the ignore file could not be saved.",
    });
    return;
  }
  if (outcome.report === "failed" || outcome.report === "skipped") {
    addToast({
      tone: "info",
      title: "Fixed on this PC",
      detail: "The community report could not be sent.",
    });
    return;
  }
  addToast({
    tone: "success",
    title: "Wrong match reported",
    detail:
      outcome.report === "already_reviewed"
        ? `${exeName} is no longer tracked here. Your earlier report was already reviewed.`
        : `${exeName} is no longer tracked here. Your report is queued for review.`,
  });
}

function notifyDismissOutcome(
  exeName: string,
  outcome: LocalProcessIgnoreOutcome,
  addToast: (toast: Omit<Toast, "id">) => void,
) {
  if (!outcome.localBlockApplied) {
    addToast({
      tone: "error",
      title: `Could not ignore ${exeName}`,
      detail: "PlayCounter could not ignore it on this PC. Try again.",
    });
    return;
  }
  addToast({
    tone: outcome.ignoreFileUpdated ? "success" : "info",
    title: `${exeName} ignored`,
    detail: outcome.ignoreFileUpdated
      ? "Only on this PC. Nothing was reported."
      : "It comes back when you restart PlayCounter - the ignore file could not be saved.",
  });
}
