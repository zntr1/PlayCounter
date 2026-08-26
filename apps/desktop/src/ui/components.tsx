import type { PropsWithChildren } from "react";
import type {
  ContributionStatus,
  GameSource,
  LibraryProviderId,
} from "@playcounter/shared";

export function Panel({
  children,
  className = "",
  dataTour,
}: PropsWithChildren<{ className?: string; dataTour?: string }>) {
  return (
    <section
      data-tour={dataTour}
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
    <Panel className="flex min-w-0 flex-1 flex-col justify-center px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wider text-text-faint">
        {label}
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
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
  custom: "Custom",
};

const sourceBadgeTooltips: Record<GameSource, string> = {
  igdb: "IGDB has this file name on record for the game.",
  community:
    "A PlayCounter user linked this file name to the game, and it was approved.",
  custom: "You linked this file name to the game yourself. Stays on this PC.",
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

export function ProviderBadge({ provider }: { provider: LibraryProviderId }) {
  return (
    <span
      title="Imported from your local Steam library"
      className="inline-flex shrink-0 items-center rounded border border-[#66c0f4]/40 bg-[#1b2838] px-1.5 py-0.5 text-[11px] font-semibold text-[#66c0f4]"
    >
      {provider === "steam" ? "Steam" : provider}
    </span>
  );
}

const emulatorLabels: Record<string, string> = {
  dosbox: "DOSBox",
  dolphin: "Dolphin",
};

export function EmulatorBadge({
  emulatorId,
  label,
}: {
  emulatorId: string;
  label?: string;
}) {
  const display = label ?? emulatorLabels[emulatorId] ?? emulatorId;
  return (
    <span
      title={`Played through ${display}`}
      data-emulator-id={emulatorId}
      className="emulator-badge inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[11px] font-semibold"
    >
      {display}
    </span>
  );
}

export function CommunityApprovalBadge({
  suggestionId,
  verified,
  status,
}: {
  suggestionId?: number;
  verified?: boolean;
  status?: ContributionStatus;
}) {
  if (!suggestionId) return null;
  const resolvedStatus = status ?? (verified ? "verified" : "pending");
  if (resolvedStatus === "rejected") return null;

  return (
    <span className="inline-flex shrink-0 rounded border border-community-border bg-community-tint px-1.5 py-0.5 text-[11px] font-medium text-community">
      {resolvedStatus === "verified"
        ? "Community approved"
        : "Awaiting community approval"}
    </span>
  );
}
