import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useCallback, type ReactNode } from "react";
import { useAppStore } from "../store";

export function useSectionCollapse(sectionId: string) {
  const collapsed = useAppStore((state) =>
    state.collapsedSections.includes(sectionId),
  );
  const toggleSectionCollapsed = useAppStore(
    (state) => state.toggleSectionCollapsed,
  );
  const toggle = useCallback(
    () => toggleSectionCollapsed(sectionId),
    [sectionId, toggleSectionCollapsed],
  );

  return { collapsed, toggle };
}

export function SectionHeading({
  id,
  title,
  caption,
  action,
  collapsed,
  onToggle,
  controls,
}: {
  id: string;
  title: string;
  caption: string;
  action?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  controls: string;
}) {
  return (
    <div
      className={clsx(
        "relative flex min-w-0 items-start justify-between gap-4",
        collapsed ? "mb-0" : "mb-5",
      )}
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-controls={controls}
        aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
        onClick={onToggle}
        className="absolute -inset-2 rounded-lg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      />
      <div className="pointer-events-none relative min-w-0">
        <h2
          id={id}
          className="text-xs font-bold uppercase tracking-[0.14em] text-text-faint"
        >
          {title}
        </h2>
        <p className="mt-1 text-sm text-text-muted">{caption}</p>
      </div>
      <div className="pointer-events-none relative flex shrink-0 items-center gap-2">
        {action ? <div className="pointer-events-auto">{action}</div> : null}
        <span className="flex h-8 w-8 items-center justify-center text-text-muted">
          <ChevronDown
            aria-hidden="true"
            size={15}
            className={clsx(
              "transition-transform duration-200 motion-reduce:transition-none",
              collapsed && "-rotate-90",
            )}
          />
        </span>
      </div>
    </div>
  );
}
