import clsx from "clsx";
import { type LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { RailTooltip, useRailTooltip } from "./shell/RailTooltip";

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
  /** Quiet trailing number, e.g. the library size. */
  count?: number;
  /** Leaves room on the right for a control placed over the row (chevron). */
  trailingSpace?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  onContextMenu?: (event: MouseEvent) => void;
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
  count,
  trailingSpace = false,
  disabled = false,
  title,
  onClick,
  onContextMenu,
  dataTour,
  controllerEnabled = false,
}: SidebarButtonProps) {
  const tooltip = useRailTooltip(collapsed);
  /* On the icon rail a status has no label to sit beside, so it becomes a
     badge on the icon's own corner, ringed in the sidebar's colour the way a
     presence dot is. A loose speck in the button's corner reads as a
     rendering glitch rather than as state. */
  const statusTitle = badge
    ? `${badge} waiting for review`
    : warn
      ? "Needs your attention"
      : isPlaying
        ? "Currently tracking play session"
        : undefined;
  const dotRing = "ring-2 ring-[rgb(var(--color-bg))]";

  const railStatus = badge ? (
    <span
      className={clsx(
        "absolute -right-1.5 -top-1.5 inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-warning px-1 text-[10px] font-bold text-bg",
        dotRing,
      )}
    >
      {badge}
    </span>
  ) : warn || isPlaying ? (
    <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
      <span
        className={clsx(
          "absolute inline-flex h-full w-full rounded-full opacity-50",
          warn ? "animate-ping bg-warning" : "animate-pulse bg-success",
        )}
      />
      <span
        className={clsx(
          "relative inline-flex h-2.5 w-2.5 rounded-full",
          dotRing,
          warn ? "bg-warning" : "bg-success",
        )}
      />
    </span>
  ) : null;

  const rowStatus = badge ? (
    <span className="ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-warning px-1.5 text-xs font-bold text-bg shadow-[0_0_10px_rgb(var(--color-warning)/0.3)]">
      {badge}
    </span>
  ) : warn || isPlaying ? (
    <span
      className="relative ml-auto flex h-2.5 w-2.5 shrink-0 items-center justify-center"
      title={statusTitle}
    >
      <span
        className={clsx(
          "absolute inline-flex h-full w-full rounded-full opacity-50",
          warn ? "animate-ping bg-warning" : "animate-pulse bg-success",
        )}
      />
      <span
        className={clsx(
          "relative inline-flex h-1.5 w-1.5 rounded-full",
          warn
            ? "bg-warning shadow-[0_0_6px_rgb(var(--color-warning)/0.8)]"
            : "bg-success shadow-[0_0_6px_rgb(var(--color-success)/0.8)]",
        )}
      />
    </span>
  ) : count !== undefined ? (
    <span
      className={clsx(
        "ml-auto font-mono text-xs tabular-nums",
        trailingSpace && "mr-8",
        active ? "text-text" : "text-text-faint",
      )}
    >
      {count}
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
      {...tooltip.triggerProps}
      onClick={() => {
        tooltip.hide();
        onClick();
      }}
      onContextMenu={
        onContextMenu
          ? (event) => {
              tooltip.hide();
              onContextMenu(event);
            }
          : undefined
      }
      disabled={disabled}
      // The rail shows `title` inside its own label; a second tooltip would stack.
      title={collapsed ? undefined : title}
      aria-label={collapsed ? label : undefined}
      className={clsx(
        "sidebar-button group relative flex w-full items-center rounded-xl text-[15px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        collapsed ? "h-11 justify-center px-0" : "h-11 gap-3 px-3",
        disabled && "cursor-not-allowed opacity-50",
        active
          ? "sidebar-button-active text-text"
          : "text-text/75 hover:bg-surface-hover hover:text-text",
      )}
    >
      <span className="relative grid shrink-0 place-items-center">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt=""
            className={clsx(
              "h-5 w-5 rounded-sm object-cover transition-transform duration-200",
              !active && "group-hover:scale-110",
              active && "scale-105",
            )}
          />
        ) : (
          <Icon
            size={20}
            strokeWidth={active ? 2.2 : 1.9}
            className={clsx(
              "transition-transform duration-200",
              !active && "group-hover:scale-110 group-hover:text-text",
              active && "scale-105 text-accent-ink",
            )}
          />
        )}
        {collapsed ? railStatus : null}
      </span>
      {!collapsed ? (
        <span className="animate-label-in truncate motion-reduce:animate-none">
          {label}
        </span>
      ) : null}
      {!collapsed ? rowStatus : null}
      {collapsed ? (
        <RailTooltip
          anchor={tooltip.anchor}
          label={label}
          detail={title ?? statusTitle}
        />
      ) : null}
    </button>
  );
}
