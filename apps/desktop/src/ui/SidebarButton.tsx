import clsx from "clsx";
import { type LucideIcon } from "lucide-react";

type SidebarButtonProps = {
  icon: LucideIcon;
  imageSrc?: string;
  label: string;
  active: boolean;
  badge?: number;
  warn?: boolean;
  isPlaying?: boolean;
  /** Icon rail: no label, the label becomes the tooltip, badges shrink to dots. */
  collapsed?: boolean;
  onClick: () => void;
  dataTour?: string;
  controllerEnabled?: boolean;
};

export function SidebarButton({
  icon: Icon,
  imageSrc,
  label,
  active,
  badge,
  warn,
  isPlaying,
  collapsed = false,
  onClick,
  dataTour,
  controllerEnabled = false,
}: SidebarButtonProps) {
  const status = badge ? (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-full bg-warning font-bold text-bg shadow-[0_0_10px_rgb(var(--color-warning)/0.3)]",
        collapsed
          ? "absolute -right-0.5 -top-0.5 h-4 min-w-[16px] px-1 text-[10px]"
          : "ml-auto h-5 min-w-[20px] px-1.5 text-xs",
      )}
    >
      {badge}
    </span>
  ) : warn ? (
    <span
      className={clsx(
        "relative flex h-2.5 w-2.5 shrink-0 items-center justify-center",
        collapsed ? "absolute right-1 top-1" : "ml-auto",
      )}
      title="Needs your attention"
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-40"></span>
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-warning shadow-[0_0_6px_rgb(var(--color-warning)/0.8)]"></span>
    </span>
  ) : isPlaying ? (
    <span
      className={clsx(
        "relative flex h-2.5 w-2.5 shrink-0 items-center justify-center",
        collapsed ? "absolute right-1 top-1" : "ml-auto",
      )}
      title="Currently tracking play session"
    >
      <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-success opacity-50 duration-1000"></span>
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_rgb(var(--color-success)/0.8)]"></span>
    </span>
  ) : null;

  return (
    <button
      data-tour={dataTour}
      data-controller-item={controllerEnabled ? "navigation" : undefined}
      data-controller-active-view={
        active && controllerEnabled ? "true" : undefined
      }
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      className={clsx(
        "sidebar-button group relative flex w-full items-center rounded-xl text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        collapsed ? "h-11 justify-center px-0" : "gap-3 px-3 py-2.5",
        active
          ? "sidebar-button-active bg-accent-tint text-text"
          : "text-text-muted hover:bg-surface-hover hover:text-text",
      )}
    >
      {imageSrc ? (
        <img
          src={imageSrc}
          alt=""
          className={clsx(
            "h-[18px] w-[18px] shrink-0 rounded-sm object-cover transition-transform duration-200",
            !active && "group-hover:scale-110",
            active && "scale-105",
          )}
        />
      ) : (
        <Icon
          size={18}
          className={clsx(
            "shrink-0 transition-transform duration-200",
            !active && "group-hover:scale-110 group-hover:text-text",
            active && "scale-105 text-accent",
          )}
        />
      )}
      {!collapsed ? <span className="truncate">{label}</span> : null}
      {status}
    </button>
  );
}
