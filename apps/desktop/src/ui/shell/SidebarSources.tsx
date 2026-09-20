import clsx from "clsx";
import { useAppStore } from "../../store";
import { useLibrarySources } from "../librarySources";
import { providerTabConfig } from "../libraryProviderTabs";
import { Layers } from "lucide-react";

/* The lower half of the sidebar: where the library's games came from. This is
   the former "Import source" tab strip, moved out of the My Games toolbar. It
   keeps the tab semantics (role, ids, aria-controls) so the library grid can
   still name it as its tablist and keyboard users find the same structure. */

export function SidebarSources({ collapsed }: { collapsed: boolean }) {
  const tabs = useLibrarySources((state) => state.tabs);
  const activeTab = useLibrarySources((state) => state.activeTab);
  const visible = useLibrarySources((state) => state.visible);
  const setLibraryTab = useAppStore((state) => state.setLibraryTab);
  const setActiveView = useAppStore((state) => state.setActiveView);

  if (!visible || tabs.length === 0) return null;

  return (
    <div className="sidebar-sources" data-tour="sidebar-sources">
      {collapsed ? (
        <div className="mx-3 mb-2 h-px bg-border/60" aria-hidden="true" />
      ) : (
        <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-widest text-text-muted/70">
          Sources
        </div>
      )}
      <div
        role="tablist"
        aria-label="Game library source"
        aria-orientation="vertical"
        className="flex flex-col gap-0.5"
      >
        {tabs.map((tab) => {
          const selected = activeTab === tab.id;
          const config =
            tab.kind === "provider" ? providerTabConfig(tab.id) : undefined;
          const iconUrl =
            tab.kind === "unimported" ? "/icon.png" : config?.iconUrl;
          return (
            <button
              key={tab.id}
              id={`library-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="library-tabpanel"
              aria-label={collapsed ? `${tab.label}, ${tab.count}` : undefined}
              title={collapsed ? `${tab.label} · ${tab.count}` : undefined}
              data-controller-item="library-tab"
              onClick={() => {
                setLibraryTab(tab.id);
                setActiveView("games");
              }}
              className={clsx(
                "library-tab group flex w-full items-center gap-3 rounded-lg text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                collapsed ? "justify-center px-0 py-2" : "px-3 py-2",
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
                    "h-4 w-4 shrink-0 object-contain",
                    !selected && "opacity-80 group-hover:opacity-100",
                  )}
                />
              ) : (
                <Layers
                  size={16}
                  className={clsx("shrink-0", selected && "text-accent")}
                />
              )}
              {!collapsed ? (
                <>
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
                </>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
