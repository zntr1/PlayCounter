import clsx from "clsx";
import { ChevronsUp, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const levelUpEvent = "playcounter:community-level-up";

export function CommunityLevelUpButton({
  gameName,
  variant,
  onLevelUp,
}: {
  gameName: string;
  variant: "cover-card" | "cover-list";
  onLevelUp: () => void;
}) {
  const handleClick = () => {
    window.dispatchEvent(new Event(levelUpEvent));
    onLevelUp();
  };

  return (
    <button
      type="button"
      className={clsx(
        "level-up-cta group relative isolate w-full overflow-hidden border text-left",
        variant === "cover-card"
          ? "rounded-xl px-3 py-2.5"
          : "rounded-md px-1.5 py-1",
      )}
      title="Your suggestion was approved — switch to the community version"
      aria-label={`Level up ${gameName} to the approved community version`}
      onClick={handleClick}
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
              Level up to Community
            </span>
          </span>
          <Sparkles
            size={16}
            className="shrink-0 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110"
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

export function LevelUpCelebration() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let hideTimer: number | undefined;
    const celebrate = () => {
      window.clearTimeout(hideTimer);
      setVisible(false);
      window.requestAnimationFrame(() => setVisible(true));
      hideTimer = window.setTimeout(() => setVisible(false), 1_350);
    };

    window.addEventListener(levelUpEvent, celebrate);
    return () => {
      window.removeEventListener(levelUpEvent, celebrate);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[100] grid place-items-center"
      aria-hidden="true"
    >
      <div className="level-up-celebration relative flex items-center gap-3 overflow-hidden rounded-2xl border border-success-border bg-surface px-6 py-4 text-success shadow-raised">
        <span className="absolute inset-0 bg-gradient-to-r from-success-tint via-accent-tint to-success-tint opacity-90" />
        <span className="relative grid h-11 w-11 place-items-center rounded-xl border border-success-border bg-success-tint">
          <ChevronsUp size={27} strokeWidth={2.7} />
        </span>
        <span className="relative">
          <span className="block text-[11px] font-bold uppercase tracking-[0.2em]">
            Suggestion approved
          </span>
          <span className="block text-xl font-extrabold text-text">
            Community Level Up!
          </span>
        </span>
        <Sparkles className="relative" size={22} />
      </div>
    </div>,
    document.body,
  );
}
