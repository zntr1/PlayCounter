import type { PropsWithChildren, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Check,
  Clock3,
  Cpu,
  Database,
  Gamepad2,
  PenLine,
  Users,
} from "lucide-react";
import type {
  ContributionStatus,
  GameSource,
  LibraryProviderId,
} from "@playcounter/shared";
import steamIconUrl from "../../../../assets/steam/Steam_icon_logo.svg";
import xboxIconUrl from "../../../../assets/xbox/xbox-logo.svg";
import { emulatorAssetUrls } from "../emulators/assets";

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

/* Badge system ───────────────────────────────────────────────────────────────
   A game card answers two unrelated questions, so it answers them in two
   shapes instead of five look-alike pills.

   Seal (rounded square, corner of the cover)
     How does PlayCounter know this executable is this game? An IGDB record, a
     community-approved link, or one you made yourself.

   Coin (circle, beside the game name)
     Where did this game come from? Steam, Xbox, an emulator, or PlayCounter
     spotting it on its own.

   Dense grids show marks and explain them on hover. The list view has the room
   to spell the same vocabulary out in words. */

export type BadgeVariant = "label" | "mark";
export type SourceApproval = "pending" | "approved";

const LABEL_SHELL =
  "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium";
const SEAL_SHELL =
  "relative grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md border bg-bg/85 shadow-raised";
// Coins sit beside the game name, so they stay smaller than the cover seals.
// Border and shadow come from the entry: some marks are their own badge.
const COIN_SHELL =
  "relative grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full";
const PIP_SHELL =
  "absolute -bottom-1 -right-1 z-10 grid h-3.5 w-3.5 place-items-center rounded-full border border-bg";
const COIN_IMAGE = "h-[17px] w-[17px] object-contain";
const LABEL_IMAGE = "h-3 w-3 object-contain";

type SourceMeta = {
  label: string;
  icon: LucideIcon;
  tip: string;
  tone: string;
  labelTone: string;
  markTone: string;
};

// Custom stays neutral so amber is reserved for real warnings; IGDB and
// Community keep the hues the app has always used for them.
const sourceMeta: Record<GameSource, SourceMeta> = {
  igdb: {
    label: "IGDB",
    icon: Database,
    tip: "IGDB has this file name on record for the game.",
    tone: "text-community",
    labelTone: "border-community-border bg-community-tint text-community",
    markTone: "border-community-border text-community",
  },
  community: {
    label: "Community",
    icon: Users,
    tip: "Another user linked this file name to the game, and it was approved.",
    tone: "text-success",
    labelTone: "border-success-border bg-success-tint text-success",
    markTone: "border-success-border text-success",
  },
  custom: {
    label: "Custom",
    icon: PenLine,
    tip: "You linked this file name to the game yourself. It stays on this PC.",
    tone: "text-text-muted",
    labelTone: "border-border bg-surface text-text-muted",
    markTone: "border-border text-text-muted",
  },
};

const approvalMeta: Record<
  SourceApproval,
  { icon: LucideIcon; tip: string; pipTone: string }
> = {
  pending: {
    icon: Clock3,
    tip: "Sent to the community and waiting to be reviewed.",
    pipTone: "bg-warning text-bg",
  },
  approved: {
    icon: Check,
    tip: "The community approved this match.",
    pipTone: "bg-success text-bg",
  },
};

export function communitySuggestionApproval(value: {
  suggestionId?: number;
  verified?: boolean;
  status?: ContributionStatus;
}): SourceApproval | undefined {
  if (!value.suggestionId) return undefined;
  const status = value.status ?? (value.verified ? "verified" : "pending");
  if (status === "verified") return "approved";
  if (status === "pending") return "pending";
  return undefined;
}

function sourceTip(source: GameSource, approval?: SourceApproval) {
  const meta = sourceMeta[source];
  return approval
    ? `${meta.label}: ${meta.tip} ${approvalMeta[approval].tip}`
    : `${meta.label}: ${meta.tip}`;
}

