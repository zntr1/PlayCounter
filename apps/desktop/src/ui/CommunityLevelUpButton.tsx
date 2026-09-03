import clsx from "clsx";
import { ChevronsUp, Sparkles } from "lucide-react";

export function CommunityLevelUpButton({
  gameName,
  variant,
  onLevelUp,
}: {
  gameName: string;
  variant: "cover-card" | "cover-list";
  onLevelUp: () => void;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "level-up-cta group/level-up relative isolate w-full overflow-hidden border text-left",
        variant === "cover-card"
          ? "rounded-xl px-3 py-2.5"
          : "rounded-md px-1.5 py-1",
      )}
      title="Your suggestion was approved! Switch to the community version"
      aria-label={`Level up ${gameName} to the approved community version`}
      onClick={onLevelUp}
    >
      {variant === "cover-card" ? (
        <span className="relative z-10 flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-success-border bg-success-tint shadow-sm">
            <ChevronsUp
              className="level-up-arrow"
              size={19}
              strokeWidth={2.5}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-bold uppercase tracking-[0.16em] opacity-75">
              Suggestion approved
            </span>
            <span className="mt-0.5 block truncate text-xs font-bold">
              Level up
            </span>
          </span>
          <Sparkles
            size={16}
            className="shrink-0 transition-transform duration-300 group-hover/level-up:rotate-12 group-hover/level-up:scale-110"
          />
        </span>
      ) : (
        <span className="relative z-10 flex items-center justify-center gap-1 text-[9px] font-extrabold uppercase tracking-[0.1em]">
          <ChevronsUp className="level-up-arrow" size={13} strokeWidth={2.8} />
          Level up
          <Sparkles size={11} />
        </span>
      )}
    </button>
  );
}
