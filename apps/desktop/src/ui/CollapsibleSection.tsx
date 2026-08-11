import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useCallback } from "react";
import { useAppStore } from "../store";
import { IconButton } from "./primitives";

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

export function SectionToggle({
  collapsed,
  onToggle,
  controls,
  label,
}: {
  collapsed: boolean;
  onToggle: () => void;
  controls: string;
  label: string;
}) {
  return (
    <IconButton
      aria-expanded={!collapsed}
      aria-controls={controls}
      aria-label={`${collapsed ? "Expand" : "Collapse"} ${label}`}
      onClick={onToggle}
    >
      <ChevronDown
        aria-hidden="true"
        size={15}
        className={clsx(
          "transition-transform duration-200",
          collapsed && "-rotate-90",
        )}
      />
    </IconButton>
  );
}
