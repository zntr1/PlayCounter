import clsx from "clsx";
import {
  AppWindow,
  Copy,
  EyeOff,
  Gamepad2,
  Image as ImageIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useAppStore, type ExeCacheEntry } from "../../store";
import {
  setLocalToolCover,
  setUserIgnoredProcess,
  unmarkLocalTool,
} from "../../tracker";
import {
  summarizeToolUsage,
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
import { Button } from "../primitives";

/* Software such as Discord, Spotify and launchers. Kept apart from games on
   purpose: no sessions, no Now Playing, no stats. Just how long each app ran,
   counted only while it runs and the PC is awake. */

type SoftwareRow = {
  toolKey: string;
  name: string;
  coverUrl: string;
  local: boolean;
  shareStatus?: ExeCacheEntry["communitySuggestionStatus"];
  exeNames: string[];
  exePath: string | null;
  running: boolean;
  summary: ToolUsageSummary;
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
    rows.push({
      toolKey,
      name: first.gameName ?? first.exeName,
      coverUrl:
        entries.find((entry) => entry.coverUrl)?.coverUrl ??
        first.coverUrl ??
        "",
      local: first.source === "custom",
      shareStatus: first.communitySuggestionStatus,
      exeNames: entries.map((entry) => entry.exeName),
      exePath: records.find((record) => record?.exePath)?.exePath ?? null,
      running,
      summary,
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

  return (
    <div className="grid gap-3">
      <p className="text-sm text-text-muted">
        Counted only while an app runs and your PC is awake. Never part of your
        game stats.
      </p>
      {rows.length === 0 ? (
        <Panel className="px-5 py-10 text-center text-sm text-text-muted">
          No software yet. Discord, Spotify and launchers show up here once they
          run. Other apps can be tracked from Discovered with “Track as
          software”.
        </Panel>
      ) : (
        <Panel className="divide-y divide-border">
          {rows.map((row) => (
            <SoftwareRowItem
              key={row.toolKey}
              row={row}
              showDurationDays={showDurationDays}
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
          onPickCover={(url) => setLocalToolCover(artTarget.toolKey, url)}
        />
      ) : null}
    </div>
  );
}

function SoftwareRowItem({
  row,
  showDurationDays,
  onChangeArt,
}: {
  row: SoftwareRow;
  showDurationDays: boolean;
  onChangeArt: () => void;
}) {
  const contextMenu = useContextMenu();
  const addToast = useAppStore((state) => state.addToast);
  const format = (seconds: number) =>
    seconds < 60 ? "–" : formatDuration(seconds, showDurationDays);
  const note = row.local
    ? row.shareStatus === "pending"
      ? "Shared, awaiting review"
      : "Only on this PC"
    : null;

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
    <div
      {...contextMenu.props}
      className="flex items-center gap-4 px-4 py-3"
      title={row.exeNames.join(", ")}
    >
      <div className="relative grid h-12 w-8 shrink-0 place-items-center overflow-hidden rounded-md border border-border/60 bg-surface-hover">
        {row.coverUrl ? (
          <img
            src={row.coverUrl}
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

      <ContextMenu
        open={contextMenu.open}
        position={contextMenu.position}
        onClose={contextMenu.close}
      >
        {row.local ? (
          <ContextMenuItem
            icon={ImageIcon}
            onClick={() => {
              contextMenu.close();
              onChangeArt();
            }}
          >
            Change Art
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
    </div>
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
