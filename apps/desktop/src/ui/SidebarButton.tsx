import clsx from "clsx";
import { AlertTriangle, type LucideIcon } from "lucide-react";

type SidebarButtonProps = {
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: number;
  warn?: boolean;
  isPlaying?: boolean;
  onClick: () => void;
};

export function SidebarButton({
  icon: Icon,
  label,
  active,
  badge,
  warn,
  isPlaying,
  onClick,
}: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        active
          ? "bg-accent-tint text-accent before:absolute before:left-0 before:top-1/2 before:h-6 before:w-[3px] before:-translate-y-1/2 before:rounded-r-full before:bg-accent before:shadow-[0_0_8px_rgba(139,140,255,0.6)]"
          : "text-text-muted hover:bg-surface-hover hover:text-text",
      )}
    >
      <Icon
        size={18}
        className={clsx(
          "shrink-0 transition-transform duration-200",
          !active && "group-hover:scale-110 group-hover:text-text",
          active && "scale-105 drop-shadow-[0_0_8px_rgba(139,140,255,0.4)]",
        )}
      />
      <span className="truncate">{label}</span>
      {badge ? (
        <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-warning px-1.5 text-xs font-bold text-bg shadow-[0_0_10px_rgba(245,158,11,0.3)]">
          {badge}
        </span>
      ) : warn ? (
        <div
          className="ml-auto relative flex h-2.5 w-2.5 items-center justify-center shrink-0"
          title="Needs your attention"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-40"></span>
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-warning shadow-[0_0_6px_rgba(245,158,11,0.8)]"></span>
        </div>
      ) : isPlaying ? (
        <div
          className="ml-auto relative flex h-2.5 w-2.5 items-center justify-center shrink-0"
          title="Currently tracking play session"
        >
          <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-success opacity-50 duration-1000"></span>
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_rgba(74,222,128,0.8)]"></span>
        </div>
      ) : null}
    </button>
  );
}
