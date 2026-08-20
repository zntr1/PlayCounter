import { Gamepad2, Repeat2, RotateCcw, Unlink } from "lucide-react";
import { useMemo, useState } from "react";
import {
  confirmEmulatorMapping,
  emulatorShareRuntimeContext,
  forgetEmulatorMapping,
  restoreEmulatorContent,
  shareEmulatorMapping,
} from "../../tracker";
import { useAppStore, useIsOffline } from "../../store";
import { emulatorAssetUrls } from "../../emulators/assets";
import type { EmulatorMapping } from "../../emulators/types";
import {
  emulatorShareControl,
  isShareableEmulatorMapping,
} from "../../emulators/share";
import {
  CommunityApprovalBadge,
  Panel,
  SourceBadge,
  formatDuration,
} from "../components";
import { Button, Modal } from "../primitives";
import { EmulatorPickerCard } from "./emulators/EmulatorPickerCard";
import { EmulatorLinkedGameDialog } from "./emulators/EmulatorLinkedGameDialog";
import {
  emulatorDetectionSourceLabel,
  emulatorShareBadgeStatus,
} from "./emulators/emulatorPickerModel";

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
  const addToast = useAppStore((state) => state.addToast);
  const [changing, setChanging] = useState<EmulatorMapping | null>(null);
  const [forgetting, setForgetting] = useState<EmulatorMapping | null>(null);
  const [forgettingBusy, setForgettingBusy] = useState(false);
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
          <div className="grid place-items-center gap-2 p-8 text-center text-sm text-text-muted">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-surface-hover text-text-faint">
              <Gamepad2 size={20} />
            </div>
            <div className="font-medium text-text">
              No recognized {label} games yet
            </div>
            <div>
              Start a game in {label} and pick it once - it is recognized
              automatically afterwards.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {gameMappings.map((mapping) => (
              <LinkedGameRow
                key={mapping.contentKey}
                mapping={mapping}
                onChange={() => setChanging(mapping)}
                onForget={() => {
                  setForgettingBusy(false);
                  setForgetting(mapping);
                }}
              />
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

      {changing ? (
        <EmulatorLinkedGameDialog
          mapping={changing}
          onClose={() => setChanging(null)}
        />
      ) : null}
      {forgetting ? (
        <Modal
          size="sm"
          labelId="detect-emulator-game-again"
          eyebrow={`${forgetting.label} library`}
          title={`Detect ${forgetting.display} again?`}
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
                        title: `${item.display} will be detected again`,
                        detail: "Recorded playtime remains in History.",
                      });
                      setForgetting(null);
                    })
                    .catch((error) => {
                      addToast({
                        tone: "error",
                        title: "Could not remove linked game",
                        detail:
                          error instanceof Error
                            ? error.message
                            : String(error),
                      });
                      setForgettingBusy(false);
                    });
                }}
              >
                Detect again
              </Button>
            </div>
          }
        >
          <p className="text-sm leading-6 text-text-muted">
            This removes the local link. If the emulator is running, PlayCounter
            will detect the content again now; otherwise it happens next time.
            Recorded playtime stays in History.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

function LinkedGameRow({
  mapping,
  onChange,
  onForget,
}: {
  mapping: EmulatorMapping;
  onChange: () => void;
  onForget: () => void;
}) {
  const detectionSource = emulatorDetectionSourceLabel(mapping.detectionSource);
  const addToast = useAppStore((state) => state.addToast);
  const installUuid = useAppStore((state) => state.installUuid);
  const offline = useIsOffline();
  const [sharing, setSharing] = useState(false);
  const share =
    mapping.share?.gameId === mapping.gameId ? mapping.share : undefined;
  const shareBadgeStatus = emulatorShareBadgeStatus(share);
  const shareContext = {
    ...emulatorShareRuntimeContext(),
    installUuid,
    offline,
  };
  const shareable = isShareableEmulatorMapping(mapping, shareContext);
  const shareControl = emulatorShareControl(mapping, shareContext);

  async function submitShare() {
    if (!shareControl.visible || shareControl.disabled || sharing) return;
    setSharing(true);
    const outcome = await shareEmulatorMapping(mapping.contentKey);
    setSharing(false);
    if (outcome.kind === "shared") {
      if (outcome.share.status === "rejected") return;
      addToast({
        tone: "success",
        title:
          outcome.share.status === "already_curated"
            ? "Already in the shared database"
            : "Match submitted for review",
        detail:
          outcome.share.status === "pending"
            ? "You'll get a notification when it's reviewed."
            : "Your local emulator link remains unchanged.",
      });
    } else {
      addToast({
        tone: "error",
        title: "Could not share match",
        detail:
          outcome.kind === "failed"
            ? outcome.error
            : "Your local emulator link remains unchanged.",
      });
    }
  }

  return (
    <div className="grid gap-4 px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
      {mapping.coverUrl ? (
        <img
          src={mapping.coverUrl}
          alt=""
          className="hidden h-14 w-10 rounded object-cover sm:block"
        />
      ) : (
        <div className="hidden h-14 w-10 place-items-center rounded bg-surface-hover text-text-faint sm:grid">
          <Gamepad2 size={18} />
        </div>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate font-medium text-text">
            {mapping.gameName}
          </div>
          <SourceBadge source={mapping.source} />
          {mapping.needsConfirmation ? (
            <span className="rounded border border-warning-border bg-warning-tint px-1.5 py-0.5 text-[11px] font-medium text-warning">
              Check this once
            </span>
          ) : null}
          <span className="rounded border border-border bg-surface-hover px-1.5 py-0.5 text-[11px] text-text-muted">
            {mapping.confidence === "user" ? "Chosen by you" : "Auto-matched"}
          </span>
          {shareBadgeStatus ? (
            <CommunityApprovalBadge
              suggestionId={mapping.gameId}
              status={shareBadgeStatus}
            />
          ) : null}
          {!shareable ? (
            <span className="rounded border border-border bg-surface-hover px-1.5 py-0.5 text-[11px] text-text-faint">
              Stays on this PC
            </span>
          ) : null}
        </div>
        <div
          className="mt-1 truncate text-sm text-text-muted"
          title={mapping.display}
        >
          {detectionSource
            ? `Recognized by ${detectionSource}: `
            : "Recognized from "}
          <span className="font-mono text-text">{mapping.display}</span>
        </div>
        <div className="mt-1 text-xs text-text-faint">
          Linked {new Date(mapping.decidedAt).toLocaleDateString()} · Last seen{" "}
          {new Date(mapping.lastSeenAt).toLocaleDateString()}
        </div>
        {mapping.needsConfirmation ? (
          <p className="mt-2 text-xs text-text-faint">
            Tracking is already active. Confirming only hides future review
            warnings.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 sm:col-start-2 lg:col-start-auto">
        {shareControl.visible ? (
          <Button
            variant="secondary"
            disabled={shareControl.disabled || sharing}
            title={shareControl.reason}
            onClick={() => void submitShare()}
          >
            {sharing ? "Sharing…" : shareControl.label}
          </Button>
        ) : null}
        {mapping.needsConfirmation ? (
          <Button
            variant="primary"
            onClick={() => confirmEmulatorMapping(mapping.contentKey)}
          >
            Looks right
          </Button>
        ) : null}
        <Button variant="secondary" icon={Repeat2} onClick={onChange}>
          Change game
        </Button>
        <Button variant="ghost" icon={RotateCcw} onClick={onForget}>
          Detect again
        </Button>
      </div>
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
