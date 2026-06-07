import type { PropsWithChildren } from "react";
import type { GameSource } from "@playcounter/shared";

export function Panel({
  children,
  className = "",
}: PropsWithChildren<{ className?: string }>) {
  return (
    <section
      className={`rounded-lg border border-border bg-surface shadow-raised ${className}`}
    >
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend?: string;
}) {
  return (
    <Panel className="flex flex-1 flex-col justify-center px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wider text-text-faint">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <div className="font-mono text-2xl font-bold tracking-tight text-text">
          {value}
        </div>
        {trend && <div className="text-sm text-text-muted">{trend}</div>}
      </div>
    </Panel>
  );
}

export function formatDuration(seconds: number, showDays = false) {
  const days = Math.floor(seconds / 86400);
  const hours = showDays
    ? Math.floor((seconds % 86400) / 3600)
    : Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (showDays && days > 0) return `${days}d ${hours}h`;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const sourceBadgeStyles: Record<GameSource, string> = {
  igdb: "border-community-border bg-community-tint text-community shadow-sm",
  community: "border-success-border bg-success-tint text-success shadow-sm",
  custom: "border-warning-border bg-warning-tint text-warning shadow-sm",
};

const sourceBadgeLabels: Record<GameSource, string> = {
  igdb: "IGDB",
  community: "Community",
  custom: "Local",
};

const sourceBadgeTooltips: Record<GameSource, string> = {
  igdb: "Verified game metadata from the Internet Game Database",
  community:
    "Game metadata submitted and verified by the PlayCounter community",
  custom: "Local game metadata created by you",
};

export function SourceBadge({ source }: { source?: GameSource | null }) {
  if (!source) return null;

  return (
    <span
      title={sourceBadgeTooltips[source]}
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${sourceBadgeStyles[source]}`}
    >
      {sourceBadgeLabels[source]}
    </span>
  );
}

export function CommunityApprovalBadge({
  suggestionId,
  verified,
}: {
  suggestionId?: number;
  verified?: boolean;
}) {
  if (!suggestionId) return null;

  return (
    <span className="inline-flex shrink-0 rounded border border-community-border bg-community-tint px-1.5 py-0.5 text-[11px] font-medium text-community">
      {verified ? "Community approved" : "Awaiting community approval"}
    </span>
  );
}
