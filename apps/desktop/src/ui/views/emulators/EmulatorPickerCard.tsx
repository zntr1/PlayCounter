import type { Game } from "@playcounter/shared";
import { AlertTriangle, Gamepad2, Loader2, Radio, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import { creditableSeconds } from "../../../emulators/resolve";
import type { EmulatorObservation } from "../../../emulators/types";
import { useAppStore, useIsOffline } from "../../../store";
import {
  addCustomEmulatorGame,
  dismissEmulatorHostNotice,
  ignoreEmulatorContent,
  selectEmulatorGame,
  shareEmulatorMapping,
} from "../../../tracker";
import { Panel, formatDuration } from "../../components";
import { Button } from "../../primitives";
import { EmulatorGamePicker } from "./EmulatorGamePicker";
import {
  emulatorPickerCopy,
  emulatorPickerPhase,
  canShareEmulatorObservation,
  guestPlatformLabel,
} from "./emulatorPickerModel";

export function EmulatorPickerCard({
  observation,
}: {
  observation: EmulatorObservation;
}) {
  const addToast = useAppStore((state) => state.addToast);
  const [busy, setBusy] = useState(false);
  const installUuid = useAppStore((state) => state.installUuid);
  const offline = useIsOffline();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (observation.kind !== "content" || !observation.runningSince) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [observation]);

  if (observation.kind === "host-notice") {
    return (
      <Panel className="overflow-hidden border-warning-border">
        <div className="flex items-start gap-4 p-5">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-warning-border bg-warning-tint text-warning">
            <AlertTriangle size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-warning">
              No game detected
            </div>
            <h2 className="mt-1 font-semibold text-text">
              {observation.label} is running
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              PlayCounter cannot tell which game is loaded. Start a game in the
              emulator - it shows up here as soon as PlayCounter recognizes it.
            </p>
            <Button
              className="mt-3"
              variant="ghost"
              onClick={() => dismissEmulatorHostNotice(observation.key)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </Panel>
    );
  }

  const platformLabel = guestPlatformLabel(observation.emulatorId);
  const copy = emulatorPickerCopy(observation, platformLabel);
  const pendingSeconds = creditableSeconds(observation, now);
  const phase = emulatorPickerPhase(observation);

  async function applyGame(game: Game, share: boolean) {
    if (busy || observation.kind !== "content") return;
    setBusy(true);
    try {
      await selectEmulatorGame(observation.key, game);
      const shareOutcome = share
        ? await shareEmulatorMapping(observation.key)
        : null;
      const shareDetail =
        shareOutcome?.kind === "shared"
          ? shareOutcome.share.status === "already_curated"
            ? " Already in the Community database."
            : shareOutcome.share.status === "rejected"
              ? " This match was reviewed before. The reason is in Notifications - your own link still works."
              : " Sent for review. You'll get a notification once it's reviewed."
          : shareOutcome
            ? " The link works. You can share it later from the emulator page."
            : "";
      addToast({
        tone: "success",
        title: observation.endedAt
          ? `${game.name} added to History`
          : `Now tracking ${game.name}`,
        detail:
          observation.endedAt && pendingSeconds >= 60
            ? `Saved ${formatDuration(pendingSeconds)} of playtime.`
            : `${observation.display} is now linked on this PC.${shareDetail}`,
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: "Could not link game",
        detail: error instanceof Error ? error.message : String(error),
      });
      setBusy(false);
    }
  }

  async function applyCustom(name: string) {
    if (busy || observation.kind !== "content") return;
    setBusy(true);
    try {
      await addCustomEmulatorGame(observation.key, name);
      addToast({
        tone: "success",
        title: observation.endedAt
          ? `${name} added to History`
          : `Now tracking ${name}`,
        detail:
          observation.endedAt && pendingSeconds >= 60
            ? `Saved ${formatDuration(pendingSeconds)} of playtime.`
            : "This name stays on this PC.",
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: "Could not add custom game",
        detail: error instanceof Error ? error.message : String(error),
      });
      setBusy(false);
    }
  }

  return (
    <Panel
      className={`overflow-hidden ${copy.tone === "warning" ? "border-warning-border" : "border-accent/30"}`}
    >
      <div className="border-b border-border bg-gradient-to-br from-accent/10 via-surface to-surface p-5">
        <div className="flex items-start gap-4">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
            <Gamepad2 size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-accent">
              {copy.eyebrow}
            </div>
            <h2
              className="mt-1 break-words text-xl font-semibold text-text"
              title={copy.headline}
            >
              {copy.headline}
            </h2>
            <p className="mt-1 text-sm text-text-muted">{copy.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {observation.runningSince ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success-border bg-success-tint px-2.5 py-1 text-xs font-medium text-success">
                  <Radio size={13} className="animate-pulse" /> Tracking now
                </span>
              ) : null}
              {pendingSeconds >= 60 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-warning-border bg-warning-tint px-2.5 py-1 text-xs font-medium text-warning">
                  <Timer size={13} /> {formatDuration(pendingSeconds)} waiting
                  to be saved
                </span>
              ) : null}
            </div>
          </div>
          {phase === "resolving" ? (
            <Loader2 size={20} className="shrink-0 animate-spin text-accent" />
          ) : null}
        </div>
      </div>
      <div className="p-5">
        <EmulatorGamePicker
          emulatorId={observation.emulatorId}
          platformLabel={platformLabel}
          contentDisplay={observation.display}
          initialQuery={observation.searchHint ?? observation.display}
          suggested={observation.candidates}
          variant="card"
          busy={busy}
          onSelect={(game) => void applyGame(game, false)}
          onSelectAndShare={
            canShareEmulatorObservation(observation)
              ? (game) => void applyGame(game, true)
              : undefined
          }
          shareDisabled={offline || !installUuid}
          shareDisabledReason={
            offline
              ? "Sharing needs an internet connection."
              : !installUuid
                ? "PlayCounter is still starting up."
                : undefined
          }
          onSelectCustom={(name) => void applyCustom(name)}
        />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border bg-bg/40 px-5 py-3">
        <p className="text-xs text-text-faint">
          Your choice is remembered on this PC.
        </p>
        <Button
          variant="ghost"
          disabled={busy}
          title="PlayCounter stops tracking this game. You can restore it under Ignored games."
          onClick={() => {
            void ignoreEmulatorContent(observation.key).then(() =>
              addToast({
                tone: "info",
                title: `${observation.display} is no longer tracked`,
                detail: "You can restore it under Ignored games.",
              }),
            );
          }}
        >
          Don't track this
        </Button>
      </div>
    </Panel>
  );
}
