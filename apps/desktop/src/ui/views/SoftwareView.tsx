import clsx from "clsx";
import {
  AppWindow,
  Copy,
  EyeOff,
  Gamepad2,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Undo2,
} from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useAppStore, type ExeCacheEntry } from "../../store";
import {
  setToolArt,
  setUserIgnoredProcess,
  unmarkLocalTool,
} from "../../tracker";
import {
  describeToolUsage,
  localDayKey,
  summarizeToolUsage,
  type ToolUsageDetails,
  toolIdentityKey,
  type ToolUsage,
  type ToolUsageSummary,
} from "../../toolUsage";
import { matchesProcessPatternSet } from "../../ignoredProcessPatterns";
import { ArtPickerDialog } from "../ArtPickerDialog";
import { formatDuration, Panel } from "../components";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  useContextMenu,
} from "../ContextMenu";
import { ExeIcon } from "../ExeIcon";
import { Button, Modal } from "../primitives";

/* Software such as Discord, Spotify and launchers. Kept apart from games on
   purpose: no sessions, no Now Playing, no stats. Just how long each app ran,
   counted only while it runs and the PC is awake. */

type SoftwareRow = {
  toolKey: string;
  name: string;
  /** Art picked on this PC, else the shared art; empty for the app icon. */
  art: string;
  /** True when the art was picked on this PC and can be reset. */
  localArt: boolean;
  local: boolean;
  shareStatus?: ExeCacheEntry["communitySuggestionStatus"];
  exeNames: string[];
  exePath: string | null;
  running: boolean;
  summary: ToolUsageSummary;
  details: ToolUsageDetails;
};

export function buildSoftwareRows(input: {
  exeCache: ReadonlyMap<string, ExeCacheEntry>;
  toolUsage: ToolUsage;
  runningExeKeys: ReadonlySet<string>;
  userIgnoredProcesses: Set<string>;
  now: number;
}): SoftwareRow[] {
  const groups = new Map<string, ExeCacheEntry[]>();
  for (const [exeKey, entry] of input.exeCache) {
    if (entry.state !== "tool" || entry.gameId === undefined) continue;
    if (matchesProcessPatternSet(exeKey, input.userIgnoredProcesses)) continue;
    const toolKey = toolIdentityKey(entry);
    groups.set(toolKey, [...(groups.get(toolKey) ?? []), entry]);
  }

  const rows: SoftwareRow[] = [];
  for (const [toolKey, entries] of groups) {
    const exeKeys = entries.map((entry) => entry.exeName.toLowerCase());
    const records = exeKeys.map((exeKey) => input.toolUsage[exeKey]);
    const summary = summarizeToolUsage(records, input.now);
    const running = exeKeys.some((exeKey) => input.runningExeKeys.has(exeKey));
    if (!running && summary.totalSeconds < 1) continue;
    const first = entries[0];
    const pickedArt = records.find((record) => record?.artUrl)?.artUrl;
    rows.push({
      toolKey,
      name: first.gameName ?? first.exeName,
      art:
        pickedArt ??
        entries.find((entry) => entry.coverUrl)?.coverUrl ??
        first.coverUrl ??
        "",
      localArt: Boolean(pickedArt),
      local: first.source === "custom",
      shareStatus: first.communitySuggestionStatus,
      exeNames: entries.map((entry) => entry.exeName),
      exePath: records.find((record) => record?.exePath)?.exePath ?? null,
      running,
      summary,
      details: describeToolUsage(records),
    });
  }
  return rows.sort(
    (left, right) =>
      Number(right.running) - Number(left.running) ||
      right.summary.weekSeconds - left.summary.weekSeconds ||
      left.name.localeCompare(right.name),
  );
}

