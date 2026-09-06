import clsx from "clsx";
import { ArrowUpRight, ScanSearch, X } from "lucide-react";

export function LibraryMatchOffer({
  gameName,
  onReview,
  onDismiss,
  onCover,
}: {
  gameName: string;
  onReview: () => void;
  onDismiss: () => void;
  onCover: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex min-w-0 items-center overflow-hidden rounded-lg border border-success-border/50 bg-bg/95 shadow-raised backdrop-blur-xl",
        !onCover && "mt-2 w-fit max-w-full",
      )}
    >
      <button
        type="button"
        onClick={onReview}
        aria-label={`Review tracking match for ${gameName}`}
        className="group/match flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 pr-1.5 text-left transition-colors hover:bg-success-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-success"
      >
        <ScanSearch size={17} className="shrink-0 text-success" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold leading-4 text-text">
            Match found
          </span>
          <span className="block text-[10px] leading-4 text-text-muted">
            Review to start tracking
          </span>
        </span>
        <ArrowUpRight
          size={15}
          className="shrink-0 text-success transition-transform group-hover/match:-translate-y-0.5 group-hover/match:translate-x-0.5"
        />
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Dismiss tracking match for ${gameName} until next startup`}
        title="Not now — remind me next startup"
        className="mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-faint transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-success"
      >
        <X size={14} />
      </button>
    </div>
  );
}
