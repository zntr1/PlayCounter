import { createPortal } from "react-dom";
import { Button, useEscapeKey } from "./primitives";

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
  useEscapeKey(onCancel);
  const label = exeName || "this app";
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 px-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-raised">
        <h2 className="break-words text-lg font-semibold text-text">
          What is {label}?
        </h2>
        <p className="mt-2 text-sm text-text-muted">
          {gameName ? (
            <>
              PlayCounter is tracking it as <strong>{gameName}</strong> - that
              looks wrong.
            </>
          ) : (
            <>PlayCounter matched it to a game - is that wrong?</>
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
              A tool, launcher, or background app. Stops tracking it, ignores{" "}
              {label} on this PC, and sends an anonymous report.
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