export function SoftwareView() {
  const trackTools = useAppStore((state) => state.settings.trackTools === true);
  const setTrackTools = useAppStore((state) => state.setTrackTools);
  const layout = useAppStore(
    (state) => state.settings.softwareLayout ?? "grid",
  );
  const setSoftwareLayout = useAppStore((state) => state.setSoftwareLayout);
  const exeCache = useAppStore((state) => state.exeCache);
  const toolUsage = useAppStore((state) => state.toolUsage);
  const processes = useAppStore((state) => state.processes);
  const userIgnoredProcesses = useAppStore(
    (state) => state.userIgnoredProcesses,
  );
  const showDurationDays = useAppStore(
    (state) => state.settings.showDurationDays,
  );
  const [artTarget, setArtTarget] = useState<SoftwareRow | null>(null);
  const [detailsKey, setDetailsKey] = useState<string | null>(null);

  const rows = useMemo(
    () =>
      buildSoftwareRows({
        exeCache,
        toolUsage,
        runningExeKeys: new Set(
          processes.map((process) => process.exeName.toLowerCase()),
        ),
        userIgnoredProcesses,
        now: Date.now(),
      }),
    [exeCache, processes, toolUsage, userIgnoredProcesses],
  );

  const detailsRow = rows.find((row) => row.toolKey === detailsKey) ?? null;

  if (!trackTools) {
    return (
      <Panel className="flex flex-col items-start gap-3 px-5 py-5">
        <div className="text-sm text-text-muted">
          Software tracking is off. Turn it on to count how long apps like
          Discord, Spotify and launchers run. It never counts toward your game
          stats.
        </div>
        <Button variant="primary" onClick={() => setTrackTools(true)}>
          Track software
        </Button>
      </Panel>
    );
  }

  const format = (seconds: number) =>
    seconds < 60 ? "–" : formatDuration(seconds, showDurationDays);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          Counted only while an app runs and your PC is awake. Never part of
          your game stats.
        </p>
        {rows.length > 0 ? (
          <div className="flex h-9 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
            {(
              [
                ["grid", "Cards", LayoutGrid],
                ["list", "List", List],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-label={`${label} view`}
                aria-pressed={layout === value}
                title={label}
                onClick={() => setSoftwareLayout(value)}
                className={clsx(
                  "grid h-full w-8 place-items-center rounded-md transition",
                  layout === value
                    ? "bg-accent text-accent-fg"
                    : "text-text-muted hover:bg-surface-hover hover:text-text",
                )}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <Panel className="px-5 py-10 text-center text-sm text-text-muted">
          No software yet. Discord, Spotify and launchers show up here once they
          run. Other apps can be tracked from Discovered with “Track as
          software”.
        </Panel>
      ) : layout === "grid" ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-4">
          {rows.map((row) => (
            <SoftwareCard
              key={row.toolKey}
              row={row}
              format={format}
              onOpen={() => setDetailsKey(row.toolKey)}
              onChangeArt={() => setArtTarget(row)}
            />
          ))}
        </div>
      ) : (
        <Panel className="divide-y divide-border">
          {rows.map((row) => (
            <SoftwareRowItem
              key={row.toolKey}
              row={row}
              format={format}
              onOpen={() => setDetailsKey(row.toolKey)}
              onChangeArt={() => setArtTarget(row)}
            />
          ))}
        </Panel>
      )}
      {artTarget ? (
        <ArtPickerDialog
          game={{
            gameId: 0,
            source: "custom",
            name: artTarget.name,
            canEditCover: true,
          }}
          onClose={() => setArtTarget(null)}
          onPickCover={(url) => setToolArt(artTarget.exeNames, url)}
        />
      ) : null}
      {detailsRow ? (
        <SoftwareDetailsDialog
          row={detailsRow}
          format={format}
          onClose={() => setDetailsKey(null)}
        />
      ) : null}
    </div>
  );
}

/** "18 Sept", with the year only when it is not this year. */
function formatDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(year === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

function lastUsedLabel(row: SoftwareRow, now = Date.now()) {
  if (row.running) return "Running now";
  const day = row.details.lastDay;
  if (!day) return "–";
  const today = new Date(now);
  if (day === localDayKey(now)) return "Today";
  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
  ).getTime();
  if (day === localDayKey(yesterday)) return "Yesterday";
  return formatDay(day);
}

/* What the stored hours already tell about one app. No session history is
   kept for software, so everything here is per day. */
function SoftwareDetailsDialog({
  row,
  format,
  onClose,
}: {
  row: SoftwareRow;
  format: (seconds: number) => string;
  onClose: () => void;
}) {
  const { details, summary } = row;
  // Durations and counts in mono like elsewhere; dates and words in text.
  const stats: Array<{
    label: string;
    value: string;
    note?: string;
    mono?: boolean;
  }> = [
    { label: "Total", value: format(summary.totalSeconds), mono: true },
    { label: "This week", value: format(summary.weekSeconds), mono: true },
    { label: "Today", value: format(summary.todaySeconds), mono: true },
    { label: "Days used", value: String(details.daysUsed), mono: true },
    {
      label: "First tracked",
      value: details.firstDay ? formatDay(details.firstDay) : "–",
    },
    { label: "Last used", value: lastUsedLabel(row) },
    {
      label: "Average day",
      value: format(details.averagePerDaySeconds),
      mono: true,
    },
    {
      label: "Longest day",
      value: details.longestDay ? format(details.longestDay.seconds) : "–",
      mono: true,
      note: details.longestDay ? formatDay(details.longestDay.day) : undefined,
    },
  ];
  return (
    <Modal
      labelId="software-details-title"
      eyebrow="Software"
      title={row.name}
      subtitle={row.exeNames.join(", ")}
      media={
        <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md border border-border/60 bg-surface-hover">
          {row.art ? (
            <img src={row.art} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center">
              <ExeIcon
                exePath={row.exePath}
                className="h-6 w-6"
                fallback={<AppWindow size={16} className="text-text-faint" />}
              />
            </div>
          )}
        </div>
      }
      onClose={onClose}
      bodyClassName="grid gap-4"
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="min-w-0 rounded-lg border border-border/70 bg-bg/40 px-3 py-2.5"
          >
            <div className="text-[11px] uppercase tracking-wider text-text-faint">
              {stat.label}
            </div>
            <div
              className={clsx(
                "mt-0.5 truncate text-sm text-text",
                stat.mono && "font-mono",
              )}
              title={stat.value}
            >
              {stat.value}
            </div>
            {stat.note ? (
              <div className="truncate text-[11px] text-text-faint">
                {stat.note}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <p className="text-xs text-text-faint">
        Counted only while the app runs and your PC is awake. Time from before
        it was tracked counts toward the total only.
      </p>
    </Modal>
  );
}

/** Opens on clicks inside the card only: the context menu renders in a
 *  portal, and React would bubble its clicks up here too. */
function openOnClick(onOpen: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.target as Node)) onOpen();
  };
}