export function SourceBadge({
  source,
  variant = "label",
  approval,
  dataTour,
}: {
  source?: GameSource | null;
  variant?: BadgeVariant;
  approval?: SourceApproval;
  dataTour?: string;
}) {
  if (!source) return null;
  const meta = sourceMeta[source];
  const Icon = meta.icon;
  const pip = approval ? approvalMeta[approval] : null;
  const PipIcon = pip?.icon;
  const tip = sourceTip(source, approval);

  if (variant === "mark") {
    return (
      <span
        role="img"
        data-tour={dataTour}
        aria-label={tip}
        className={`${SEAL_SHELL} ${meta.markTone}`}
      >
        <Icon size={17} strokeWidth={2.25} aria-hidden="true" />
        {pip && PipIcon ? (
          <span aria-hidden="true" className={`${PIP_SHELL} ${pip.pipTone}`}>
            <PipIcon size={10} strokeWidth={4} />
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span
      data-tour={dataTour}
      title={tip}
      className={`${LABEL_SHELL} ${meta.labelTone}`}
    >
      <Icon size={11} strokeWidth={2.25} aria-hidden="true" />
      {meta.label}
      {pip && PipIcon ? (
        <PipIcon size={11} strokeWidth={2.5} aria-hidden="true" />
      ) : null}
    </span>
  );
}

export function GameMatchBadges({
  sources,
  approval,
  variant = "mark",
  dataTourPrefix,
  className = "",
}: {
  sources: readonly GameSource[];
  approval?: SourceApproval;
  variant?: BadgeVariant;
  dataTourPrefix?: string;
  className?: string;
}) {
  if (sources.length === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center ${variant === "mark" ? "gap-0" : "gap-1.5"} ${className}`}
    >
      {sources.map((source) => (
        <SourceBadge
          key={source}
          source={source}
          variant={variant}
          approval={source === "custom" ? approval : undefined}
          dataTour={dataTourPrefix ? `${dataTourPrefix}-${source}` : undefined}
        />
      ))}
    </div>
  );
}

type OriginEntry = {
  key: string;
  label: string;
  tip: string;
  tone: string;
  coinTone: string;
  chipTone: string;
  iconUrl?: string;
  icon?: LucideIcon;
  emulatorId?: string;
  unknownDuration?: boolean;
  /** The asset is already a finished badge, so it fills the mark itself instead
   *  of floating inside a second circle. */
  coinFill?: boolean;
};

const providerMeta: Record<
  LibraryProviderId,
  Omit<OriginEntry, "key" | "unknownDuration">
> = {
  steam: {
    label: "Steam",
    tip: "Imported from your local Steam library.",
    iconUrl: steamIconUrl,
    tone: "text-[#66c0f4]",
    coinTone: "shadow-raised",
    chipTone: "border-[#66c0f4]/40 bg-[#1b2838] text-[#66c0f4]",
    coinFill: true,
  },
  xbox: {
    label: "Xbox",
    tip: "Imported from your Xbox play history.",
    iconUrl: xboxIconUrl,
    tone: "text-[#7ee787]",
    coinTone: "shadow-raised",
    chipTone: "border-[#107c10]/50 bg-[#0e2f16] text-[#7ee787]",
    coinFill: true,
  },
};

const emulatorLabels: Record<string, string> = {
  dosbox: "DOSBox",
  dolphin: "Dolphin",
};

const UNKNOWN_DURATION_TIP = "This source did not report how long you played.";

function providerOrigin(
  provider: LibraryProviderId,
  unknownDuration = false,
): OriginEntry {
  return { key: provider, ...providerMeta[provider], unknownDuration };
}

function emulatorOrigin(emulatorId: string, label?: string): OriginEntry {
  return {
    key: `emulator:${emulatorId}`,
    emulatorId,
    label: label ?? emulatorLabels[emulatorId] ?? emulatorId,
    tip: "Played through this emulator.",
    tone: "text-accent",
    // The emulator logos carry their own colour, so the coin stays neutral; the
    // solid `.emulator-badge` fill is kept for the labelled chip.
    coinTone: "border border-accent/60 bg-bg/85 text-accent shadow-raised",
    chipTone: "emulator-badge",
    iconUrl: emulatorAssetUrls[emulatorId],
    icon: Cpu,
  };
}

// The app icon is a transparent gamepad, not a disc, so it gets no ring at all.
const playCounterOrigin: OriginEntry = {
  key: "playcounter",
  label: "PlayCounter",
  tip: "Found by PlayCounter itself, not imported from a launcher.",
  tone: "text-text-muted",
  coinTone: "",
  chipTone: "border-border bg-surface text-text-muted",
  iconUrl: "/icon.png",
  icon: Gamepad2,
  coinFill: true,
};

export function gameOrigins({
  providers,
  emulatorIds,
  unknownDurationProviders = [],
}: {
  providers: readonly LibraryProviderId[];
  emulatorIds: readonly string[];
  unknownDurationProviders?: readonly LibraryProviderId[];
}): OriginEntry[] {
  const entries = [
    ...providers.map((provider) =>
      providerOrigin(provider, unknownDurationProviders.includes(provider)),
    ),
    ...emulatorIds.map((emulatorId) => emulatorOrigin(emulatorId)),
  ];
  return entries.length > 0 ? entries : [playCounterOrigin];
}

function OriginGlyph({
  entry,
  variant,
}: {
  entry: OriginEntry;
  variant: BadgeVariant;
}) {
  if (entry.iconUrl) {
    return (
      <img
        src={entry.iconUrl}
        alt=""
        aria-hidden="true"
        className={
          variant === "label"
            ? LABEL_IMAGE
            : entry.coinFill
              ? "h-full w-full object-contain"
              : COIN_IMAGE
        }
      />
    );
  }
  const Icon = entry.icon ?? Gamepad2;
  return (
    <Icon
      size={variant === "mark" ? 14 : 11}
      strokeWidth={2.25}
      aria-hidden="true"
    />
  );
}

function originTip(entry: OriginEntry) {
  return `${entry.label}: ${entry.tip}${entry.unknownDuration ? ` ${UNKNOWN_DURATION_TIP}` : ""}`;
}

function OriginBadge({
  entry,
  variant,
}: {
  entry: OriginEntry;
  variant: BadgeVariant;
}) {
  const tip = originTip(entry);

  if (variant === "mark") {
    return (
      <span
        role="img"
        aria-label={tip}
        title={tip}
        data-emulator-id={entry.emulatorId}
        className={`${COIN_SHELL} ${entry.coinTone}`}
      >
        <OriginGlyph entry={entry} variant="mark" />
        {entry.unknownDuration ? (
          <span
            aria-hidden="true"
            className={`${PIP_SHELL} bg-warning text-[9px] font-bold leading-none text-bg`}
          >
            ?
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span
      title={tip}
      data-emulator-id={entry.emulatorId}
      className={`${LABEL_SHELL} font-semibold ${entry.chipTone}`}
    >
      <OriginGlyph entry={entry} variant="label" />
      {entry.label}
      {entry.unknownDuration ? <span aria-hidden="true">?</span> : null}
    </span>
  );
}

export function ProviderBadge({
  provider,
  variant = "label",
  unknownDuration = false,
}: {
  provider: LibraryProviderId;
  variant?: BadgeVariant;
  unknownDuration?: boolean;
}) {
  return (
    <OriginBadge
      entry={providerOrigin(provider, unknownDuration)}
      variant={variant}
    />
  );
}

export function EmulatorBadge({
  emulatorId,
  label,
  variant = "label",
}: {
  emulatorId: string;
  label?: string;
  variant?: BadgeVariant;
}) {
  return (
    <OriginBadge entry={emulatorOrigin(emulatorId, label)} variant={variant} />
  );
}

export function GameOriginBadges({
  providers,
  emulatorIds,
  unknownDurationProviders = [],
  variant = "mark",
  className = "",
}: {
  providers: readonly LibraryProviderId[];
  emulatorIds: readonly string[];
  unknownDurationProviders?: readonly LibraryProviderId[];
  variant?: BadgeVariant;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center ${variant === "mark" ? "gap-0" : "gap-1.5"} ${className}`}
    >
      {gameOrigins({
        providers,
        emulatorIds,
        unknownDurationProviders,
      }).map((entry) => (
        <OriginBadge key={entry.key} entry={entry} variant={variant} />
      ))}
    </div>
  );
}

function LegendHeading({ children }: PropsWithChildren) {
  return (
    <div className="px-1 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-text-faint first:pt-0">
      {children}
    </div>
  );
}

function LegendRow({
  glyph,
  tone,
  label,
  tip,
}: {
  glyph: ReactNode;
  tone: string;
  label: string;
  tip: string;
}) {
  return (
    <div className="flex gap-1.5 px-1 py-1">
      <span className={`mt-0.5 shrink-0 ${tone}`}>{glyph}</span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-text">{label}</div>
        <div className="text-[10px] leading-4 text-text-muted">{tip}</div>
      </div>
    </div>
  );
}

/** The match seals plus the legend that teaches every mark on the card. The
 *  origin coins live elsewhere (beside the game name), but they still get named
 *  here: icon-only marks have to teach themselves somewhere. */
export function GameProvenanceBadges({
  sources,
  approval,
  providers,
  emulatorIds,
  unknownDurationProviders = [],
  describeOrigins = true,
  dataTourPrefix,
  className = "",
}: {
  sources: readonly GameSource[];
  approval?: SourceApproval;
  providers: readonly LibraryProviderId[];
  emulatorIds: readonly string[];
  unknownDurationProviders?: readonly LibraryProviderId[];
  /** False when the coins are switched off, so the legend stops naming marks
   *  the card is not showing. */
  describeOrigins?: boolean;
  dataTourPrefix?: string;
  className?: string;
}) {
  const origins = describeOrigins
    ? gameOrigins({ providers, emulatorIds, unknownDurationProviders })
    : [];

  // The caller owns placement, so the positioned tooltip anchor lives one level
  // in: `absolute` from a caller class would otherwise lose to `relative` here.
  return (
    <div className={className}>
      <div className="group/provenance relative flex flex-wrap items-center gap-y-1">
        <GameMatchBadges
          sources={sources}
          approval={approval}
          dataTourPrefix={dataTourPrefix}
        />
        <div
          role="tooltip"
          className="pointer-events-none invisible absolute left-0 top-full z-40 mt-2 w-52 translate-y-1 rounded-md border border-border bg-surface p-2 text-left opacity-0 shadow-raised transition group-hover/provenance:visible group-hover/provenance:translate-y-0 group-hover/provenance:opacity-100 group-focus-within/provenance:visible group-focus-within/provenance:translate-y-0 group-focus-within/provenance:opacity-100"
        >
          {sources.length > 0 ? (
            <>
              <LegendHeading>How this file was matched</LegendHeading>
              {sources.map((source) => {
                const meta = sourceMeta[source];
                const Icon = meta.icon;
                const pip =
                  source === "custom" && approval
                    ? approvalMeta[approval]
                    : null;
                return (
                  <LegendRow
                    key={source}
                    glyph={
                      <Icon size={11} strokeWidth={2.25} aria-hidden="true" />
                    }
                    tone={meta.tone}
                    label={meta.label}
                    tip={pip ? `${meta.tip} ${pip.tip}` : meta.tip}
                  />
                );
              })}
            </>
          ) : null}
          {origins.length > 0 ? (
            <>
              <LegendHeading>Where this game came from</LegendHeading>
              {origins.map((entry) => (
                <LegendRow
                  key={entry.key}
                  glyph={<OriginGlyph entry={entry} variant="label" />}
                  tone={entry.tone}
                  label={entry.label}
                  tip={
                    entry.unknownDuration
                      ? `${entry.tip} ${UNKNOWN_DURATION_TIP}`
                      : entry.tip
                  }
                />
              ))}
            </>
          ) : null}
        </div>
      </div>
    </div>
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
  const approval = communitySuggestionApproval({
    suggestionId,
    verified,
    status,
  });
  if (!approval) return null;

  return (
    <span className="inline-flex shrink-0 rounded border border-community-border bg-community-tint px-1.5 py-0.5 text-[11px] font-medium text-community">
      {approval === "approved"
        ? "Community approved"
        : "Awaiting community approval"}
    </span>
  );
}
