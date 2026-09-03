import type { PropsWithChildren } from "react";
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
import xboxIconUrl from "../../../../assets/xbox/xbox-icon.png";
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
  "relative grid h-5 w-5 shrink-0 place-items-center rounded-md border bg-bg/85 shadow-raised";
const COIN_SHELL =
  "relative grid h-5 w-5 shrink-0 place-items-center rounded-full border shadow-raised";
const PIP_SHELL =
  "absolute -bottom-1 -right-1 grid h-3 w-3 place-items-center rounded-full border border-bg";
const COIN_IMAGE = "h-3.5 w-3.5 object-contain";
const LABEL_IMAGE = "h-3 w-3 object-contain";

type SourceMeta = {
  label: string;
  icon: LucideIcon;
  tip: string;
  labelTone: string;
  markTone: string;
};

// Colour encodes how public the fact is: verified record, then the crowd, then
// a link that never leaves this PC. Amber stays reserved for real warnings.
const sourceMeta: Record<GameSource, SourceMeta> = {
  igdb: {
    label: "IGDB",
    icon: Database,
    tip: "IGDB has this file name on record for the game.",
    labelTone: "border-success-border bg-success-tint text-success",
    markTone: "border-success-border text-success",
  },
  community: {
    label: "Community",
    icon: Users,
    tip: "A PlayCounter user linked this file name to the game, and it was approved.",
    labelTone: "border-community-border bg-community-tint text-community",
    markTone: "border-community-border text-community",
  },
  custom: {
    label: "Custom",
    icon: PenLine,
    tip: "You linked this file name to the game yourself. Stays on this PC.",
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
    tip: "Sent to the community and waiting for review.",
    pipTone: "bg-warning text-bg",
  },
  approved: {
    icon: Check,
    tip: "The community approved this match.",
    pipTone: "bg-community text-bg",
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
    ? `${meta.label} — ${meta.tip} ${approvalMeta[approval].tip}`
    : `${meta.label} — ${meta.tip}`;
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
        <Icon size={12} strokeWidth={2.25} aria-hidden="true" />
        {pip && PipIcon ? (
          <span aria-hidden="true" className={`${PIP_SHELL} ${pip.pipTone}`}>
            <PipIcon size={7} strokeWidth={4} />
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

  const badges = sources.map((source) => (
    <SourceBadge
      key={source}
      source={source}
      variant={variant}
      approval={source === "custom" ? approval : undefined}
      dataTour={dataTourPrefix ? `${dataTourPrefix}-${source}` : undefined}
    />
  ));

  if (variant === "label") {
    return (
      <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
        {badges}
      </div>
    );
  }

  // Icon-only seals need a way to teach themselves, so the whole cluster
  // carries one legend instead of three native tooltips fighting each other.
  // The caller owns placement, so the positioned tooltip anchor lives one level
  // in: `absolute` from a caller class would otherwise lose to `relative` here.
  return (
    <div className={className}>
      <div className="group/seals relative flex items-start gap-1.5">
        {badges}
        <div
          role="tooltip"
          className="pointer-events-none invisible absolute left-0 top-full z-40 mt-2 w-52 translate-y-1 rounded-md border border-border bg-surface p-2 text-left opacity-0 shadow-raised transition group-hover/seals:visible group-hover/seals:translate-y-0 group-hover/seals:opacity-100 group-focus-within/seals:visible group-focus-within/seals:translate-y-0 group-focus-within/seals:opacity-100"
        >
          <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-faint">
            How this file was matched
          </div>
          {sources.map((source) => {
            const meta = sourceMeta[source];
            const Icon = meta.icon;
            const pip =
              source === "custom" && approval ? approvalMeta[approval] : null;
            return (
              <div key={source} className="flex gap-1.5 px-1 py-1">
                <Icon
                  size={12}
                  strokeWidth={2.25}
                  aria-hidden="true"
                  className={`mt-0.5 shrink-0 ${meta.markTone.split(" ").pop()}`}
                />
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-text">
                    {meta.label}
                  </div>
                  <div className="text-[10px] leading-4 text-text-muted">
                    {meta.tip}
                    {pip ? ` ${pip.tip}` : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type OriginMeta = {
  label: string;
  tip: string;
  iconUrl: string;
  labelTone: string;
  coinTone: string;
};

const providerMeta: Record<LibraryProviderId, OriginMeta> = {
  steam: {
    label: "Steam",
    tip: "Imported from your local Steam library.",
    iconUrl: steamIconUrl,
    labelTone: "border-[#66c0f4]/40 bg-[#1b2838] text-[#66c0f4]",
    coinTone: "border-[#66c0f4]/55 bg-[#1b2838]",
  },
  xbox: {
    label: "Xbox",
    tip: "Imported from your Xbox Live history.",
    iconUrl: xboxIconUrl,
    labelTone: "border-[#107c10]/50 bg-[#0e2f16] text-[#7ee787]",
    coinTone: "border-[#107c10]/70 bg-[#0e2f16]",
  },
};

const UNKNOWN_DURATION_TIP = "This platform reported no play time for it.";

export function ProviderBadge({
  provider,
  variant = "label",
  unknownDuration = false,
}: {
  provider: LibraryProviderId;
  variant?: BadgeVariant;
  unknownDuration?: boolean;
}) {
  const meta = providerMeta[provider];
  const tip = `${meta.label} — ${meta.tip}${unknownDuration ? ` ${UNKNOWN_DURATION_TIP}` : ""}`;

  if (variant === "mark") {
    return (
      <span
        role="img"
        aria-label={tip}
        title={tip}
        className={`${COIN_SHELL} ${meta.coinTone}`}
      >
        <img
          src={meta.iconUrl}
          alt=""
          aria-hidden="true"
          className={COIN_IMAGE}
        />
        {unknownDuration ? (
          <span
            aria-hidden="true"
            className={`${PIP_SHELL} bg-warning text-[8px] font-bold leading-none text-bg`}
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
      className={`${LABEL_SHELL} font-semibold ${meta.labelTone}`}
    >
      <img
        src={meta.iconUrl}
        alt=""
        aria-hidden="true"
        className={LABEL_IMAGE}
      />
      {meta.label}
      {unknownDuration ? <span aria-hidden="true">?</span> : null}
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
  variant = "label",
}: {
  emulatorId: string;
  label?: string;
  variant?: BadgeVariant;
}) {
  const display = label ?? emulatorLabels[emulatorId] ?? emulatorId;
  const iconUrl = emulatorAssetUrls[emulatorId];
  const tip = `${display} — played through this emulator.`;
  // The emulator logos carry their own colour, so the coin stays neutral; the
  // solid `.emulator-badge` fill is kept for the labelled variant only.
  const image = variant === "mark" ? COIN_IMAGE : LABEL_IMAGE;
  const glyph = iconUrl ? (
    <img src={iconUrl} alt="" aria-hidden="true" className={image} />
  ) : (
    <Cpu
      size={variant === "mark" ? 12 : 11}
      strokeWidth={2.25}
      aria-hidden="true"
    />
  );

  if (variant === "mark") {
    return (
      <span
        role="img"
        aria-label={tip}
        title={tip}
        data-emulator-id={emulatorId}
        className={`${COIN_SHELL} border-accent/60 bg-bg/85 text-accent`}
      >
        {glyph}
      </span>
    );
  }

  return (
    <span
      title={tip}
      data-emulator-id={emulatorId}
      className={`emulator-badge ${LABEL_SHELL} font-semibold`}
    >
      {glyph}
      {display}
    </span>
  );
}

export function PlayCounterOriginBadge({
  variant = "label",
}: {
  variant?: BadgeVariant;
}) {
  const tip =
    "PlayCounter — found this game by itself, with no launcher import.";
  // A 20px coin cannot render the app logo legibly, so PlayCounter's own
  // discovery reads as a quiet gamepad glyph — the default needs no fanfare.
  const glyph = (
    <Gamepad2
      size={variant === "mark" ? 12 : 11}
      strokeWidth={2.25}
      aria-hidden="true"
    />
  );

  if (variant === "mark") {
    return (
      <span
        role="img"
        aria-label={tip}
        title={tip}
        className={`${COIN_SHELL} border-border bg-bg/85 text-text-muted`}
      >
        {glyph}
      </span>
    );
  }

  return (
    <span
      title={tip}
      className={`${LABEL_SHELL} border-border bg-surface font-semibold text-text-muted`}
    >
      {glyph}
      PlayCounter
    </span>
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
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {providers.map((provider) => (
        <ProviderBadge
          key={provider}
          provider={provider}
          variant={variant}
          unknownDuration={unknownDurationProviders.includes(provider)}
        />
      ))}
      {emulatorIds.map((emulatorId) => (
        <EmulatorBadge
          key={emulatorId}
          emulatorId={emulatorId}
          variant={variant}
        />
      ))}
      {providers.length === 0 && emulatorIds.length === 0 ? (
        <PlayCounterOriginBadge variant={variant} />
      ) : null}
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
