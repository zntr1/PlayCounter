import clsx from "clsx";
import type { ReactNode } from "react";
import { AchievementMedal } from "../../AchievementBadge";
import { displayNotificationTitle } from "../../../notifications";
import {
  remainderLabel,
  type AchievementCatalogItem,
} from "./achievementCatalog";

/* One achievement ladder: what it is on the left, its rungs on the right.
 * Game ladders lead with a cover, milestone ladders with an icon tile. */
export function LadderRow({
  leading,
  title,
  subtitle,
  rungs,
}: {
  leading: ReactNode;
  title: string;
  subtitle: string;
  rungs: AchievementCatalogItem[];
}) {
  return (
    <article className="grid min-w-0 grid-cols-[56px_minmax(0,1fr)] items-center gap-4 rounded-xl border border-border bg-bg p-3 transition hover:border-accent/30 xl:grid-cols-[56px_minmax(130px,0.8fr)_minmax(360px,1.8fr)]">
      {leading}
      <div className="min-w-0">
        <h3 className="break-words text-sm font-semibold text-text">{title}</h3>
        <p className="mt-1 font-mono text-xs tabular-nums text-text-muted">
          {subtitle}
        </p>
      </div>
      <div
        className="col-span-2 grid min-w-0 gap-1.5 xl:col-span-1"
        style={{
          gridTemplateColumns: `repeat(${rungs.length}, minmax(0, 1fr))`,
        }}
      >
        {rungs.map((rung) => (
          <Rung key={rung.id} rung={rung} />
        ))}
      </div>
    </article>
  );
}

function Rung({ rung }: { rung: AchievementCatalogItem }) {
  const unlocked = Boolean(rung.milestone);
  const isNext = rung.isNext && !unlocked;
  const title = unlocked
    ? displayNotificationTitle({
        id: rung.id,
        kind: rung.kind,
        title: rung.title,
      })
    : rung.title;
  const tooltip = unlocked
    ? `${title} · Unlocked ${formatAwardDate(rung.milestone!.awardedAt)}`
    : isNext
      ? `${title} · ${remainderLabel(rung)}`
      : `${title} · Locked`;

  return (
    <div
      title={tooltip}
      className={clsx(
        "flex min-w-0 flex-col items-center rounded-lg px-1 py-1.5",
        isNext && "bg-accent/10 ring-1 ring-inset ring-accent/40",
      )}
    >
      <AchievementMedal
        notification={{
          id: rung.id,
          kind: rung.kind,
          title,
          coverUrl: rung.coverUrl,
        }}
        locked={!unlocked}
        size="sm"
      />
      <span className="mt-1 font-mono text-[10px] font-semibold tabular-nums text-text-muted">
        {thresholdLabel(rung)}
      </span>
      {isNext ? (
        <span className="mt-0.5 max-w-full truncate text-[9px] font-semibold text-accent">
          {remainderShort(rung)}
        </span>
      ) : null}
    </div>
  );
}

export function thresholdLabel(rung: AchievementCatalogItem) {
  const amount = rung.threshold.toLocaleString();
  if (rung.unit === "hours") return `${amount}h`;
  if (rung.unit === "days") return `${amount}d`;
  return amount;
}

function remainderShort(rung: AchievementCatalogItem) {
  return remainderLabel(rung)
    .replace(" more hours", "h left")
    .replace(" more hour", "h left")
    .replace(" more days", "d left")
    .replace(" more day", "d left")
    .replace(/ more contributions?/, " left");
}

function formatAwardDate(iso: string) {
  return new Date(iso).toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
