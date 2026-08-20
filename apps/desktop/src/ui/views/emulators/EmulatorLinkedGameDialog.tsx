import type { Game } from "@playcounter/shared";
import { Gamepad2, Repeat2 } from "lucide-react";
import { useState } from "react";
import type { EmulatorMapping } from "../../../emulators/types";
import { useAppStore } from "../../../store";
import { addCustomEmulatorGame, selectEmulatorGame } from "../../../tracker";
import { SourceBadge } from "../../components";
import { Button, Modal } from "../../primitives";
import { EmulatorGamePicker } from "./EmulatorGamePicker";
import { guestPlatformLabel } from "./emulatorPickerModel";

export function EmulatorLinkedGameDialog({
  mapping,
  onClose,
}: {
  mapping: EmulatorMapping;
  onClose: () => void;
}) {
  const addToast = useAppStore((state) => state.addToast);
  const linkedSessionCount = useAppStore(
    (state) =>
      state.activeSessions.filter(
        (session) => session.emulator?.contentKey === mapping.contentKey,
      ).length +
      state.recentSessions.filter(
        (session) => session.emulator?.contentKey === mapping.contentKey,
      ).length,
  );
  const [busy, setBusy] = useState(false);
  const labelId = `change-emulator-game-${mapping.contentKey.replace(/[^a-z0-9]/gi, "-")}`;
  const platformLabel = guestPlatformLabel(mapping.emulatorId);

  async function apply(game: Game) {
    if (busy) return;
    setBusy(true);
    try {
      await selectEmulatorGame(mapping.contentKey, game);
      addToast({
        tone: "success",
        title: "Linked game changed",
        detail: replacementDetail(
          mapping.display,
          game.name,
          linkedSessionCount,
        ),
      });
      onClose();
    } catch (error) {
      addToast({
        tone: "error",
        title: "Could not change linked game",
        detail: error instanceof Error ? error.message : String(error),
      });
      setBusy(false);
    }
  }

  async function applyCustom(name: string) {
    if (busy) return;
    setBusy(true);
    try {
      await addCustomEmulatorGame(mapping.contentKey, name);
      addToast({
        tone: "success",
        title: "Linked game changed",
        detail: replacementDetail(mapping.display, name, linkedSessionCount),
      });
      onClose();
    } catch (error) {
      addToast({
        tone: "error",
        title: "Could not change linked game",
        detail: error instanceof Error ? error.message : String(error),
      });
      setBusy(false);
    }
  }

  return (
    <Modal
      size="wide"
      labelId={labelId}
      eyebrow={`${mapping.label} library`}
      title="Change linked game"
      subtitle={mapping.display}
      icon={Repeat2}
      onClose={busy ? () => undefined : onClose}
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      }
    >
      <div className="mb-6 flex items-center gap-3 rounded-xl border border-border bg-bg/60 p-3">
        {mapping.coverUrl ? (
          <img
            src={mapping.coverUrl}
            alt=""
            className="h-16 w-12 shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="grid h-16 w-12 shrink-0 place-items-center rounded-md bg-surface-hover text-text-faint">
            <Gamepad2 size={20} />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-text-faint">
            Currently linked
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="truncate font-semibold text-text">
              {mapping.gameName}
            </span>
            <SourceBadge source={mapping.source} />
          </div>
        </div>
      </div>
      <EmulatorGamePicker
        emulatorId={mapping.emulatorId}
        platformLabel={platformLabel}
        contentDisplay={mapping.display}
        initialQuery={mapping.display}
        currentGame={
          mapping.gameId != null && mapping.gameName
            ? {
                id: mapping.gameId,
                source: mapping.source,
                name: mapping.gameName,
              }
            : undefined
        }
        variant="dialog"
        busy={busy}
        onSelect={(game) => void apply(game)}
        onSelectCustom={(name) => void applyCustom(name)}
      />
    </Modal>
  );
}

function replacementDetail(
  display: string,
  gameName: string,
  sessionCount: number,
) {
  const link = `${display} is now tracked as ${gameName}.`;
  if (sessionCount === 0) return link;
  return `${link} ${sessionCount} earlier ${sessionCount === 1 ? "session was" : "sessions were"} moved over too.`;
}
