import { Cpu, Gamepad2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import { Panel, SourceBadge } from "../components";
import { EmulatorPickerCard } from "./emulators/EmulatorPickerCard";

export function NowEmulatingView() {
  const ignoredEmulatorIds = useAppStore(
    (state) => state.settings.ignoredEmulatorIds ?? [],
  );
  const ignored = useMemo(
    () => new Set(ignoredEmulatorIds.map((id) => id.toLowerCase())),
    [ignoredEmulatorIds],
  );
  const allSessions = useAppStore((state) => state.activeSessions);
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
  const runningHosts = processes.filter(
    (process) =>
      process.emulatorId && !ignored.has(process.emulatorId.toLowerCase()),
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

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
            Supported emulator activity will appear here automatically.
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
        <section
          key={session.id}
          className="relative overflow-hidden rounded-xl border border-border bg-surface p-6 shadow-raised"
        >
          <div className="flex items-center gap-5">
            {session.coverUrl ? (
              <img
                src={session.coverUrl}
                alt=""
                className="h-32 w-24 rounded-lg object-cover shadow-raised"
              />
            ) : (
              <div className="grid h-32 w-24 place-items-center rounded-lg bg-surface-hover text-text-faint">
                <Gamepad2 size={28} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-success-border bg-success-tint px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-success">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                Now emulating
              </div>
              <h2 className="mt-3 truncate text-3xl font-bold text-text">
                {session.gameName}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {session.source ? (
                  <SourceBadge source={session.source} />
                ) : null}
                <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                  {session.emulator?.label} · {session.emulator?.display}
                </span>
              </div>
              <div className="mt-5 font-mono text-3xl font-semibold tabular-nums text-accent">
                {formatClock(
                  Math.max(
                    0,
                    Math.floor((now - Date.parse(session.startedAt)) / 1000),
                  ),
                )}
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide text-text-faint">
                Current session
              </div>
            </div>
          </div>
        </section>
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

function formatClock(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