/** Enter and Space open a card or row like a click. */
function openOnKey(onOpen: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };
}

/* Without art the app's own icon stands in: small and sharp in front, blown
   up and blurred behind it, so the tile carries the app's colours. */
function SoftwareIconTile({ exePath }: { exePath: string | null }) {
  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden bg-surface-hover">
      <ExeIcon
        exePath={exePath}
        className="absolute inset-0 h-full w-full scale-150 object-cover opacity-40 blur-2xl"
      />
      <div className="relative grid h-16 w-16 place-items-center rounded-2xl border border-border/60 bg-surface/80 shadow-raised backdrop-blur-sm">
        <ExeIcon
          exePath={exePath}
          className="h-8 w-8"
          fallback={<AppWindow size={26} className="text-text-faint" />}
        />
      </div>
    </div>
  );
}

function SoftwareCard({
  row,
  format,
  onOpen,
  onChangeArt,
}: {
  row: SoftwareRow;
  format: (seconds: number) => string;
  onOpen: () => void;
  onChangeArt: () => void;
}) {
  const contextMenu = useContextMenu();
  return (
    <article
      {...contextMenu.props}
      role="button"
      tabIndex={0}
      aria-label={`${row.name}, details`}
      onClick={openOnClick(onOpen)}
      onKeyDown={openOnKey(onOpen)}
      title={`${row.name} · this week ${format(row.summary.weekSeconds)}\n${row.exeNames.join(", ")}`}
      className="group relative isolate flex cursor-pointer flex-col overflow-hidden rounded-xl border border-border/70 bg-surface shadow-raised transition duration-200 hover:-translate-y-1 hover:border-accent/80 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <div className="relative aspect-[3/4] w-full shrink-0 overflow-hidden bg-surface-hover">
        {row.art ? (
          <img
            src={row.art}
            alt=""
            loading="lazy"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <SoftwareIconTile exePath={row.exePath} />
        )}
        {row.running ? (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-bg/85 px-2 py-0.5 text-[11px] font-semibold text-success backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_rgb(var(--color-success)/0.7)]" />
            Running
          </span>
        ) : null}
      </div>
      <div className="min-w-0 px-3 py-2.5">
        <div className="truncate text-sm font-semibold text-text">
          {row.name}
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-text-muted">
          {format(row.summary.totalSeconds)}
        </div>
        {row.summary.todaySeconds >= 60 ? (
          <div className="truncate text-[11px] text-text-faint">
            {format(row.summary.todaySeconds)} today
          </div>
        ) : null}
        {row.local ? (
          <div className="mt-0.5 truncate text-[11px] text-text-faint">
            {row.shareStatus === "pending"
              ? "Shared, awaiting review"
              : "Only on this PC"}
          </div>
        ) : null}
      </div>
      <SoftwareMenu
        row={row}
        contextMenu={contextMenu}
        onChangeArt={onChangeArt}
      />
    </article>
  );
}

