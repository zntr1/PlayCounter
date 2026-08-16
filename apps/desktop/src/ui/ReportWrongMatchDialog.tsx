import { createPortal } from "react-dom";
import { Button, useEscapeKey } from "./primitives";

export function ReportWrongMatchDialog({
  exeName,
  onCancel,
  onDifferentGame,
  onNotAGame,
}: {
  exeName: string;
  onCancel: () => void;
  onDifferentGame: () => void;
  onNotAGame: () => void;
}) {
  useEscapeKey(onCancel);
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-raised">
        <h2 className="text-lg font-semibold text-text">
          What is wrong with this match?
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          PlayCounter matched <strong>{exeName}</strong>. Choose what should
          happen next.
        </p>
        <div className="mt-5 grid gap-3">
          <Button
            variant="primary"
            className="h-auto w-full flex-col items-start gap-0.5 px-4 py-3 text-left"
            onClick={onDifferentGame}
          >
            <span>It&apos;s a different game</span>
            <span className="text-xs font-normal opacity-80">
              Find and apply the game this executable belongs to.
            </span>
          </Button>
          <Button
            variant="secondary"
            className="h-auto w-full flex-col items-start gap-0.5 px-4 py-3 text-left"
            onClick={onNotAGame}
          >
            <span>This is not a game</span>
            <span className="text-xs font-normal text-text-muted">
              Ignore it on this PC and send an anonymous report for review.
            </span>
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
