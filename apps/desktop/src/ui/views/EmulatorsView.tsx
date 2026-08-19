import { Gamepad2 } from "lucide-react";
import { useMemo } from "react";
import {
  changeEmulatorMapping,
  confirmEmulatorMapping,
  forgetEmulatorMapping,
  restoreEmulatorContent,
} from "../../tracker";
import { useAppStore } from "../../store";
import { emulatorAssetUrls } from "../../emulators/assets";
import { Panel, formatDuration } from "../components";
import { Button } from "../primitives";
import { EmulatorPickerCard } from "./emulators/EmulatorPickerCard";

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
  const gameMappings = mappings.filter(
    (mapping) => mapping.decision === "game",
  );
  const ignoredMappings = mappings.filter(
    (mapping) => mapping.decision === "ignored",
  );
  const ignoredCount = ignoredMappings.length;
  const games = useMemo(
    () =>
      new Set(sessions.map((session) => `${session.source}:${session.gameId}`)),
    [sessions],
  );

  return (
    <div className="grid gap-5">
      <Panel className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              {emulatorAssetUrls[emulatorId] ? (
                <img
                  src={emulatorAssetUrls[emulatorId]}
                  alt={`${label} logo`}
                  className="h-12 w-12 rounded-lg object-cover shadow-sm"
                />
              ) : null}
              <h2 className="text-xl font-semibold text-text">{label}</h2>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              Detected files:{" "}
              {known?.hostExeNames.join(", ") || fallbackHostName}
            </p>
          </div>
          <div className="text-sm text-text-muted">
            {activeSessions.length > 0
              ? `${activeSessions.length} game${activeSessions.length === 1 ? "" : "s"} active`
              : "Not currently emulating"}
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <SmallMetric
            label="Playtime"
            value={formatDuration(
              sessions.reduce(
                (sum, session) => sum + (session.durationSeconds ?? 0),
                0,
              ),
              showDurationDays,
            )}
          />
          <SmallMetric label="Sessions" value={String(sessions.length)} />
          <SmallMetric label="Games" value={String(games.size)} />
          <SmallMetric label="Ignored content" value={String(ignoredCount)} />
        </div>
      </Panel>

      {observations.map((observation) => (
        <EmulatorPickerCard key={observation.key} observation={observation} />
      ))}

      <Panel className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold text-text">Your linked games</h2>
          <p className="mt-1 text-sm text-text-muted">
            {label} games PlayCounter remembers and recognizes automatically.
          </p>
        </div>
        {gameMappings.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-muted">
            No recognized {label} games yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {gameMappings.map((mapping) => (
              <div
                key={mapping.contentKey}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Gamepad2 size={16} className="text-text-faint" />
                    <div className="truncate font-medium text-text">
                      {mapping.gameName}
                    </div>
                  </div>
                  <div className="mt-1 truncate text-sm text-text-muted">
                    Recognized from{" "}
                    <span className="font-mono text-text">
                      {mapping.display}
                    </span>
                    {mapping.needsConfirmation
                      ? " · please check this once"
                      : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  {mapping.needsConfirmation ? (
                    <Button
                      variant="primary"
                      onClick={() => confirmEmulatorMapping(mapping.contentKey)}
                    >
                      Looks right
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void changeEmulatorMapping(mapping.contentKey)
                    }
                  >
                    Choose different game
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void forgetEmulatorMapping(mapping.contentKey)
                    }
                  >
                    Detect again
                  </Button>
                </div>
                {mapping.needsConfirmation ? (
                  <p className="w-full text-xs text-text-faint">
                    Tracking is already active. “Looks right” only confirms this
                    local mapping and hides future review warnings.
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Panel>

      {ignoredMappings.length > 0 ? (
        <Panel className="overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-semibold text-text">Ignored {label} content</h2>
            <p className="mt-1 text-sm text-text-muted">
              Restore an item to let PlayCounter detect it again.
            </p>
          </div>
          <div className="divide-y divide-border">
            {ignoredMappings.map((mapping) => (
              <div
                key={mapping.contentKey}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <div className="truncate text-sm text-text-muted">
                  {mapping.display}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => restoreEmulatorContent(mapping.contentKey)}
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg/60 p-3">
      <div className="text-xs text-text-faint">{label}</div>
      <div className="mt-1 truncate font-mono font-semibold text-text">
        {value}
      </div>
    </div>
  );
}
