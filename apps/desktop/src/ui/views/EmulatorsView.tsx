import { EyeOff, Gamepad2, RotateCcw, Unlink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { TourSampleSearch } from "../tour/TourSampleSearch";
import { emitTourEvent } from "../tour/TourUI";
import {
  forgetEmulatorMapping,
  restoreEmulatorContent,
  scanProcessesNow,
  startEmulatorGame,
} from "../../tracker";
import { useAppStore } from "../../store";
import { adapterFor } from "../../emulators/registry";
import type { EmulatorMapping } from "../../emulators/types";
import { emulatorLaunchErrorMessage } from "../../emulatorLaunch";
import { currentPlatform } from "../../platform";
import { Button, Modal } from "../primitives";
import {
  emulatorTourDemoActive,
  TOUR_DEMO_EMULATOR,
  TOUR_DEMO_EMULATOR_STATS,
  tourDemoEmulatorMapping,
} from "../tour/tourDemoGame";
import { EmulatorPickerCard } from "./emulators/EmulatorPickerCard";
import { EmulatorLinkedGameDialog } from "./emulators/EmulatorLinkedGameDialog";
import {
  EmulatorHero,
  type EmulatorStartControl,
  type EmulatorTopGame,
} from "./emulators/EmulatorHero";
import {
  DEMO_ACTION_REASON,
  LinkedGameCard,
  type LinkedGameStats,
} from "./emulators/LinkedGameCard";

type EmulatorViewProps = {
  emulatorId: string;
  label: string;
  fallbackHostName: string;
};

export function DosboxView() {
  return (
    <EmulatorView
      emulatorId="dosbox"
      label="DOSBox"
      fallbackHostName="DOSBox"
    />
  );
}

export function DolphinView() {
  return (
    <EmulatorView
      emulatorId="dolphin"
      label="Dolphin"
      fallbackHostName="dolphin.exe"
    />
  );
}

export function Pcsx2View() {
  return (
    <EmulatorView
      emulatorId="pcsx2"
      label="PCSX2"
      fallbackHostName="pcsx2-qt.exe"
    />
  );
}

type GameStats = LinkedGameStats & {
  lastPlayedMs: number;
  name: string;
  coverUrl?: string;
  gameId: number;
  igdbId?: number;
  source?: EmulatorMapping["source"];
};

const DEMO_STATS: LinkedGameStats = {
  seconds: TOUR_DEMO_EMULATOR_STATS.playtimeSeconds,
  sessions: TOUR_DEMO_EMULATOR_STATS.sessions,
};

/* Sessions and mappings meet on the game they resolved to, so a game that
   was linked from two files still counts once. */
function gameStatKey(source: string | null | undefined, gameId: number) {
  return `${source ?? "custom"}:${gameId}`;
}

function EmulatorView({
  emulatorId,
  label,
  fallbackHostName,
}: EmulatorViewProps) {
  const allMappings = useAppStore((state) => state.emulatorMappings);
  const mappings = useMemo(
    () =>
      [...allMappings.values()].filter(
        (mapping) => mapping.emulatorId === emulatorId,
      ),
    [allMappings, emulatorId],
  );
  const allObservations = useAppStore((state) => state.emulatorObservations);
  const observations = useMemo(
    () =>
      allObservations.filter(
        (observation) =>
          observation.emulatorId === emulatorId &&
          (observation.kind === "content" ||
            (!observation.endedAt && !observation.dismissedAt)),
      ),
    [allObservations, emulatorId],
  );
  const allSessions = useAppStore((state) => state.recentSessions);
  const sessions = useMemo(
    () =>
      allSessions.filter(
        (session) => session.emulator?.emulatorId === emulatorId,
      ),
    [allSessions, emulatorId],
  );
  const allActiveSessions = useAppStore((state) => state.activeSessions);
  const activeSessions = useMemo(
    () =>
      allActiveSessions.filter(
        (session) => session.emulator?.emulatorId === emulatorId,
      ),
    [allActiveSessions, emulatorId],
  );
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const known = useAppStore((state) => state.knownEmulators.get(emulatorId));
  const activeTourId = useAppStore((state) => state.activeTour?.tourId ?? null);
  const gameLaunchingEnabled = useAppStore(
    (state) => state.settings.gameLaunchingEnabled === true,
  );
  const demo = emulatorTourDemoActive(activeTourId, emulatorId);
  const addToast = useAppStore((state) => state.addToast);
  const [starting, setStarting] = useState(false);
  const [changing, setChanging] = useState<EmulatorMapping | null>(null);
  const [forgetting, setForgetting] = useState<EmulatorMapping | null>(null);
  const [forgettingBusy, setForgettingBusy] = useState(false);
  const gameMappings = mappings.filter(
    (mapping) => mapping.decision === "game",
  );
  const ignoredMappings = mappings.filter(
    (mapping) => mapping.decision === "ignored",
  );
  const gameStats = useMemo(() => {
    const stats = new Map<string, GameStats>();
    for (const session of sessions) {
      const key = gameStatKey(session.source, session.gameId);
      const startedMs = Date.parse(session.startedAt);
      const entry = stats.get(key) ?? {
        seconds: 0,
        sessions: 0,
        lastPlayedMs: 0,
        name: session.gameName ?? session.exeName,
        coverUrl: session.coverUrl,
        gameId: session.gameId,
        igdbId: session.igdbId,
        source: session.source,
      };
      entry.seconds += session.durationSeconds ?? 0;
      entry.sessions += 1;
      if (startedMs > entry.lastPlayedMs) {
        entry.lastPlayedMs = startedMs;
        entry.name = session.gameName ?? entry.name;
        entry.coverUrl = session.coverUrl ?? entry.coverUrl;
      }
      stats.set(key, entry);
    }
    return stats;
  }, [sessions]);
  const [demoMapping, setDemoMapping] = useState(tourDemoEmulatorMapping);
  const [demoAction, setDemoAction] = useState<
    "change" | "forget" | "share" | null
  >(null);
  const [demoForgotten, setDemoForgotten] = useState(false);
  useEffect(() => {
    setDemoMapping(tourDemoEmulatorMapping());
    setDemoForgotten(false);
    setDemoAction(null);
  }, [activeTourId]);
  const displayedObservations = demo ? [] : observations;
  const displayedGameMappings = demo
    ? demoForgotten
      ? []
      : [demoMapping]
    : gameMappings;
  const displayedIgnoredMappings = demo ? [] : ignoredMappings;
  const displayedIgnoredCount = demo
    ? TOUR_DEMO_EMULATOR_STATS.ignored
    : ignoredMappings.length;
  const displayedSessionCount = demo
    ? TOUR_DEMO_EMULATOR_STATS.sessions
    : sessions.length;
  const displayedGameCount = demo
    ? TOUR_DEMO_EMULATOR_STATS.games
    : gameStats.size;
  const displayedPlaytimeSeconds = demo
    ? TOUR_DEMO_EMULATOR_STATS.playtimeSeconds
    : sessions.reduce(
        (sum, session) => sum + (session.durationSeconds ?? 0),
        0,
      );
  const lastPlayedMs = useMemo(() => {
    if (demo) return Date.now() - 60 * 60 * 1_000;
    let latest = 0;
    for (const entry of gameStats.values())
      if (entry.lastPlayedMs > latest) latest = entry.lastPlayedMs;
    return latest > 0 ? latest : null;
  }, [demo, gameStats]);
  const topGames = useMemo<EmulatorTopGame[]>(() => {
    if (demo) {
      return [
        {
          key: gameStatKey(demoMapping.source, TOUR_DEMO_EMULATOR.gameId),
          gameId: TOUR_DEMO_EMULATOR.gameId,
          source: demoMapping.source,
          name: TOUR_DEMO_EMULATOR.gameName,
          coverUrl: TOUR_DEMO_EMULATOR.coverUrl,
          ...DEMO_STATS,
        },
      ];
    }
    return [...gameStats.entries()]
      .filter(([, entry]) => entry.seconds > 0)
      .sort((a, b) => b[1].seconds - a[1].seconds)
      .slice(0, 3)
      .map(([key, entry]) => ({
        key,
        gameId: entry.gameId,
        igdbId: entry.igdbId,
        source: entry.source,
        name: entry.name,
        coverUrl: entry.coverUrl,
        seconds: entry.seconds,
        sessions: entry.sessions,
      }));
  }, [demo, demoMapping.source, gameStats]);
  const platform = currentPlatform();
  const launchable = adapterFor(emulatorId)?.launch !== undefined;
  const canStartGame = platform === "windows";
  const startDisabledReason =
    platform !== "windows"
      ? "Direct launching is only available on Windows."
      : undefined;
  const start: EmulatorStartControl = {
    visible: launchable && gameLaunchingEnabled,
    disabled: demo || !canStartGame,
    loading: starting,
    reason: demo ? DEMO_ACTION_REASON : startDisabledReason,
    onClick: demo ? undefined : () => void handleStartGame(),
  };

  async function handleStartGame() {
    if (starting) return;
    setStarting(true);
    try {
      const outcome = await startEmulatorGame(emulatorId);
      if (!outcome) return;
      if (outcome.kind === "busy") {
        addToast({
          tone: "info",
          title: `${label} is starting`,
          detail: "PlayCounter already sent the launch request.",
        });
        return;
      }
      if (outcome.kind === "hostRunning") {
        addToast({
          tone: "info",
          title: `${label} is still busy`,
          detail: `Stop the current emulated game first. PlayCounter only replaces ${label} automatically when it is safely idle.`,
        });
        return;
      }
      addToast({
        tone: "success",
        title: `${label} is starting`,
        detail: "PlayCounter will recognize the game once it loads.",
      });
      void scanProcessesNow().catch((error) =>
        console.warn("post-launch process scan failed", error),
      );
    } catch (error) {
      addToast({ tone: "error", ...emulatorLaunchErrorMessage(error, label) });
    } finally {
      setStarting(false);
    }
  }

  function statsFor(mapping: EmulatorMapping): LinkedGameStats | null {
    if (demo) return DEMO_STATS;
    if (mapping.gameId === undefined) return null;
    return gameStats.get(gameStatKey(mapping.source, mapping.gameId)) ?? null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <EmulatorHero
        emulatorId={emulatorId}
        label={label}
        hostNames={
          demo
            ? [TOUR_DEMO_EMULATOR.hostExeName]
            : known?.hostExeNames.length
              ? known.hostExeNames
              : [fallbackHostName]
        }
        playtimeSeconds={displayedPlaytimeSeconds}
        sessionCount={displayedSessionCount}
        gameCount={displayedGameCount}
        ignoredCount={displayedIgnoredCount}
        runningCount={demo ? 1 : activeSessions.length}
        lastPlayedMs={lastPlayedMs}
        showDurationDays={showDurationDays}
        topGames={topGames}
        start={start}
      />

      {displayedObservations.map((observation) => (
        <EmulatorPickerCard key={observation.key} observation={observation} />
      ))}

      <section aria-labelledby={`${emulatorId}-linked-games`}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <div className="min-w-0">
            <h2
              id={`${emulatorId}-linked-games`}
              className="flex items-center gap-2 text-lg font-bold tracking-tight text-text"
            >
              Linked games
              <span className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[11px] font-semibold text-text-muted">
                {displayedGameMappings.length}
              </span>
            </h2>
            <p className="mt-0.5 text-sm text-text-muted">
              {label} games PlayCounter remembers and recognizes automatically.
            </p>
          </div>
        </div>

        {displayedGameMappings.length === 0 ? (
          <div className="mt-4 grid place-items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-muted">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-surface-hover text-text-faint">
              <Gamepad2 size={20} />
            </div>
            <div className="font-medium text-text">
              No recognized {label} games yet
            </div>
            <div className="max-w-md">
              {gameLaunchingEnabled
                ? "Use Start game and pick a file once. PlayCounter recognizes it automatically from then on."
                : `Start a game in ${label} and pick it once. PlayCounter recognizes it automatically from then on.`}
            </div>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-[repeat(auto-fill,200px)] gap-4">
            {displayedGameMappings.map((mapping) => (
              <LinkedGameCard
                key={mapping.contentKey}
                mapping={mapping}
                stats={statsFor(mapping)}
                showDurationDays={showDurationDays}
                demo={demo}
                onDemoConfirm={
                  demo
                    ? () => {
                        setDemoMapping((current) => ({
                          ...current,
                          needsConfirmation: false,
                        }));
                        emitTourEvent(
                          "demo.action-completed",
                          "Sample confirmed. The check badge is gone; its recorded sessions stay intact.",
                        );
                      }
                    : undefined
                }
                onDemoShare={demo ? () => setDemoAction("share") : undefined}
                onChange={
                  demo
                    ? () => setDemoAction("change")
                    : () => setChanging(mapping)
                }
                onForget={
                  demo
                    ? () => setDemoAction("forget")
                    : () => {
                        setForgettingBusy(false);
                        setForgetting(mapping);
                      }
                }
              />
            ))}
          </div>
        )}
      </section>

      {demo && demoForgotten ? (
        <div
          data-tour="demo-emulator-result"
          className="rounded-xl border border-border bg-surface p-4"
        >
          <p role="status" className="mb-3 text-sm">
            Sample match forgotten. The five sample sessions remain in History.
          </p>
          <Button
            onClick={() => {
              setDemoForgotten(false);
              setDemoMapping(tourDemoEmulatorMapping());
            }}
          >
            Restore sample match
          </Button>
        </div>
      ) : null}
      {demo && demoAction === "change" ? (
        <TourSampleSearch
          exeName={TOUR_DEMO_EMULATOR.display}
          onClose={() => setDemoAction(null)}
          onConfirm={(choice) => {
            setDemoMapping((current) => ({
              ...current,
              gameId: choice.igdbId,
              gameName: choice.name,
              coverUrl: choice.coverUrl,
              needsConfirmation: false,
            }));
            setDemoAction(null);
            emitTourEvent(
              "demo.action-completed",
              `Sample match changed to ${choice.name}. Nothing was shared.`,
            );
          }}
        />
      ) : null}
      {demo && (demoAction === "forget" || demoAction === "share") ? (
        <Modal
          dataTour="demo-emulator-confirmation"
          backdropDataTour="demo-library-modal"
          labelId="demo-emulator-action-title"
          title={
            demoAction === "forget"
              ? "Forget this sample match?"
              : "Preview sharing a match"
          }
          onClose={() => setDemoAction(null)}
          footer={
            <div className="flex justify-end gap-2">
              <Button onClick={() => setDemoAction(null)}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (demoAction === "forget") setDemoForgotten(true);
                  emitTourEvent(
                    "demo.action-completed",
                    demoAction === "forget"
                      ? "Sample match forgotten. Recorded history remains."
                      : "Sharing preview finished. No match was submitted.",
                  );
                  setDemoAction(null);
                }}
              >
                {demoAction === "forget" ? "Forget sample" : "Finish preview"}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-text-muted">
            {demoAction === "forget"
              ? "This removes the sample file-to-game link. Recorded sessions are kept. In the app, you choose the game again when this content next appears."
              : "Share match sends a recognized file or disc ID and the chosen game for Community review. Full local paths stay on your PC. This preview sends nothing."}
          </p>
        </Modal>
      ) : null}

      {displayedIgnoredMappings.length > 0 ? (
        <section
          aria-labelledby={`${emulatorId}-ignored-games`}
          className="rounded-xl border border-border bg-surface/60"
        >
          <div className="flex items-start gap-3 border-b border-border px-4 py-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-hover text-text-faint">
              <EyeOff size={15} />
            </div>
            <div className="min-w-0">
              <h2
                id={`${emulatorId}-ignored-games`}
                className="text-sm font-semibold text-text"
              >
                Ignored {label} games
                <span className="ml-2 font-mono text-[11px] font-semibold text-text-faint">
                  {displayedIgnoredMappings.length}
                </span>
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                Restore a game to let PlayCounter detect it again.
              </p>
            </div>
          </div>
          <ul className="divide-y divide-border">
            {displayedIgnoredMappings.map((mapping) => (
              <li
                key={mapping.contentKey}
                className="flex items-center justify-between gap-4 px-4 py-2.5"
              >
                <span
                  className="truncate font-mono text-xs text-text-muted"
                  title={mapping.display}
                >
                  {mapping.display}
                </span>
                <Button
                  variant="ghost"
                  icon={RotateCcw}
                  className="px-2 py-1 text-xs"
                  onClick={() => restoreEmulatorContent(mapping.contentKey)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!demo && changing ? (
        <EmulatorLinkedGameDialog
          mapping={changing}
          onClose={() => setChanging(null)}
        />
      ) : null}
      {!demo && forgetting ? (
        <Modal
          size="sm"
          labelId="detect-emulator-game-again"
          eyebrow={`${forgetting.label} library`}
          title={`Forget which game ${forgetting.display} is?`}
          icon={Unlink}
          onClose={forgettingBusy ? () => undefined : () => setForgetting(null)}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                data-autofocus
                variant="ghost"
                disabled={forgettingBusy}
                onClick={() => setForgetting(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                icon={RotateCcw}
                loading={forgettingBusy}
                onClick={() => {
                  const item = forgetting;
                  setForgettingBusy(true);
                  void forgetEmulatorMapping(item.contentKey)
                    .then(() => {
                      addToast({
                        tone: "info",
                        title: `PlayCounter will ask about ${item.display} again`,
                        detail: "Recorded playtime stays in History.",
                      });
                      setForgetting(null);
                    })
                    .catch((error) => {
                      addToast({
                        tone: "error",
                        title: "Could not forget this game",
                        detail:
                          error instanceof Error
                            ? error.message
                            : String(error),
                      });
                      setForgettingBusy(false);
                    });
                }}
              >
                Forget game
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-6 text-text-muted">
            PlayCounter asks you again the next time it shows up - right away if
            the emulator is running. Recorded playtime stays in History.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
