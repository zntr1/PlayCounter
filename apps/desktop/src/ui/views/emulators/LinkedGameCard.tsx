import clsx from "clsx";
import {
  Check,
  FileCode2,
  Gamepad2,
  Repeat2,
  RotateCcw,
  Share2,
  type LucideIcon,
} from "lucide-react";
import { useState, type ButtonHTMLAttributes } from "react";
import type {
  EmulatorMapping,
  EmulatorMappingShare,
} from "../../../emulators/types";
import { emulatorMappingProvenance } from "../../../emulators/provenance";
import {
  emulatorShareControl,
  isShareableEmulatorMapping,
} from "../../../emulators/share";
import { useAppStore, useIsOffline } from "../../../store";
import {
  confirmEmulatorMapping,
  emulatorShareRuntimeContext,
  shareEmulatorMapping,
} from "../../../tracker";
import { GameProvenanceBadges, formatDuration } from "../../components";
import { GameCover } from "../../GameCover";
import { emulatorDetectionSourceLabel } from "./emulatorPickerModel";

export const DEMO_ACTION_REASON =
  "Sample card - actions are switched off during the guide.";

export type LinkedGameStats = {
  seconds: number;
  sessions: number;
};

/* One linked game as a cover card, in the language of the library grid:
   cover on top, the numbers underneath, and the three match actions in a
   segmented footer so the guide can still point at them by name. */