function SoftwareRowItem({
  row,
  format,
  onOpen,
  onChangeArt,
}: {
  row: SoftwareRow;
  format: (seconds: number) => string;
  onOpen: () => void;
  onChangeArt: () => void;
}) {
  const contextMenu = useContextMenu();
  const note = row.local
    ? row.shareStatus === "pending"
      ? "Shared, awaiting review"
      : "Only on this PC"
    : null;

  return (
    <div
      {...contextMenu.props}
      role="button"
      tabIndex={0}
      aria-label={`${row.name}, details`}
      onClick={openOnClick(onOpen)}
      onKeyDown={openOnKey(onOpen)}
      className="flex cursor-pointer items-center gap-4 px-4 py-3 transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
      title={row.exeNames.join(", ")}
    >
      <div className="relative grid h-12 w-8 shrink-0 place-items-center overflow-hidden rounded-md border border-border/60 bg-surface-hover">
        {row.art ? (
          <img
            src={row.art}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <ExeIcon
            exePath={row.exePath}
            className="h-6 w-6 object-contain"
            fallback={<AppWindow size={16} className="text-text-faint" />}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={clsx(
              "h-2 w-2 shrink-0 rounded-full",
              row.running
                ? "bg-success shadow-[0_0_6px_rgb(var(--color-success)/0.7)]"
                : "bg-transparent",
            )}
          />
          <span className="truncate font-medium text-text">{row.name}</span>
          {row.running ? <span className="sr-only">(running)</span> : null}
        </div>
        {note ? (
          <div className="mt-0.5 pl-4 text-xs text-text-faint">{note}</div>
        ) : null}
      </div>
      <SoftwareStat label="Today" value={format(row.summary.todaySeconds)} />
      <SoftwareStat label="This week" value={format(row.summary.weekSeconds)} />
      <SoftwareStat label="Total" value={format(row.summary.totalSeconds)} />
      <SoftwareMenu
        row={row}
        contextMenu={contextMenu}
        onChangeArt={onChangeArt}
      />
    </div>
  );
}

function SoftwareMenu({
  row,
  contextMenu,
  onChangeArt,
}: {
  row: SoftwareRow;
  contextMenu: ReturnType<typeof useContextMenu>;
  onChangeArt: () => void;
}) {
  const addToast = useAppStore((state) => state.addToast);

  async function ignore() {
    contextMenu.close();
    try {
      for (const exeName of row.exeNames) {
        await setUserIgnoredProcess(exeName, true);
      }
      addToast({
        tone: "info",
        title: `${row.name} ignored`,
        detail: "PlayCounter no longer counts it. Its hours stay stored.",
      });
    } catch (error) {
      addToast({
        tone: "error",
        title: "Could not ignore the app",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <ContextMenu
      open={contextMenu.open}
      position={contextMenu.position}
      onClose={contextMenu.close}
    >
      <ContextMenuItem
        icon={ImageIcon}
        onClick={() => {
          contextMenu.close();
          onChangeArt();
        }}
      >
        Change Art
      </ContextMenuItem>
      {row.localArt ? (
        <ContextMenuItem
          icon={Undo2}
          onClick={() => {
            contextMenu.close();
            setToolArt(row.exeNames, null);
          }}
        >
          Use Default Art
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem
        icon={Copy}
        onClick={() => {
          contextMenu.close();
          void navigator.clipboard.writeText(row.exeNames.join(", "));
        }}
      >
        Copy File Name
      </ContextMenuItem>
      <ContextMenuSeparator />
      {row.local ? (
        <ContextMenuItem
          icon={Gamepad2}
          onClick={() => {
            contextMenu.close();
            unmarkLocalTool(row.toolKey);
            addToast({
              tone: "info",
              title: `${row.name} is back in Discovered`,
              detail:
                row.shareStatus === "pending"
                  ? "Your shared suggestion is withdrawn. Add it as a game there, or ignore it."
                  : "Add it as a game there, or ignore it.",
            });
          }}
        >
          Not Software
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem icon={EyeOff} onClick={() => void ignore()}>
        Ignore This App
      </ContextMenuItem>
    </ContextMenu>
  );
}

function SoftwareStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-20 shrink-0 text-right">
      <div className="text-[11px] uppercase tracking-wider text-text-faint">
        {label}
      </div>
      <div className="font-mono text-sm text-text">{value}</div>
    </div>
  );
}
