import { Check, Lock } from "lucide-react";
import clsx from "clsx";
import { displayNotificationTitle } from "../../../notifications";
import { AchievementMedal } from "../../AchievementBadge";
import {
  progressLabel,
  type AchievementCatalogItem,
  type AchievementUnit,
} from "./achievementCatalog";

const TIER_BORDER: Record<AchievementCatalogItem["tier"], string> = {
  bronze: "border-[#b5713f]/60",
  silver: "border-[#9aa5b4]/60",
  gold: "border-[#b98512]/60",
  platinum: "border-[#7fd3e8]/60",
};

export function AchievementCard({ item }: { item: AchievementCatalogItem }) {
  const unlocked = Boolean(item.milestone);
  const title = item.milestone
    ? displayNotificationTitle({
        id: item.id,
        kind: item.kind,
        title: item.title,
      })
    : item.title;
  const isNew = item.milestone
    ? Date.now() - Date.parse(item.milestone.awardedAt) <= 48 * 60 * 60 * 1000
    : false;

  return (
    <article
      className={clsx(
        "relative min-w-0 rounded-xl border p-4 transition hover:border-accent/40 hover:shadow-card-hover",
        unlocked
          ? ["bg-surface", TIER_BORDER[item.tier]]
          : "border-border bg-bg",
        item.isNext && !unlocked && "ring-1 ring-accent/50",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <AchievementMedal
          notification={{
            id: item.id,
            kind: item.kind,
            title,
            coverUrl: item.coverUrl,
          }}
          locked={!unlocked}
          size="md"
        />
        <div className="flex min-w-0 flex-col items-end gap-1">
          {isNew ? (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold tracking-wider text-accent-fg">
              NEW
            </span>
          ) : item.isNext && !unlocked ? (
            <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-bold tracking-wider text-accent">
              NEXT
            </span>
          ) : null}
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-text-faint">
            {item.tier}
          </span>
        </div>
      </div>
      <h3 className="mt-4 min-h-10 break-words text-sm font-semibold leading-5 text-text">
        {title}
      </h3>
      {item.milestone ? (
        <time
          dateTime={item.milestone.awardedAt}
          title={new Date(item.milestone.awardedAt).toLocaleString()}
          className="mt-3 flex items-center gap-1.5 text-xs font-medium text-text-muted"
        >
          <Check aria-hidden="true" size={13} className="text-success" />
          Unlocked · {formatAwardDate(item.milestone.awardedAt)}
        </time>
      ) : (
        <div className="mt-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-text-faint">
            <Lock aria-hidden="true" size={12} />
            Locked
          </div>
          <AchievementProgressBar
            currentValue={item.currentValue}
            threshold={item.threshold}
            unit={item.unit}
            label={title}
          />
        </div>
      )}
    </article>
  );
}

export function AchievementProgressBar({
  currentValue,
  threshold,
  unit,
  label,
  compact = false,
}: {
  currentValue?: number;
  threshold: number;
  unit: AchievementUnit;
  label: string;
  compact?: boolean;
}) {
  const current = Math.max(0, currentValue ?? 0);
  const progress = Math.min(100, (current / threshold) * 100);
  const valueText = progressLabel(current, threshold, unit);
  return (
    <div>
      {!compact ? (
        <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px] text-text-muted">
          <span className="font-medium">Progress</span>
          <span className="shrink-0 font-mono tabular-nums">{valueText}</span>
        </div>
      ) : null}
      <div
        className={clsx(
          "overflow-hidden rounded-full bg-surface-hover",
          compact ? "h-1.5" : "h-2",
        )}
        role="progressbar"
        aria-label={`Progress toward ${label}`}
        aria-valuemin={0}
        aria-valuemax={threshold}
        aria-valuenow={Math.min(current, threshold)}
        aria-valuetext={valueText}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function formatAwardDate(iso: string) {
  return new Date(iso).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