export function LinkedGameCard({
  mapping,
  stats,
  showDurationDays,
  demo = false,
  onChange,
  onForget,
  onDemoConfirm,
  onDemoShare,
}: {
  mapping: EmulatorMapping;
  stats: LinkedGameStats | null;
  showDurationDays: boolean;
  demo?: boolean;
  onChange?: () => void;
  onForget?: () => void;
  onDemoConfirm?: () => void;
  onDemoShare?: () => void;
}) {
  const detectionSource = emulatorDetectionSourceLabel(mapping.detectionSource);
  const provenance = emulatorMappingProvenance(mapping);
  const addToast = useAppStore((state) => state.addToast);
  const installUuid = useAppStore((state) => state.installUuid);
  const offline = useIsOffline();
  const [sharing, setSharing] = useState(false);
  const share =
    mapping.share?.gameId === mapping.gameId ? mapping.share : undefined;
  const shareContext = {
    ...emulatorShareRuntimeContext(),
    installUuid,
    offline,
  };
  const shareable = demo
    ? true
    : isShareableEmulatorMapping(mapping, shareContext);
  const shareControl = demo
    ? ({
        visible: true,
        action: "share",
        label: "Share match",
        disabled: !onDemoShare,
        reason: onDemoShare
          ? "Preview sharing this sample match"
          : DEMO_ACTION_REASON,
      } as const)
    : emulatorShareControl(mapping, shareContext);
  const community = communityStatus(share, shareable);
  const recognized = detectionSource
    ? `Recognized by ${detectionSource}: ${mapping.display}`
    : `Recognized from ${mapping.display}`;

  async function submitShare() {
    if (demo) return onDemoShare?.();
    if (!shareControl.visible || shareControl.disabled || sharing) return;
    setSharing(true);
    const outcome = await shareEmulatorMapping(mapping.contentKey);
    setSharing(false);
    if (outcome.kind === "shared") {
      if (outcome.share.status === "rejected") return;
      addToast({
        tone: "success",
        title:
          outcome.share.status === "already_curated"
            ? "Already in the Community database"
            : "Match sent for review",
        detail:
          outcome.share.status === "pending"
            ? "You'll get a notification once it's reviewed."
            : "Nothing changed on this PC.",
      });
    } else {
      addToast({
        tone: "error",
        title: "Could not share match",
        detail:
          outcome.kind === "failed"
            ? outcome.error
            : "Nothing changed on this PC.",
      });
    }
  }

  return (
    <article
      className="group relative flex min-w-0 flex-col rounded-xl border border-border bg-surface shadow-raised transition hover:z-20 hover:border-accent/40 hover:shadow-card-hover"
      data-tour={demo ? "demo-emulator-linked" : undefined}
      aria-label={mapping.gameName}
    >
      {/* The legend popover has to escape the cover's clipping, so the seal
          sits beside the cover frame, not inside it. */}
      <div className="relative">
        <div className="aspect-[3/4] overflow-hidden rounded-t-xl bg-surface-hover">
          {mapping.coverUrl ? (
            <GameCover
              src={mapping.coverUrl}
              alt=""
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-text-faint">
              <Gamepad2 size={28} />
            </div>
          )}
        </div>
        {provenance.source ? (
          <GameProvenanceBadges
            className="absolute left-2 top-2 z-40 drop-shadow-md"
            sources={[provenance.source]}
            emulatorSources={[provenance.source]}
            approval={provenance.approval}
            providers={[]}
            emulatorIds={[mapping.emulatorId]}
            describeOrigins={false}
          />
        ) : null}
        {mapping.needsConfirmation ? (
          <span
            className="absolute right-2 top-2 rounded-full border border-warning-border bg-warning-tint px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning shadow-sm backdrop-blur"
            data-tour={demo ? "demo-emulator-check-badge" : undefined}
          >
            Check this once
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5 p-3">
        <h3
          className="truncate text-sm font-semibold leading-tight text-text"
          title={mapping.gameName}
        >
          {mapping.gameName}
        </h3>
        {stats && stats.sessions > 0 ? (
          <p className="text-xs leading-5 text-text-muted">
            <span className="font-mono text-sm font-bold text-text">
              {formatDuration(stats.seconds, showDurationDays)}
            </span>{" "}
            in {stats.sessions} session{stats.sessions === 1 ? "" : "s"}
          </p>
        ) : (
          <p className="text-xs leading-5 text-text-faint">Not played yet</p>
        )}
        <p
          className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted"
          title={recognized}
        >
          <FileCode2 aria-hidden="true" size={12} className="shrink-0" />
          <span className="truncate font-mono text-text">
            {mapping.display}
          </span>
        </p>
        <dl className="mt-1 grid gap-0.5 border-t border-border/70 pt-2 text-[11px]">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-text-faint">Community</dt>
            <dd
              className={clsx(
                "truncate text-right font-medium",
                community.tone,
              )}
              title={community.tip}
            >
              {community.label}
            </dd>
          </div>
          <DateRow label="Linked" iso={mapping.decidedAt} />
          <DateRow label="Last seen" iso={mapping.lastSeenAt} />
        </dl>
      </div>

      <div className="mt-auto">
        {mapping.needsConfirmation ? (
          <button
            type="button"
            disabled={demo && !onDemoConfirm}
            title={
              demo && !onDemoConfirm
                ? DEMO_ACTION_REASON
                : "PlayCounter already tracks this game. Confirm to remove the note."
            }
            data-tour={demo ? "demo-emulator-confirm" : undefined}
            onClick={
              demo
                ? onDemoConfirm
                : () => confirmEmulatorMapping(mapping.contentKey)
            }
            className="flex w-full items-center justify-center gap-2 border-t border-warning-border bg-warning-tint px-3 py-2 text-xs font-semibold text-warning transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check size={14} className="shrink-0" />
            Looks right
          </button>
        ) : null}

        <div
          className="overflow-hidden rounded-b-xl border-t border-border"
          data-tour={demo ? "demo-emulator-actions" : undefined}
        >
          {shareControl.visible ? (
            <FooterAction
              icon={Share2}
              label={sharing ? "Sharing…" : shareControl.label}
              disabled={shareControl.disabled || sharing}
              title={shareControl.reason ?? shareControl.label}
              onClick={() => void submitShare()}
              className="w-full border-b border-border text-community hover:text-community"
            />
          ) : null}
          <div className="grid grid-cols-2 divide-x divide-border">
            <FooterAction
              icon={Repeat2}
              label="Change"
              disabled={!onChange}
              title={demo && !onChange ? DEMO_ACTION_REASON : "Change game"}
              onClick={onChange}
            />
            <FooterAction
              icon={RotateCcw}
              label="Forget"
              disabled={!onForget}
              title={demo && !onForget ? DEMO_ACTION_REASON : "Forget game"}
              onClick={onForget}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

function FooterAction({
  icon: Icon,
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button
      type="button"
      className={clsx(
        "flex h-9 items-center justify-center gap-1.5 px-2 text-[11px] font-semibold text-text-muted transition hover:bg-surface-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-muted",
        className,
      )}
      {...rest}
    >
      <Icon size={13} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function DateRow({ label, iso }: { label: string; iso: string }) {
  const date = new Date(iso);
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-text-faint">{label}</dt>
      <dd className="font-mono tabular-nums text-text-muted">
        <time dateTime={iso} title={date.toLocaleString()}>
          {date.toLocaleDateString()}
        </time>
      </dd>
    </div>
  );
}

/* One line that answers "did I already share this?" without a badge zoo:
   what the community database knows about this link right now. */
function communityStatus(
  share: EmulatorMappingShare | undefined,
  shareable: boolean,
): { label: string; tone: string; tip: string } {
  if (share?.status === "verified" || share?.status === "already_curated") {
    return {
      label: "Approved",
      tone: "text-success",
      tip: "This match is in the Community database. Other PlayCounter installs recognize it too.",
    };
  }
  if (share?.status === "pending") {
    return {
      label: "Shared · in review",
      tone: "text-community",
      tip: `Sent ${new Date(share.submittedAt).toLocaleDateString()}. You'll get a notification once it's reviewed.`,
    };
  }
  if (share?.status === "rejected") {
    return {
      label: "Not accepted",
      tone: "text-warning",
      tip: "The review declined this match. The reason is in Notifications - your own link still works.",
    };
  }
  if (!shareable) {
    return {
      label: "Stays on this PC",
      tone: "text-text-faint",
      tip: "Custom games and private file names are never sent to the Community database.",
    };
  }
  return {
    label: "Not shared yet",
    tone: "text-text-faint",
    tip: "Use Share match to send this file-to-game link to the Community database.",
  };
}
