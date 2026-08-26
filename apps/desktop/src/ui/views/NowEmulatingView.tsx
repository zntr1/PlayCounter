import { Cpu } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createGameIdentityResolver,
  useAppStore,
  type ExeCacheEntry,
} from "../../store";
import { Panel } from "../components";
import {
  emulatorTourDemoActive,
  tourDemoEmulatorSession,
} from "../tour/tourDemoGame";
import { ActiveGameHero } from "./ActiveGameHero";
import { EmulatorPickerCard } from "./emulators/EmulatorPickerCard";
import {
  providerFloorRecord,
  providerFloors as collectProviderFloors,
} from "../../library/playtimeFloor";
import { resolvedCanonicalGameKey } from "../../store";

const EMPTY_EXE_CACHE: ReadonlyMap<string, ExeCacheEntry> = new Map();
const EMPTY_SECONDS: Record<string, number> = {};

export function NowEmulatingView() {
  const ignoredEmulatorIds = useAppStore(
    (state) => state.settings.ignoredEmulatorIds ?? [],
  );
  const ignored = useMemo(
    () => new Set(ignoredEmulatorIds.map((id) => id.toLowerCase())),
    [ignoredEmulatorIds],
  );
  const allSessions = useAppStore((state) => state.activeSessions);
  const recentSessions = useAppStore((state) => state.recentSessions);
  const archivedGameSeconds = useAppStore((state) => state.archivedGameSeconds);
  const playtimeAdjustments = useAppStore((state) => state.playtimeAdjustments);
  const exeCache = useAppStore((state) => state.exeCache);
  const gameMetadata = useAppStore((state) => state.gameMetadata);
  const libraryImports = useAppStore((state) => state.libraryImports);
  const resolveIgdbId = useMemo(
    () => createGameIdentityResolver(gameMetadata, exeCache, libraryImports),
    [exeCache, gameMetadata, libraryImports],
  );
  const providerFloorSeconds = useMemo(
    () => providerFloorRecord(collectProviderFloors(libraryImports.values())),
    [libraryImports],
  );
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const activeTourId = useAppStore((state) => state.activeTour?.tourId ?? null);
  const demo = emulatorTourDemoActive(activeTourId);
  const sessions = useMemo(
    () =>
      allSessions.filter(
        (session) =>
          session.emulator &&
          !ignored.has(session.emulator.emulatorId.toLowerCase()),
      ),
    [allSessions, ignored],
  );
  const processes = useAppStore((state) => state.processes);
  const allObservations = useAppStore((state) => state.emulatorObservations);
  const observations = useMemo(
    () =>
      allObservations.filter(
        (observation) =>
          !observation.endedAt &&
          !ignored.has(observation.emulatorId.toLowerCase()) &&
          (observation.kind === "content" || !observation.dismissedAt),
      ),
    [allObservations, ignored],
  );
  const [now, setNow] = useState(() => Date.now());
  const [demoStartedAt, setDemoStartedAt] = useState(() =>
    new Date(Date.now() - 1_421_000).toISOString(),
  );
  const runningHosts = processes.filter(
    (process) =>
      process.emulatorId && !ignored.has(process.emulatorId.toLowerCase()),
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (demo) {
      setDemoStartedAt(new Date(Date.now() - 1_421_000).toISOString());
    }
  }, [demo]);

  if (demo) {
    return (
      <ActiveGameHero
        session={tourDemoEmulatorSession(demoStartedAt)}
        elapsedSeconds={Math.max(
          0,
          Math.floor((now - Date.parse(demoStartedAt)) / 1000),
        )}
        recentSessions={[]}
        showDurationDays={showDurationDays}
        exeCache={EMPTY_EXE_CACHE}
        resolveIgdbId={resolveIgdbId}
        archivedGameSeconds={EMPTY_SECONDS}
        playtimeAdjustments={EMPTY_SECONDS}
        providerFloorSeconds={0}
        statusLabel="Now emulating"
        tourAnchor="demo-emulator-now"
      />
    );
  }

  if (
    sessions.length === 0 &&
    observations.length === 0 &&
    runningHosts.length === 0
  ) {
    return (
      <Panel className="grid min-h-[360px] place-items-center p-8 text-center">
        <div>
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full border border-border bg-surface-hover text-text-faint">
            <Cpu size={28} />
          </div>
          <h2 className="text-2xl font-semibold text-text">
            No emulator is running
          </h2>
          <p className="mt-2 text-text-muted">
            When you start a game in a supported emulator, it shows up here.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <div className="grid gap-4">
      {observations.map((observation) => (
        <EmulatorPickerCard key={observation.key} observation={observation} />
      ))}
      {sessions.map((session) => (
        <ActiveGameHero
          key={session.id}
          session={session}
          elapsedSeconds={Math.max(
            0,
            Math.floor((now - Date.parse(session.startedAt)) / 1000),
          )}
          recentSessions={recentSessions}
          showDurationDays={showDurationDays}
          exeCache={exeCache}
          resolveIgdbId={resolveIgdbId}
          archivedGameSeconds={archivedGameSeconds}
          playtimeAdjustments={playtimeAdjustments}
          providerFloorSeconds={
            providerFloorSeconds[
              resolvedCanonicalGameKey(session, resolveIgdbId)
            ] ?? 0
          }
          statusLabel="Now emulating"
        />
      ))}
      {sessions.length === 0 && observations.length === 0 ? (
        <Panel className="p-5">
          <h2 className="font-semibold text-text">Emulator running</h2>
          <p className="mt-1 text-sm text-text-muted">
            {runningHosts[0]?.exeName} is running. PlayCounter is watching for a
            game to load.
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
