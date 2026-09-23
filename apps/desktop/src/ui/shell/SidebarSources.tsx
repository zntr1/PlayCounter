import clsx from "clsx";
import { useAppStore } from "../../store";
import { useLibrarySources } from "../librarySources";
import { providerTabConfig } from "../libraryProviderTabs";
import { Layers } from "lucide-react";

/* The lower half of the sidebar: where the library's games came from. This is
   the former "Import source" tab strip, moved out of the My Games toolbar. It
   keeps the tab semantics (role, ids, aria-controls) so the library grid can
   still name it as its tablist and keyboard users find the same structure.
   Only rendered with the sidebar expanded: on the icon rail five provider
   glyphs under one another say nothing about what they filter. */

export function SidebarSources() {
  const tabs = useLibrarySources((state) => state.tabs);
  const activeTab = useLibrarySources((state) => state.activeTab);
  const visible = useLibrarySources((state) => state.visible);
  const setLibraryTab = useAppStore((state) => state.setLibraryTab);
  const setActiveView = useAppStore((state) => state.setActiveView);
  // The highlight means "this is what the library shows"; away from the
  // library nothing is being shown, so nothing is highlighted.
  const onLibrary = useAppStore(
    (state) => state.activeView === "games" || state.activeView === "import",
  );

  if (!visible || tabs.length === 0) return null;

  return (
    <div className="sidebar-sources mb-1 mt-0.5 animate-fade-in">
      <div
        role="tablist"
        aria-label="Game library source"
        aria-orientation="vertical"
        className="flex flex-col gap-px"
      >
        {tabs.map((tab) => {
          const selected = onLibrary && activeTab === tab.id;
          const config =
            tab.kind === "provider" ? providerTabConfig(tab.id) : undefined;
          const iconUrl =
            tab.kind === "unimported"
              ? "/brand/playcounter-mark-small.svg"
              : config?.iconUrl;
          return (
            <button
              key={tab.id}
              id={`library-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="library-tabpanel"
              data-controller-item="library-tab"
              onClick={() => {
                setLibraryTab(tab.id);
                setActiveView("games");
              }}
              className={clsx(
                "library-tab group flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                selected
                  ? "bg-surface-hover text-text"
                  : "text-text-muted hover:bg-surface-hover/60 hover:text-text",
              )}
            >
              {iconUrl ? (
                <img
                  src={iconUrl}
                  alt=""
                  aria-hidden="true"
                  className={clsx(
                    "h-[18px] w-[18px] shrink-0 object-contain",
                    !selected && "opacity-80 group-hover:opacity-100",
                  )}
                />
              ) : (
                <Layers
                  size={18}
                  className={clsx("shrink-0", selected && "text-accent-ink")}
                />
              )}
              <span className="min-w-0 flex-1 truncate text-left">
                {tab.label}
              </span>
              <span
                className={clsx(
                  "font-mono text-[11px] tabular-nums",
                  selected ? "text-text" : "text-text-faint",
                )}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
