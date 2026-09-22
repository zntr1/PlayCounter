import { Check, Lock } from "lucide-react";
import { Panel } from "../../components";
import { AchievementMedal } from "../../AchievementBadge";
import { ACHIEVEMENT_TIERS } from "../../../achievementArt";
import { TOTAL_HOURS } from "../../../milestones";
import { displayNotificationTitle } from "../../../notifications";
import { AchievementProgressBar } from "./AchievementCard";
import {
  type AchievementCatalogItem,
  type AchievementSummaryData,
} from "./achievementCatalog";

/* One row above the tabs: how far along the milestones are, what unlocks
 * next, and what unlocked last. Everything else lives in the tabs below. */
export function AchievementHero({
  summary,
  nextUp,
  recent,
}: {
  summary: AchievementSummaryData;
  nextUp: AchievementCatalogItem[];
  recent: AchievementCatalogItem[];
}) {
  return (
    <Panel className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="relative grid gap-6 p-5 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] lg:gap-8">
        <ProgressRing summary={summary} />
        <HeroColumn title="Next up" empty="Everything is unlocked.">
          {nextUp.map((item) => (
            <NextUpRow key={item.id} item={item} />
          ))}
        </HeroColumn>
        <HeroColumn
          title="Latest"
          empty="Play any tracked game to unlock your first trophy."
        >
          {recent.map((item) => (
            <RecentRow key={item.id} item={item} />
          ))}
        </HeroColumn>
      </div>
    </Panel>
  );
}

const TIER_SAMPLES = TOTAL_HOURS.map((threshold, index) => ({
  tier: ACHIEVEMENT_TIERS[index],
  id: `milestone:total:${threshold}`,
  kind: "milestone-total" as const,
}));

function ProgressRing({ summary }: { summary: AchievementSummaryData }) {
  const size = 96;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - summary.completionPct / 100);
  const tiers = TIER_SAMPLES.filter(
    (sample) => sample.tier && summary.byTier[sample.tier] > 0,
  );

  return (
    <div className="flex items-center gap-5">
      <div
        className="relative grid shrink-0 place-items-center"
        role="img"
        aria-label={`${summary.fixedUnlocked} of ${summary.fixedTotal} milestones unlocked, ${summary.completionPct}% complete`}
      >
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-surface-hover"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="stroke-accent transition-[stroke-dashoffset] duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-mono text-2xl font-bold tabular-nums leading-none text-text">
            {summary.completionPct}
            <span className="text-sm font-semibold text-text-faint">%</span>
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">
          Milestones
        </p>
        <p className="mt-1 font-mono text-2xl font-bold tabular-nums tracking-tight text-text">
          {summary.fixedUnlocked}
          <span className="text-base font-semibold text-text-faint">
            {" "}
            / {summary.fixedTotal}
          </span>
        </p>
        <p className="mt-0.5 text-xs text-text-muted">
          {summary.gameTrophies.toLocaleString()} game{" "}
          {summary.gameTrophies === 1 ? "trophy" : "trophies"} on top
        </p>
        {tiers.length > 0 ? (
          <ul
            className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5"
            aria-label="Unlocked trophies by tier"
          >
            {tiers.map((sample) => (
              <li
                key={sample.tier}
                className="flex items-center gap-1.5"
                title={`${summary.byTier[sample.tier!]} ${sample.tier}`}
              >
                <AchievementMedal
                  notification={{
                    id: sample.id,
                    kind: sample.kind,
                    title: `${sample.tier} trophy`,
                  }}
                  size="sm"
                />
                <span className="font-mono text-xs font-semibold tabular-nums text-text-muted">
                  {summary.byTier[sample.tier!]}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function HeroColumn({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <div className="min-w-0 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
      <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-text-faint">
        {title}
      </h2>
      {children.length > 0 ? (
        <ul className="mt-3 grid gap-3">{children}</ul>
      ) : (
        <p className="mt-3 text-sm text-text-muted">{empty}</p>
      )}
    </div>
  );
}

function NextUpRow({ item }: { item: AchievementCatalogItem }) {
  return (
    <li className="flex min-w-0 items-center gap-3">
      <AchievementMedal
        notification={{
          id: item.id,
          kind: item.kind,
          title: item.title,
          coverUrl: item.coverUrl,
        }}
        locked
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
          <Lock
            aria-hidden="true"
            size={11}
            className="shrink-0 text-text-faint"
          />
          <span className="truncate">{item.title}</span>
        </div>
        <div className="mt-1.5">
          <AchievementProgressBar
            currentValue={item.currentValue}
            threshold={item.threshold}
            unit={item.unit}
            label={item.title}
            compact
          />
        </div>
      </div>
    </li>
  );
}

function RecentRow({ item }: { item: AchievementCatalogItem }) {
  const title = displayNotificationTitle({
    id: item.id,
    kind: item.kind,
    title: item.title,
  });
  return (
    <li className="flex min-w-0 items-center gap-3">
      <AchievementMedal
        notification={{
          id: item.id,
          kind: item.kind,
          title,
          coverUrl: item.coverUrl,
        }}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
          <Check
            aria-hidden="true"
            size={11}
            className="shrink-0 text-success"
          />
          <span className="truncate">{title}</span>
        </div>
        <time
          dateTime={item.milestone!.awardedAt}
          title={new Date(item.milestone!.awardedAt).toLocaleString()}
          className="mt-0.5 block text-[11px] text-text-faint"
        >
          {relativeTime(item.milestone!.awardedAt)}
        </time>
      </div>
    </li>
  );
}

function relativeTime(iso: string) {
  const elapsedSeconds = Math.round((Date.parse(iso) - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60)
    return formatter.format(elapsedSeconds, "second");
  const minutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return formatter.format(months, "month");
  return formatter.format(Math.round(months / 12), "year");
}
