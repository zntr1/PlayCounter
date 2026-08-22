import { Flag } from "lucide-react";
import { Button, Modal } from "./primitives";

export function ReportWrongMatchDialog({
  exeName,
  gameName,
  onCancel,
  onDifferentGame,
  onNotAGame,
}: {
  exeName: string;
  gameName: string;
  onCancel: () => void;
  onDifferentGame: () => void;
  onNotAGame: () => void;
}) {
  const label = exeName || "this app";
  return (
    <Modal
      size="md"
      labelId="wrong-match-dialog-title"
      eyebrow="Wrong match"
      title="What is this file?"
      subtitle={label}
      icon={Flag}
      onClose={onCancel}
      footer={
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-6 text-text-muted">
        {gameName ? (
          <>
            PlayCounter is tracking <span className="font-mono">{label}</span>{" "}
            as <strong className="text-text">{gameName}</strong> — what&apos;s
            wrong?
          </>
        ) : (
          <>
            PlayCounter matched <span className="font-mono">{label}</span> to a
            game — is that wrong?
          </>
        )}
      </p>
      <div className="mt-5 grid gap-3">
        <Button
          variant="primary"
          className="h-auto w-full flex-col items-start gap-0.5 px-4 py-3 text-left"
          onClick={onDifferentGame}
        >
          <span>It belongs to a different game</span>
          <span className="text-xs font-normal opacity-80">
            Pick the right game and apply it to {label}.
          </span>
        </Button>
        <Button
          variant="secondary"
          className="h-auto w-full flex-col items-start gap-0.5 px-4 py-3 text-left"
          onClick={onNotAGame}
        >
          <span>It isn&apos;t a game at all</span>
          <span className="text-xs font-normal text-text-muted">
            A tool, launcher, or background app. PlayCounter stops tracking it,
            ignores {label} on this PC, and reports it anonymously.
          </span>
        </Button>
      </div>
    </Modal>
  );
}
