import type { Settings } from "@playcounter/shared";
import { isEnabled } from "@tauri-apps/plugin-autostart";
import { ChevronRight, Search, SearchX, X } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { getT } from "../../i18n";
import { useAppStore } from "../../store";
import { cn } from "../cn";
import {
  SectionTurnOnFirst,
  SettingsPage,
  SettingsSection,
  TurnOnFirst,
  type RowLevel,
} from "./settings/SettingsKit";
import {
  settingsGroupAvailable,
  type SettingsGroupId,
} from "./settings/settingsGroups";
import {
  formatError,
  setSettingsOp,
  useSettingsOps,
} from "./settings/settingsOps";
import {
  searchSettings,
  type SettingsGroupHits,
} from "./settings/settingsSearch";
import {
  nodeAvailable,
  settingsGroups,
  type SettingsGroupDef,
  type SettingsNode,
  type SettingsSectionDef,
} from "./settings/settingsTree";

const t = getT("settings");

// The menu leaves a little room before these groups.
const MENU_BREAKS = new Set<SettingsGroupId>(["play", "library", "backup"]);

/** Settings: a menu of groups, one group per page, and a search over all. */
export function SettingsView() {
  const storedGroup = useAppStore((state) => state.settingsGroup);
  const setSettingsGroup = useAppStore((state) => state.setSettingsGroup);
  const tourActive = useAppStore((state) => state.activeTour !== null);
  const settings = useAppStore((state) => state.settings);
  const updateReady = useAppStore((state) => state.availableUpdate !== null);
  const startupSyncing = useSettingsOps((state) => state.startupSyncing);
  const [query, setQuery] = useState("");
  useLaunchOnStartupCheck();

  const groups = settingsGroups(settingsGroupAvailable);
  const active = groups.find((group) => group.id === storedGroup) ?? groups[0];
  // A guide shows the group its step points into, never search results.
  const results =
    query.trim() && !tourActive
      ? searchSettings(groups, query, settings)
      : null;
  const counts = results
    ? new Map(results.map((result) => [result.group.id, result.hits.length]))
    : null;

  function openGroup(group: SettingsGroupId) {
    setQuery("");
    setSettingsGroup(group);
  }

  function dot(group: SettingsGroupId) {
    if (group === "general" && !settings.launchOnStartup && !startupSyncing)
      return (
        <span
          role="img"
          aria-label={t("Auto-start is disabled")}
          title={t("Auto-start is disabled")}
          className="h-2 w-2 shrink-0 rounded-full bg-danger ring-[3px] ring-danger-tint"
        />
      );
    if (group === "about" && updateReady)
      return (
        <span
          role="img"
          aria-label={t("Update available")}
          title={t("Update available")}
          className="h-2 w-2 shrink-0 rounded-full bg-accent ring-[3px] ring-accent/20"
        />
      );
    return null;
  }

  return (
    <div className="settings-shell">
      <div className="settings-layout">
        <nav aria-label={t("Settings")} className="settings-menu">
          <div
            data-tour="settings-search"
            className="settings-menu-search relative"
          >
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-faint"
            />
            <input
              type="search"
              aria-label={t("Search settings")}
              placeholder={t("Search settings")}
              value={query}
              disabled={tourActive}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.stopPropagation();
                  setQuery("");
                }
              }}
              className="h-[38px] w-full rounded-[10px] border border-border/80 bg-bg/60 pl-9 pr-9 text-sm text-text outline-none transition placeholder:text-text-faint focus:border-accent/70 focus:ring-[3px] focus:ring-accent/20 disabled:opacity-60 [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                aria-label={t("Clear search")}
                title={t("Clear search")}
                onClick={() => setQuery("")}
                className="absolute right-1.5 top-1/2 grid h-[26px] w-[26px] -translate-y-1/2 place-items-center rounded-md text-text-muted transition hover:bg-surface-hover hover:text-text"
              >
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {groups.map((group, index) => {
            const Icon = group.icon;
            const current = !results && group.id === active.id;
            const count = counts ? (counts.get(group.id) ?? 0) : null;
            return (
              <Fragment key={group.id}>
                {index > 0 && MENU_BREAKS.has(group.id) ? (
                  <span aria-hidden="true" className="settings-menu-break" />
                ) : null}
                <button
                  type="button"
                  data-group={group.id}
                  aria-current={current ? "page" : undefined}
                  onClick={() => openGroup(group.id)}
                  className={cn(
                    "settings-menu-item flex h-[38px] items-center gap-2.5 rounded-[9px] px-2.5 text-left text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    current
                      ? "bg-accent-tint text-text ring-1 ring-inset ring-accent/25"
                      : "text-text/75 hover:bg-surface-hover hover:text-text",
                    count === 0 && "opacity-40",
                  )}
                >
                  <Icon
                    size={17}
                    aria-hidden="true"
                    className={cn("shrink-0", current && "text-accent-ink")}
                  />
                  <span className="settings-menu-label">{group.title()}</span>
                  {count !== null ? (
                    count > 0 ? (
                      <span className="font-mono text-xs text-text-muted">
                        {count}
                      </span>
                    ) : null
                  ) : (
                    dot(group.id)
                  )}
                </button>
              </Fragment>
            );
          })}
        </nav>
        <div className="min-w-0">
          {results ? (
            <SearchResults
              query={query.trim()}
              results={results}
              onOpen={openGroup}
            />
          ) : (
            <GroupPage group={active} settings={settings} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Settings asks the system whether auto-start is on each time it opens. */
function useLaunchOnStartupCheck() {
  const setLaunchOnStartup = useAppStore((state) => state.setLaunchOnStartup);
  useEffect(() => {
    let cancelled = false;
    setSettingsOp({ startupSyncing: true, startupError: null });
    isEnabled()
      .then((enabled) => {
        if (!cancelled) setLaunchOnStartup(enabled);
      })
      .catch((error) => {
        if (!cancelled) setSettingsOp({ startupError: formatError(error) });
      })
      .finally(() => {
        if (!cancelled) setSettingsOp({ startupSyncing: false });
      });
    return () => {
      cancelled = true;
      setSettingsOp({ startupSyncing: false });
    };
  }, [setLaunchOnStartup]);
}

function GroupPage({
  group,
  settings,
}: {
  group: SettingsGroupDef;
  settings: Settings;
}) {
  return (
    <SettingsPage
      group={group.id}
      icon={group.icon}
      title={group.title()}
      description={group.description()}
      dataTour={group.dataTour}
      guide={group.guide}
      foot={group.foot?.()}
    >
      {group.sections.map((section) => (
        <SectionView key={section.id} section={section} settings={settings} />
      ))}
    </SettingsPage>
  );
}

function SectionView({
  section,
  settings,
}: {
  section: SettingsSectionDef;
  settings: Settings;
}) {
  const nodes = section.nodes.filter(nodeAvailable);
  if (nodes.length === 0) return null;
  const off =
    section.needs && !section.needs.isOn(settings)
      ? section.needs.title()
      : null;
  return (
    <SettingsSection
      title={section.title?.()}
      description={section.description?.()}
      danger={section.danger}
      dataTour={`settings-section-${section.id}`}
      hint={off ? <SectionTurnOnFirst setting={off} /> : null}
    >
      {rows(nodes, 0, off !== null, settings)}
    </SettingsSection>
  );
}

/** Rows, each followed by the rows that need it, one level deeper. Only the
 *  first switch that is off says so. */
function rows(
  nodes: SettingsNode[],
  level: RowLevel,
  disabled: boolean,
  settings: Settings,
): ReactNode[] {
  const out: ReactNode[] = [];
  const deeper = Math.min(level + 1, 2) as RowLevel;
  for (const node of nodes) {
    if (!nodeAvailable(node)) continue;
    const Row = node.Row;
    out.push(<Row key={node.id} level={level} disabled={disabled} />);
    if (!node.children?.length) continue;
    const on = node.isOn ? node.isOn(settings) : true;
    if (!on && !disabled)
      out.push(
        <TurnOnFirst
          key={`${node.id}:off`}
          setting={node.title()}
          level={deeper}
        />,
      );
    out.push(...rows(node.children, deeper, disabled || !on, settings));
  }
  return out;
}

function SearchResults({
  query,
  results,
  onOpen,
}: {
  query: string;
  results: SettingsGroupHits[];
  onOpen: (group: SettingsGroupId) => void;
}) {
  if (results.length === 0)
    return (
      <div
        data-results
        className="grid justify-items-center gap-1 rounded-xl border border-dashed border-border px-5 py-9 text-center text-text-muted"
      >
        <SearchX
          size={22}
          aria-hidden="true"
          className="mb-1 text-text-faint"
        />
        <p>{t("No settings match “{{query}}”.", { query })}</p>
        <p className="text-[13px] text-text-faint">
          {t("Try another word, like popup, backup or hotkey.")}
        </p>
      </div>
    );
  const count = results.reduce((sum, result) => sum + result.hits.length, 0);
  return (
    <div data-results className="settings-page grid gap-5">
      <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-text">
        {t("{{count}} settings for “{{query}}”", { count, query })}
      </h2>
      {results.map(({ group, hits }) => {
        const Icon = group.icon;
        return (
          <section
            key={group.id}
            data-result-group={group.id}
            className="grid gap-2"
          >
            <div className="mx-1 flex items-center gap-2 text-[13px] font-semibold text-text-muted">
              <Icon size={15} aria-hidden="true" />
              <span data-group-name>{group.title()}</span>
              <button
                type="button"
                onClick={() => onOpen(group.id)}
                className="ml-auto inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-accent-ink hover:underline"
              >
                {t("Open {{group}}", { group: group.title() })}
                <ChevronRight size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="settings-card overflow-hidden rounded-xl border border-border bg-surface shadow-raised">
              {hits.flatMap(({ node, off }) => {
                const Row = node.Row;
                return [
                  <Row key={node.id} level={0} disabled={off !== null} />,
                  off ? (
                    <TurnOnFirst
                      key={`${node.id}:off`}
                      setting={off}
                      level={0}
                    />
                  ) : null,
                ];
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
